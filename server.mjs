import { createServer } from "node:http";
import { appendFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { createProbe } from "./probe.mjs";
import { createReasoning } from "./reasoning.mjs";
import { registerReasoningTools } from "./reasoning-tools.mjs";

const runtime = fileURLToPath(new URL(".runtime/", import.meta.url));
mkdirSync(runtime, { recursive: true, mode: 0o700 });
const secret = process.env.HARNESS_PROBE_TOKEN;
if (!secret || !/^[a-f0-9]{48}$/.test(secret)) throw new Error("Missing probe endpoint token.");
const port = Number(process.env.HARNESS_PROBE_PORT || 8788);
const endpointPath = `/${secret}/mcp`;
function audit(event) {
  appendFileSync(`${runtime}events.jsonl`, JSON.stringify({ at: new Date().toISOString(), ...event }) + "\n", { mode: 0o600 });
}
const probe = createProbe({ onEvent: audit });
const reasoning = createReasoning({ onEvent: audit });
const reply = value => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
function makeMcp() {
  const mcp = new McpServer({ name: "reasoning-harness-probe", version: "0.1.0" });
  registerReasoningTools(mcp, reasoning);
  mcp.registerTool("start", {
    description: "Start a two-phase scheduling experiment. Solve the returned problem, submit the answer, then solve the new constraint returned by submit. Continue until completed or a tool error blocks progress. No LLM API is called by this server.",
    inputSchema: { client_tag: z.string().max(80).optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ client_tag }) => reply(probe.start(client_tag)));
  mcp.registerTool("submit", {
    description: "Check a candidate schedule against fixed constraints and an exhaustive optimum. A rejection leaves the phase unchanged; acceptance returns the next phase. Follow next_action, call submit again when required, and do not claim completion until status is completed.",
    inputSchema: {
      run_id: z.string().uuid(), stage_key: z.string().uuid(),
      starts: z.object({ A: z.number().int().min(0).max(16), B: z.number().int().min(0).max(16), C: z.number().int().min(0).max(16), D: z.number().int().min(0).max(16) }),
      makespan: z.number().int().min(0).max(20),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async args => reply(probe.submit(args)));
  mcp.registerTool("status", {
    description: "Read the current phase and recorded submissions for one run. This does not advance the experiment.",
    inputSchema: { run_id: z.string().uuid() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ run_id }) => reply(probe.status(run_id)));
  return mcp;
}

const http = createServer(async (req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  if (path === "/health" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "reasoning-harness-probe", version: "0.1.0" }));
    return;
  }
  if (path !== endpointPath) { res.writeHead(404).end(); return; }
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST" }).end();
    return;
  }
  let mcp;
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 65536) { res.writeHead(413).end(); return; }
      chunks.push(chunk);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    audit({
      event: "rpc", method: body.method,
      ...(body.method === "initialize" ? { client_info: body.params?.clientInfo } : {}),
      ...(body.method === "tools/call" ? { tool: body.params?.name } : {}),
    });
    mcp = makeMcp();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.once("close", () => { void mcp.close(); });
    await mcp.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch {
    if (!res.headersSent) res.writeHead(400, { "Content-Type": "application/json" });
    if (!res.writableEnded) res.end(JSON.stringify({ error: "Invalid MCP request." }));
    if (mcp) await mcp.close();
  }
});
http.requestTimeout = 15000;
http.listen(port, "127.0.0.1", () => audit({ event: "server_started", port }));
process.on("SIGTERM", () => http.close(() => process.exit(0)));
