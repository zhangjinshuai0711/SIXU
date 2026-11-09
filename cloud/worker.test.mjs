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
  }), { DB, ...(implementation.readOnly ? { SIXU_READ_ONLY: "true" } : {}) });
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

test("tool discovery advertises input optionality and v0.4 review/depth fields", async () => {
  const tools = (await rpc(null, "tools/list")).value.tools;
  const begin = tools.find(tool => tool.name === "begin_reasoning").inputSchema;
  assert.equal(begin.required?.includes("feedback") ?? false, false);
  assert.deepEqual(begin.properties.depth.enum, ["medium", "deep"]);
  const advance = tools.find(tool => tool.name === "advance_reasoning").inputSchema;
  const variants = [];
  function visit(value) {
    if (!value || typeof value !== "object") return;
    if (value.properties?.kind?.const) variants.push(value);
    for (const child of Object.values(value)) visit(child);
  }
  visit(advance);
  const adaptive = variants.find(value => value.properties.kind.const === "adaptive_step");
  assert.deepEqual(adaptive.properties.review.required, ["candidate_id", "candidate_version", "finding"]);
  assert.equal(adaptive.properties.finalize.required?.includes("unresolved") ?? false, false);
  assert.ok(adaptive.properties.finalize.properties.selected_candidate_version);
  const status = tools.find(tool => tool.name === "reasoning_status").inputSchema;
  assert.deepEqual(status.required, ["run_id"]);
  for (const tool of tools) {
    const schemaText = JSON.stringify(tool.inputSchema);
    assert.equal(schemaText.includes("$ref"), false, `${tool.name} must not emit recursive $ref`);
    assert.ok(tool.description.length <= 512, `${tool.name} description should stay concise`);
  }
});

test("cloud marks rejected artifacts as tool failures and returns actionable review blockers", async t => {
  const DB = database(t);
  let run = (await call(DB, "begin_reasoning", { task: "Calculate 2+2." })).value;
  run = (await submit(DB, run, {
    kind: "adaptive_step", action: "EXPAND", summary: "Candidate.", rationale: "Review next.",
    candidate: { id: "C1", strategy: "addition", answer: "4" }, proposed_action: "FINALIZE",
  })).value;
  const rejected = await submit(DB, run, {
    kind: "adaptive_final", selected_candidate_id: "C1", selected_candidate_version: 1,
  });
  assert.equal(rejected.result.isError, true);
  assert.equal(rejected.value.status, "rejected");
  assert.deepEqual(rejected.value.completion_blockers, ["Selected version needs a targeted model review."]);
  assert.equal((await call(DB, "reasoning_status", { run_id: run.run_id })).value.stage_key, run.stage_key);
});

test("discovery exposes the original three tools and state operations require identity", async t => {
  const DB = database(t);
  assert.deepEqual((await rpc(DB, "server/discover")).value.supportedVersions, ["2026-07-28"]);
  const tools = (await rpc(DB, "tools/list")).value.tools;
  assert.deepEqual(tools.map(tool => tool.name), ["begin_reasoning", "advance_reasoning", "reasoning_status"]);
  assert.match(tools[0].description, /CURRENT user request/);
  assert.match(tools[0].inputSchema.properties.strategy.description, /adaptive_search with task/);
  assert.match((await rpc(DB, "initialize")).value.instructions, /previous invocation does NOT/);
  assert.match((await rpc(DB, "server/discover")).value.instructions, /depth=medium/);
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
    review: { candidate_id: "C1", candidate_version: 2, finding: "The revised arithmetic agrees." },
    resolve_issue: 1,
  })).value;
  run = (await submit(DB, run, {
    kind: "adaptive_final", answer: "2", selected_candidate_id: "C1", selected_candidate_version: 2, unresolved: [],
  })).value;
  assert.equal(run.status, "completed");
  assert.equal(run.budget.revisions_used, 1);
  const history = (await call(DB, "reasoning_status", { run_id: run.run_id, detail: "full" })).value.history;
  assert.equal(history.find(h => h.replaced_candidate).replaced_candidate.answer, "3");
  assert.equal((await call(DB, "reasoning_status", { run_id: run.run_id }, "owner-a", fresh)).value.final.answer, "2");
});

