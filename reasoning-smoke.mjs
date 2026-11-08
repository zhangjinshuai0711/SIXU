import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const state = JSON.parse(readFileSync(new URL(".runtime/connection.json", import.meta.url), "utf8"));
const remote = process.argv.includes("--remote");
const client = new Client({ name: "v03-transport-script", version: "0.3.0" });
async function call(name, args) {
  const response = await client.callTool({ name, arguments: args });
  if (response.isError) throw new Error(JSON.stringify(response.content));
  return JSON.parse(response.content.find(item => item.type === "text").text);
}
try {
  await client.connect(new StreamableHTTPClientTransport(new URL(remote ? state.mcp_url : state.local_url)));
  const tools = await client.listTools();
  assert.ok(tools.tools.some(tool => tool.name === "advance_reasoning"));
  let stage = await call("begin_reasoning", { task: "Compute (12+7)*2.", client_tag: "v03-transport-script" });
  async function submit(artifact) {
    stage = await call("advance_reasoning", { run_id: stage.run_id, stage_key: stage.stage_key, artifact });
    return stage;
  }
  await submit({
    kind: "plan", goal: "Evaluate the expression.", constraints: ["Use the stated arithmetic expression."],
    subproblems: [
      { id: "S1", question: "Compute 12+7.", depends_on: [] },
      { id: "S2", question: "Multiply S1 by 2.", depends_on: ["S1"] },
    ],
  });
  await submit({ kind: "solve", subproblem_id: "S1", result: "19", evidence: ["12+7=19"] });
  await submit({ kind: "solve", subproblem_id: "S2", result: "38", evidence: ["19*2=38"] });
  await submit({ kind: "review", checks: [{ constraint_index: 0, finding: "Expression evaluated as stated." }], issues: [] });
  await submit({
    kind: "final", answer: "38", covered_constraint_indices: [0], unresolved: [],
    conclusions: [
      { subproblem_id: "S1", disposition: "confirmed", result: "19", basis: "12+7=19" },
      { subproblem_id: "S2", disposition: "confirmed", result: "38", basis: "19*2=38" },
    ],
  });
  assert.equal(stage.status, "completed");
  assert.equal(stage.canonical_findings.length, 2);
  assert.equal((await call("reasoning_status", { run_id: stage.run_id })).answer, "38");
  console.log(JSON.stringify({
    transport: remote ? "public-https" : "localhost", run_id: stage.run_id,
    phases: "plan -> solve S1 -> solve S2 -> review -> synthesize",
    status: stage.status, verification: stage.verification,
    client: "script, not an LLM reasoning-quality test",
  }, null, 2));
} finally {
  await client.close();
}
