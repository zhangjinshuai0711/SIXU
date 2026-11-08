import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import worker from "./worker.mjs";

function database(t) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../drizzle/0000_reasoning_runs.sql", import.meta.url), "utf8"));
  t.after(() => sqlite.close());
  const DB = {
    sqlite,
    prepare(sql) {
      let values = [];
      return {
        bind(...args) { values = args; return this; },
        async first() { return sqlite.prepare(sql).get(...values) ?? null; },
        async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }; },
      };
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
  return DB;
}

async function rpc(DB, method, params, owner = "owner-a", implementation = worker) {
  const response = await implementation.fetch(new Request("https://private.test/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(owner ? { "oai-authenticated-user-id": owner } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }), { DB });
  const envelope = await response.json();
  const result = envelope.result;
  return {
    response, envelope, result,
    value: result?.content ? JSON.parse(result.content[0].text) : result,
  };
}
const call = (DB, name, args, owner, implementation) =>
  rpc(DB, "tools/call", { name, arguments: args }, owner, implementation);
const submit = (DB, run, artifact) =>
  call(DB, "advance_reasoning", { run_id: run.run_id, stage_key: run.stage_key, artifact });

test("discovery exposes the original three tools and state operations require identity", async t => {
  const DB = database(t);
  assert.deepEqual((await rpc(DB, "server/discover")).value.supportedVersions, ["2026-07-28"]);
  const tools = (await rpc(DB, "tools/list")).value.tools;
  assert.deepEqual(tools.map(tool => tool.name), ["begin_reasoning", "advance_reasoning", "reasoning_status"]);
  assert.equal(tools[0].inputSchema.properties.strategy.default, "linear");
  const anonymous = await call(DB, "begin_reasoning", { task: "Secret task." }, null);
  assert.equal(anonymous.result.isError, true);
  assert.equal(anonymous.value.code, "AUTH_REQUIRED");
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) AS count FROM reasoning_runs").get().count, 0);
  assert.equal((await call(DB, "begin_reasoning", {})).value.code, "INVALID_ARGUMENTS");
});

test("adaptive repair workflow persists across independent worker instances with unchanged budgets", async t => {
  const DB = database(t);
  let run = (await call(DB, "begin_reasoning", { task: "Compute 1+1.", strategy: "adaptive_search" })).value;
  assert.equal(run.budget.max_steps, 8);
  run = (await submit(DB, run, {
    kind: "adaptive_step", action: "EXPAND", summary: "Candidate constructed.", progress: true,
    rationale: "Check the arithmetic.", candidate: { id: "C1", strategy: "addition", answer: "3" },
    proposed_action: "VERIFY",
  })).value;
  const fresh = (await import("./worker.mjs?fresh-instance")).default;
  run = (await call(DB, "reasoning_status", { run_id: run.run_id }, "owner-a", fresh)).value;
  assert.equal(run.action, "VERIFY");
  run = (await submit(DB, run, {
    kind: "adaptive_step", action: "VERIFY", summary: "The candidate adds incorrectly.",
    affected_candidate_id: "C1", issue: { description: "1+1 is 2.", state: "error", candidate_id: "C1" },
    progress: true, rationale: "Repair the candidate.", proposed_action: "REVISE",
  })).value;
  run = (await submit(DB, run, {
    kind: "adaptive_step", action: "REVISE", summary: "Replace 3 with 2.",
    candidate: { id: "C1", strategy: "addition", answer: "2" }, resolve_issue: 1,
    affected_candidate_id: "C1", progress: true, rationale: "Recheck.", proposed_action: "VERIFY",
  })).value;
  run = (await submit(DB, run, {
    kind: "adaptive_step", action: "VERIFY", summary: "The revised arithmetic agrees.",
    affected_candidate_id: "C1", progress: true, rationale: "Ready to finish.", proposed_action: "FINALIZE",
  })).value;
  run = (await submit(DB, run, {
    kind: "adaptive_final", answer: "2", selected_candidate_id: "C1", unresolved: [],
  })).value;
  assert.equal(run.status, "completed");
  assert.equal(run.budget.revisions_used, 1);
  assert.equal(run.history.find(h => h.replaced_candidate).replaced_candidate.answer, "3");
  assert.equal((await call(DB, "reasoning_status", { run_id: run.run_id }, "owner-a", fresh)).value.final.answer, "2");
});

test("linear workflow survives per-request reconstruction and preserves final reconciliation", async t => {
  const DB = database(t);
  let run = (await call(DB, "begin_reasoning", { task: "Compute (1+1)*2." })).value;
  for (const artifact of [
    { kind: "plan", goal: "Calculate expression.", constraints: ["Use given arithmetic."], subproblems: [
      { id: "S1", question: "Compute 1+1.", depends_on: [] },
      { id: "S2", question: "Multiply S1 by 2.", depends_on: ["S1"] },
    ] },
    { kind: "solve", subproblem_id: "S1", result: "2", evidence: ["1+1=2"] },
    { kind: "solve", subproblem_id: "S2", result: "4", evidence: ["2*2=4"] },
    { kind: "review", checks: [{ constraint_index: 0, finding: "Given expression used." }], issues: [] },
    { kind: "final", answer: "4", covered_constraint_indices: [0], unresolved: [], conclusions: [
      { subproblem_id: "S1", disposition: "confirmed", result: "2", basis: "1+1=2" },
      { subproblem_id: "S2", disposition: "confirmed", result: "4", basis: "2*2=4" },
    ] },
  ]) {
    const response = await submit(DB, run, artifact);
    assert.notEqual(response.result.isError, true);
    run = response.value;
  }
  assert.equal(run.status, "completed");
  assert.equal(run.answer, "4");
  assert.equal((await call(DB, "reasoning_status", { run_id: run.run_id })).value.answer, "4");
});

test("cross-user access and expired runs reveal neither task nor intermediate results", async t => {
  const DB = database(t);
  const run = (await call(DB, "begin_reasoning", { task: "Private alpha.", strategy: "adaptive_search" })).value;
  const stranger = await call(DB, "reasoning_status", { run_id: run.run_id }, "owner-b");
  assert.equal(stranger.value.code, "RUN_MISSING");
  assert.equal(JSON.stringify(stranger.envelope).includes("Private alpha"), false);
  const strangerWrite = await call(DB, "advance_reasoning", {
    run_id: run.run_id, stage_key: run.stage_key,
    artifact: { kind: "adaptive_final", answer: "Tampered.", unresolved: [] },
  }, "owner-b");
  assert.equal(strangerWrite.value.code, "RUN_MISSING");
  assert.equal((await call(DB, "reasoning_status", { run_id: run.run_id })).value.action, "EXPAND");
  DB.sqlite.prepare("UPDATE reasoning_runs SET expires_at = 0").run();
  assert.equal((await call(DB, "reasoning_status", { run_id: run.run_id })).value.code, "RUN_MISSING");
  await call(DB, "begin_reasoning", { task: "New task." });
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) AS count FROM reasoning_runs").get().count, 1);
});