test("omitted strategy starts independent adaptive tasks while fixed cases retain linear compatibility", async t => {
  const DB = database(t);
  let first = (await call(DB, "begin_reasoning", { task: "Compute 1+1." })).value;
  assert.equal(first.action, "EXPAND");
  assert.equal(first.budget.max_steps, 8);
  first = (await submit(DB, first, {
    kind: "adaptive_step", action: "EXPAND", summary: "Addition gives 2.", progress: true,
    rationale: "Ready to summarize.", candidate: { id: "C1", strategy: "addition", answer: "2" },
    proposed_action: "FINALIZE",
  })).value;
  first = (await submit(DB, first, {
    kind: "adaptive_step", action: "CHALLENGE", summary: "Reviewed 1+1.", rationale: "Finish.",
    review: { candidate_id: "C1", candidate_version: 1, finding: "1+1=2." },
    finalize: { selected_candidate_id: "C1", selected_candidate_version: 1 },
  })).value;
  assert.equal(first.status, "completed");
  const second = (await call(DB, "begin_reasoning", { task: "Prior conclusion: 1+1=2. Now add 3." })).value;
  assert.notEqual(second.run_id, first.run_id);
  assert.equal(second.action, "EXPAND");
  assert.equal(second.budget.used_steps, 0);
  assert.equal(second.budget.max_steps, 8);
  assert.equal((await call(DB, "reasoning_status", { run_id: first.run_id })).value.status, "completed");
  const fixed = await call(DB, "begin_reasoning", { case_id: "sched-01" });
  assert.notEqual(fixed.result.isError, true);
  assert.equal(fixed.value.phase, "plan");
  const protocols = DB.sqlite.prepare("SELECT protocol FROM reasoning_runs").all().map(row => row.protocol);
  assert.deepEqual(protocols.sort(), ["adaptive_search", "adaptive_search", "linear"]);
  assert.equal((await call(DB, "begin_reasoning", {
    case_id: "sched-01", strategy: "adaptive_search",
  })).value.code, "INVALID_ARGUMENTS");
});

test("linear workflow survives per-request reconstruction and preserves final reconciliation", async t => {
  const DB = database(t);
  let run = (await call(DB, "begin_reasoning", { task: "Compute (1+1)*2.", strategy: "linear" })).value;
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
  assert.equal(results.filter(r => r.value.action === "CHALLENGE").length, 1);
  const saved = (await call(DB, "reasoning_status", { run_id: run.run_id, detail: "full" })).value;
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
  const other = await call(DB, "begin_reasoning", { task: "Other owner.", strategy: "linear" }, "owner-b");
  assert.equal(other.value.phase, "plan");
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) AS count FROM reasoning_runs WHERE owner_id = 'owner-a'").get().count, 64);
});

test("cloud v0.4 exposes depth/check interfaces, rejects adaptive-only fields for linear and fixed tasks", async t => {
  const DB = database(t);
  assert.equal((await rpc(DB, "initialize")).value.serverInfo.version, "0.4.0");
  const tools = (await rpc(DB, "tools/list")).value.tools;
  assert.ok(tools[0].inputSchema.properties.depth);
  assert.ok(tools[0].inputSchema.properties.checks);
  assert.ok(tools[2].inputSchema.properties.detail);
  for (const argumentsValue of [
    { task: "Legacy.", strategy: "linear", depth: "deep" },
    { case_id: "sched-01", requirements: [] },
  ]) assert.equal((await call(DB, "begin_reasoning", argumentsValue)).value.code, "INVALID_ARGUMENTS");
});

test("cloud service checks execute, repair, and finalize in the reviewed current version", async t => {
  const DB = database(t);
  let run = (await call(DB, "begin_reasoning", {
    task: "Compute 2+2.", depth: "medium",
    requirements: [{ id: "R1", quote: "2+2", method: "internal" }],
    checks: [{ id: "T1", requirement_id: "R1", type: "arithmetic",
      left: { op: "add", left: 2, right: 2 }, right: { path: ["total"] } }],
  })).value;
  run = (await submit(DB, run, {
    kind: "adaptive_step", action: "EXPAND", summary: "Initial answer.", rationale: "Check.",
    candidate: { id: "C1", strategy: "arithmetic", answer: "5", result: { total: 5 } },
  })).value;
  assert.equal(run.action, "REVISE");
  assert.equal(run.verification.results[0].passed, false);
  run = (await submit(DB, run, {
    kind: "adaptive_step", action: "REVISE", summary: "Corrected answer.", rationale: "Recheck.",
    candidate: { id: "C1", strategy: "arithmetic", answer: "4", result: { total: 4 } },
    proposed_action: "FINALIZE",
  })).value;
  assert.equal(run.verification.results[0].passed, true);
  const fresh = (await import("./worker.mjs?service-check-recovery")).default;
  run = (await call(DB, "reasoning_status", { run_id: run.run_id }, "owner-a", fresh)).value;
  run = (await submit(DB, run, {
    kind: "adaptive_step", action: "CHALLENGE", summary: "Reviewed.", rationale: "Finish.",
    review: { candidate_id: "C1", candidate_version: 2, finding: "2+2 agrees with the revised answer." },
    finalize: { selected_candidate_id: "C1", selected_candidate_version: 2 },
  })).value;
  assert.equal(run.status, "completed");
  assert.deepEqual(run.final.result, { total: 4 });
  assert.equal(run.metrics.checks_executed, 2);
});

