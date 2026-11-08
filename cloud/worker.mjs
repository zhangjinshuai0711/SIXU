import { z } from "zod";
import { createAdaptiveEngine } from "../adaptive-core.mjs";
import { createReasoning } from "../reasoning.mjs";
import { registerReasoningTools } from "../reasoning-tools.mjs";

const VERSION = "0.3.0";
const TTL = 2 * 60 * 60 * 1000;
const MAX_BYTES = 65536;
const toolRegistry = new Map();
registerReasoningTools({
  registerTool(name, config) {
    const schema = z.object(config.inputSchema);
    toolRegistry.set(name, {
      schema,
      definition: {
        name, description: config.description, annotations: config.annotations,
        inputSchema: z.toJSONSchema(schema, { target: "draft-7" }),
      },
    });
  },
});

const content = value => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
const failure = (code, message) => ({ ...content({ code, message }), isError: true });
const json = (body, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "no-store" },
});

async function callTool(name, args, owner, db) {
  const tool = toolRegistry.get(name);
  if (!tool) return failure("UNKNOWN_TOOL", "Unknown tool.");
  const parsed = tool.schema.safeParse(args ?? {});
  if (!parsed.success) return failure("INVALID_ARGUMENTS", parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  if (!owner) return failure("AUTH_REQUIRED", "Authenticated Sites identity required.");
  if (!db) return failure("STORAGE_UNAVAILABLE", "Cloud state storage is not configured.");
  const input = parsed.data;
  const now = Date.now();
  let previous;
  if (name !== "begin_reasoning") {
    previous = await db.prepare(
      "SELECT protocol, state_json, revision FROM reasoning_runs WHERE owner_id = ? AND run_id = ? AND expires_at > ?",
    ).bind(owner, input.run_id, now).first();
    if (!previous) return failure("RUN_MISSING", "Run missing, expired, or not owned by the current user.");
  }
  const adaptiveRuns = new Map();
  const linearRuns = new Map();
  if (previous) {
    const state = JSON.parse(previous.state_json);
    (previous.protocol === "adaptive_search" ? adaptiveRuns : linearRuns).set(state.id, state);
  }
  const adaptive = createAdaptiveEngine({
    store: {
      owns: id => adaptiveRuns.has(id),
      load: id => adaptiveRuns.get(id),
      save: run => adaptiveRuns.set(run.id, run),
    },
  });
  const linear = createReasoning({ runs: linearRuns });
  let output;
  if (name === "begin_reasoning") {
    if (input.case_id && input.task)
      return failure("INVALID_ARGUMENTS", "Supply task or case_id, not both.");
    if (!input.case_id && !input.task?.trim())
      return failure("INVALID_ARGUMENTS", "Supply a nonempty task up to 12000 characters.");
    if (input.feedback === "objective" && !input.case_id)
      return failure("INVALID_ARGUMENTS", "Objective feedback is supported only for the fixed benchmark case.");
    if (input.strategy === "adaptive_search") {
      if (input.case_id) return failure("INVALID_ARGUMENTS", "Adaptive search requires task, not case_id.");
      output = adaptive.start(input);
    } else {
      if (input.budget) return failure("INVALID_ARGUMENTS", "Custom budget is supported only for adaptive_search.");
      output = linear.start(input);
    }
  } else {
    const engine = previous.protocol === "adaptive_search" ? adaptive : linear;
    output = name === "reasoning_status" ? engine.status(input.run_id) : engine.submit(input);
  }
  if (name === "reasoning_status") return content(output);
  const protocol = previous?.protocol ?? input.strategy;
  const run = (protocol === "adaptive_search" ? adaptiveRuns : linearRuns).get(output.run_id);
  const stateJson = JSON.stringify(run);
  if (new TextEncoder().encode(stateJson).length > 1024 * 1024)
    return failure("STATE_LIMIT", "Run exceeds the cloud storage limit; retrieve the last saved state.");
  if (!previous) {
    const saved = await db.batch([
      db.prepare("DELETE FROM reasoning_runs WHERE owner_id = ? AND expires_at <= ?").bind(owner, now),
      db.prepare(
        "INSERT INTO reasoning_runs (owner_id, run_id, protocol, state_json, revision, expires_at, updated_at) SELECT ?, ?, ?, ?, 0, ?, ? WHERE (SELECT COUNT(*) FROM reasoning_runs WHERE owner_id = ? AND expires_at > ?) < 64",
      ).bind(owner, run.id, protocol, stateJson, run.createdAt + TTL, now, owner, now),
    ]);
    if (saved[1].meta.changes !== 1)
      return failure("RUN_LIMIT", "At most 64 unexpired runs are allowed per user.");
  } else if (stateJson !== previous.state_json) {
    const saved = await db.prepare(
      "UPDATE reasoning_runs SET state_json = ?, revision = revision + 1, updated_at = ? WHERE owner_id = ? AND run_id = ? AND revision = ?",
    ).bind(stateJson, now, owner, run.id, previous.revision).run();
    if (saved.meta.changes !== 1)
      return failure("STATE_CONFLICT", "Another request updated this run. Call reasoning_status before continuing.");
  }
  return content(output);
}

async function readRpc(request) {
  if (Number(request.headers.get("content-length")) > MAX_BYTES) throw new Error("REQUEST_TOO_LARGE");
  const reader = request.body?.getReader();
  const chunks = [];
  let size = 0;
  if (!reader) throw new Error("INVALID_JSON");
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) throw new Error("REQUEST_TOO_LARGE");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/health" && request.method === "GET") {
      try {
        await env.DB.prepare("SELECT 1 FROM reasoning_runs LIMIT 1").first();
        return json({ ok: true, service: "reasoning-harness-probe", version: VERSION, deployment: "private-cloud" });
      } catch {
        return json({ ok: false, code: "STORAGE_UNAVAILABLE" }, 503);
      }
    }
    if (pathname === "/" && request.method === "GET")
      return json({ service: "思序 · Reasoning", version: VERSION, transport: "private-cloud-mcp" });
    if (pathname !== "/mcp") return json({ error: "Not found." }, 404);
    if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
    let rpc;
    try { rpc = await readRpc(request); } catch (error) {
      return json({ jsonrpc: "2.0", id: null, error: {
        code: -32700, message: error.message === "REQUEST_TOO_LARGE" ? "Request too large." : "Invalid JSON.",
      } }, error.message === "REQUEST_TOO_LARGE" ? 413 : 400);
    }
    if (!rpc || rpc.jsonrpc !== "2.0" || typeof rpc.method !== "string")
      return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request." } }, 400);
    if (rpc.method === "notifications/initialized") return new Response(null, { status: 202 });
    const id = rpc.id ?? null;
    let result;
    if (rpc.method === "server/discover")
      result = { supportedVersions: ["2026-07-28"], capabilities: { tools: {} } };
    else if (rpc.method === "initialize")
      result = { protocolVersion: "2025-03-26", capabilities: { tools: {} },
        serverInfo: { name: "reasoning-harness-cloud", version: VERSION } };
    else if (rpc.method === "ping") result = {};
    else if (rpc.method === "tools/list") result = { tools: [...toolRegistry.values()].map(t => t.definition) };
    else if (rpc.method === "tools/call") {
      try {
        result = await callTool(rpc.params?.name, rpc.params?.arguments,
          request.headers.get("oai-authenticated-user-id"), env.DB);
      } catch {
        result = failure("TOOL_FAILED", "The request could not be completed. Retrieve the saved run with reasoning_status before retrying. If a begin request lost its response, do not assume a run was created.");
      }
    } else return json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found." } });
    return json({ jsonrpc: "2.0", id, result });
  },
};