test("competing submissions use optimistic locking rather than silently overwriting state", async t => {
  const DB = database(t);
  const run = (await call(DB, "begin_reasoning", { task: "Compute 1+1.", strategy: "adaptive_search" })).value;
  const artifact = {
    kind: "adaptive_step", action: "EXPAND", summary: "A candidate.", progress: true,
    rationale: "Complete.", candidate: { id: "C1", strategy: "addition", answer: "2" },
    proposed_action: "FINALIZE",
  };
  const results = await Promise.all([submit(DB, run, artifact), submit(DB, run, artifact)]);
  assert.equal(results.filter(r => r.value.code === "STATE_CONFLICT").length, 1);
  assert.equal(results.filter(r => r.value.action === "FINALIZE").length, 1);
  const saved = (await call(DB, "reasoning_status", { run_id: run.run_id })).value;
  assert.equal(saved.history.length, 1);
  const stale = await submit(DB, run, artifact);
  assert.equal(stale.value.status, "rejected");
  assert.equal(stale.value.stage_key, saved.stage_key);
});

test("storage failures and malformed requests are explicit without leaking task content", async t => {
  const DB = database(t);
  assert.equal((await worker.fetch(new Request("https://private.test/health"), { DB })).status, 200);
  assert.equal((await worker.fetch(new Request("https://private.test/health"), {})).status, 503);
  const missing = await call(undefined, "begin_reasoning", { task: "Do not leak this." });
  assert.equal(missing.value.code, "STORAGE_UNAVAILABLE");
  assert.equal(JSON.stringify(missing.envelope).includes("Do not leak this"), false);
  const bad = await worker.fetch(new Request("https://private.test/mcp", { method: "POST", body: "{" }), { DB });
  assert.equal(bad.status, 400);
  const oversized = await worker.fetch(new Request("https://private.test/mcp", {
    method: "POST", body: " ".repeat(65537),
  }), { DB });
  assert.equal(oversized.status, 413);
});

test("cloud run quota is enforced in the insertion and is scoped to one user", async t => {
  const DB = database(t);
  const insert = DB.sqlite.prepare(
    "INSERT INTO reasoning_runs (owner_id, run_id, protocol, state_json, expires_at, updated_at) VALUES (?, ?, 'linear', '{}', ?, ?)",
  );
  for (let i = 0; i < 64; i++) insert.run("owner-a", `fixture-${i}`, Date.now() + 60000, Date.now());
  const rejected = await call(DB, "begin_reasoning", { task: "New task." });
  assert.equal(rejected.value.code, "RUN_LIMIT");
  const other = await call(DB, "begin_reasoning", { task: "Other owner." }, "owner-b");
  assert.equal(other.value.phase, "plan");
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) AS count FROM reasoning_runs WHERE owner_id = 'owner-a'").get().count, 64);
});