test("invalid check definitions return actionable input errors without creating runs", async t => {
  const DB = database(t);
  const argumentsValue = {
    task: "Calculate 137*24+89.",
    requirements: [{ id: "R1", quote: "137*24+89", method: "internal" }],
    checks: [{ id: "T1", requirement_id: "R1", type: "arithmetic", expression: "137*24+89" }],
  };
  const invalid = await call(DB, "begin_reasoning", argumentsValue);
  assert.equal(invalid.result.isError, true);
  assert.equal(invalid.value.code, "INVALID_ARGUMENTS");
  assert.match(invalid.value.message, /checks.*left/);
  assert.match(invalid.value.message, /right/);
  assert.match(invalid.value.message, /No run was created/);
  assert.doesNotMatch(invalid.value.message, /Retrieve the saved run/);
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) AS n FROM reasoning_runs").get().n, 0);
  const invalidQuote = await call(DB, "begin_reasoning", {
    task: argumentsValue.task,
    requirements: [{ id: "R1", quote: "absent quote", method: "model" }],
  });
  assert.equal(invalidQuote.value.code, "INVALID_ARGUMENTS");
  assert.match(invalidQuote.value.message, /quote must occur/);
  const invalidNested = await call(DB, "begin_reasoning", {
    ...argumentsValue,
    checks: [{ id: "T1", requirement_id: "R1", type: "arithmetic",
      left: { op: "add", left: "137*24", right: 89 }, right: { path: ["total"] } }],
  });
  assert.equal(invalidNested.value.code, "INVALID_ARGUMENTS");
  assert.match(invalidNested.value.message, /checks.*left/);
  assert.match(invalidNested.value.message, /No run was created/);
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) AS n FROM reasoning_runs").get().n, 0);
  const recovered = await call(DB, "begin_reasoning", {
    ...argumentsValue,
    checks: [{ id: "T1", requirement_id: "R1", type: "arithmetic",
      left: { op: "add", left: { op: "multiply", left: 137, right: 24 }, right: 89 },
      right: { path: ["total"] } }],
  });
  assert.equal(recovered.value.status, "searching");
  assert.equal(recovered.value.verification.checks_declared, 1);
});

