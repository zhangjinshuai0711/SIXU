import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const state = JSON.parse(readFileSync(new URL(".runtime/connection.json", import.meta.url), "utf8"));
const useRemote = process.argv.includes("--remote");
const url = useRemote ? state.mcp_url : state.local_url;
const client = new Client({ name: useRemote ? "remote-smoke-script" : "local-smoke-script", version: "0.1.0" });
const parse = result => {
  if (result.isError) throw new Error(JSON.stringify(result.content));
  return JSON.parse(result.content.find(c => c.type === "text").text);
};
try {
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  const tools = await client.listTools();
  for (const name of ["start", "submit", "status", "begin_reasoning", "advance_reasoning", "reasoning_status"]) {
    assert.ok(tools.tools.some(tool => tool.name === name), `Missing tool: ${name}`);
  }
  const first = parse(await client.callTool({ name: "start", arguments: { client_tag: useRemote ? "remote-smoke-script" : "local-smoke-script" } }));
  const send = (stage, starts, makespan) => client.callTool({
    name: "submit", arguments: { run_id: stage.run_id, stage_key: stage.stage_key, starts, makespan },
  }).then(parse);
  assert.equal((await send(first, { A: 0, B: 0, C: 2, D: 4 }, 5)).status, "rejected");
  const second = await send(first, { A: 0, B: 2, C: 2, D: 5 }, 6);
  assert.equal(second.status, "accepted");
  assert.equal((await send(second, { A: 0, B: 2, C: 2, D: 5 }, 6)).status, "rejected");
  const b = second.earliest_start_B;
  assert.equal((await send(second, { A: 0, B: b, C: 2, D: b + 3 }, b + 4)).status, "completed");
  const status = parse(await client.callTool({ name: "status", arguments: { run_id: first.run_id } }));
  assert.equal(status.completed, true);
  console.log(JSON.stringify({
    transport: useRemote ? "public-https" : "localhost", tools: tools.tools.map(t => t.name),
    completed_phases: status.completed_phases, submissions: status.submissions.length,
    injected_rejections: status.submissions.filter(s => !s.accepted).length,
    run_id: first.run_id, client: "script, not ChatGPT or an LLM",
  }, null, 2));
} finally {
  await client.close();
}
