import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import worker from "../dist/server/index.js";

test("actual Worker bundle completes deep reasoning with internal checks and persistent recovery", async context => {
  const sqlite = new DatabaseSync(":memory:");
  context.after(() => sqlite.close());
  sqlite.exec(readFileSync(new URL("../drizzle/0000_reasoning_runs.sql", import.meta.url), "utf8"));
  const DB = {
    prepare(sql) {
      let values = [];
      return {
        bind(...argumentsValue) { values = argumentsValue; return this; },
        async first() { return sqlite.prepare(sql).get(...values); },
        async run() { return { meta: { changes: sqlite.prepare(sql).run(...values).changes } }; },
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
  async function call(name, argumentsValue) {
    const response = await worker.fetch(new Request("https://bundle.test/mcp", {
      method: "POST", headers: { "oai-authenticated-user-id": "bundle-owner" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: argumentsValue } }),
    }), { DB });
    const { result } = await response.json();
    assert.notEqual(result.isError, true, JSON.stringify(result));
    return JSON.parse(result.content[0].text);
  }
  let state = await call("begin_reasoning", {
    task: "Calculate 137*24+89.", depth: "deep",
    requirements: [{ id: "R1", quote: "137*24+89", method: "internal" }],
    checks: [{ id: "T1", requirement_id: "R1", type: "arithmetic",
      left: { op: "add", left: { op: "multiply", left: 137, right: 24 }, right: 89 },
      right: { path: ["total"] } }],
  });
  for (const artifact of [
    { kind: "adaptive_step", action: "EXPAND", summary: "Add.", rationale: "Construct.",
      candidate: { id: "C1", strategy: "multiplication then addition", answer: "3377", result: { total: 3377 } } },
    { kind: "adaptive_step", action: "BRANCH", summary: "Alternative.", rationale: "Compare.",
      candidate: { id: "C2", strategy: "distributive law", answer: "3377", result: { total: 3377 } } },
    { kind: "adaptive_step", action: "CHALLENGE", summary: "Comparison.", rationale: "Finish.",
      review: { candidate_id: "C1", candidate_version: 1, finding: "Both methods agree with 3377.", compared_candidate_ids: ["C2"] },
      finalize: { selected_candidate_id: "C1", selected_candidate_version: 1 } },
  ]) state = await call("advance_reasoning", { run_id: state.run_id, stage_key: state.stage_key, artifact });
  assert.equal(state.status, "completed");
  assert.equal(state.depth.actual, "deep");
  assert.equal(state.final.verification_status, "declared_checks_passed");
  assert.equal(state.final.result.total, 3377);
  assert.equal(state.metrics.checks_executed, 2);
  assert.equal(state.service_version, "0.4.0");
  assert.equal((await call("reasoning_status", { run_id: state.run_id, detail: "full" })).history.length, 3);
});