test("cloud deep correction persists and completes with an alternative-only comparison", async t => {
  const DB = database(t);
  let run = (await call(DB, "begin_reasoning", {
    task: "Calculate 18*24+75; revise an injected wrong answer.", depth: "deep",
    budget: { max_candidates: 2 },
  })).value;
  for (const artifact of [
    { kind: "adaptive_step", action: "EXPAND", summary: "Injected wrong answer.", rationale: "Controlled test.",
      candidate: { id: "C1", strategy: "injected error", answer: "497", result: { value: 497 } } },
    { kind: "adaptive_step", action: "BRANCH", summary: "Alternative calculation.", rationale: "Compare.",
      candidate: { id: "C2", strategy: "distributive law", answer: "507", result: { value: 507 } } },
    { kind: "adaptive_step", action: "CHALLENGE", summary: "C1 is wrong.", rationale: "Repair C1.",
      review: { candidate_id: "C1", candidate_version: 1, finding: "C1 differs from C2 by 10.",
        compared_candidate_ids: ["C2"] },
      issue: { candidate_id: "C1", state: "error", description: "497 is incorrect." } },
    { kind: "adaptive_step", action: "REVISE", summary: "Corrected to 507.", rationale: "Recheck.",
      candidate: { id: "C1", strategy: "corrected multiplication", answer: "507", result: { value: 507 } },
      resolve_issue: 1 },
  ]) {
    const result = await submit(DB, run, artifact);
    assert.notEqual(result.result.isError, true, JSON.stringify(result.value));
    run = result.value;
  }
  assert.equal(run.action, "VERIFY");
  assert.equal(run.current_candidate.version, 2);
  assert.equal(run.issues[0].resolved, false);
  const fresh = (await import("./worker.mjs?deep-correction-recovery")).default;
  run = (await call(DB, "reasoning_status", { run_id: run.run_id }, "owner-a", fresh)).value;
  const finished = await call(DB, "advance_reasoning", {
    run_id: run.run_id, stage_key: run.stage_key,
    artifact: {
      kind: "adaptive_step", action: "VERIFY", summary: "C1 v2 agrees with C2.", rationale: "Finish.",
      review: { candidate_id: "C1", candidate_version: 2, finding: "18*24+75=507; both methods agree.",
        compared_candidate_ids: ["C2"] },
      resolve_issue: 1,
      finalize: { selected_candidate_id: "C1", selected_candidate_version: 2,
        answer: "507", result: { value: 507 }, unresolved: [] },
    },
  }, "owner-a", fresh);
  assert.notEqual(finished.result.isError, true, JSON.stringify(finished.value));
  assert.equal(finished.value.status, "completed");
  assert.equal(finished.value.final.stop_reason, "ready");
  assert.equal(finished.value.final.selected_candidate_version, 2);
  assert.deepEqual(finished.value.final.unresolved, []);
  const saved = (await call(DB, "reasoning_status", { run_id: run.run_id, detail: "full" })).value;
  assert.equal(saved.status, "completed");
  assert.equal(saved.history.length, 5);
  assert.equal(saved.evidence[0].superseded, true);
  assert.equal(saved.issues[0].resolved_version, 2);
});

test("discovery describes arithmetic operands, result paths and comparison target semantics", async () => {
  const tools = (await rpc(null, "tools/list")).value.tools;
  const begin = tools.find(tool => tool.name === "begin_reasoning").inputSchema;
  const serialized = JSON.stringify(begin.properties.checks);
  assert.match(serialized, /"left"/);
  assert.match(serialized, /"right"/);
  assert.match(serialized, /multiply/);
  assert.match(serialized, /"path"/);
  assert.equal(serialized.includes("$ref"), false);
});

test("maintenance keeps reads and identity checks but blocks both kinds of writes without mutation", async t => {
  const DB = database(t);
  const run = (await call(DB, "begin_reasoning", { task: "Saved task." })).value;
  const readOnly = { ...worker, readOnly: true };
  const stored = DB.sqlite.prepare("SELECT state_json, revision FROM reasoning_runs").get();
  assert.equal((await call(DB, "begin_reasoning", { task: "Blocked." }, "owner-a", readOnly)).value.code, "MAINTENANCE_READ_ONLY");
  assert.equal((await call(DB, "advance_reasoning", {
    run_id: run.run_id, stage_key: run.stage_key, artifact: { kind: "adaptive_final" },
  }, "owner-a", readOnly)).value.code, "MAINTENANCE_READ_ONLY");
  assert.equal((await call(DB, "reasoning_status", { run_id: run.run_id }, "owner-a", readOnly)).value.task, "Saved task.");
  assert.equal((await call(DB, "reasoning_status", { run_id: run.run_id }, "owner-b", readOnly)).value.code, "RUN_MISSING");
  assert.deepEqual(DB.sqlite.prepare("SELECT state_json, revision FROM reasoning_runs").get(), stored);
});

test("cloud legacy adaptive records stay intact when queried or submitted", async t => {
  const DB = database(t);
  const run = (await call(DB, "begin_reasoning", { task: "Old task." })).value;
  const saved = DB.sqlite.prepare("SELECT state_json FROM reasoning_runs").get();
  const legacy = JSON.parse(saved.state_json);
  delete legacy.stateVersion;
  DB.sqlite.prepare("UPDATE reasoning_runs SET state_json = ?").run(JSON.stringify(legacy));
  assert.equal((await call(DB, "reasoning_status", { run_id: run.run_id })).value.legacy_read_only, true);
  assert.equal((await submit(DB, run, { kind: "adaptive_step", action: "EXPAND", summary: "No.", rationale: "No." })).value.status, "rejected");
  assert.equal(DB.sqlite.prepare("SELECT state_json FROM reasoning_runs").get().state_json, JSON.stringify(legacy));
});
