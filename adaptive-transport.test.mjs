import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

test("MCP transport exposes adaptive workflow and recovers its state after a server restart", async t => {
  const dir = mkdtempSync(join(tmpdir(), "sixu-http-"));
  for (const file of ["server.mjs", "reasoning.mjs", "reasoning-tools.mjs", "adaptive.mjs", "adaptive-core.mjs", "verification.mjs", "probe.mjs", "cases.mjs", "package.json"])
    cpSync(new URL(file, import.meta.url), join(dir, file));
  symlinkSync(fileURLToPath(new URL("node_modules", import.meta.url)), join(dir, "node_modules"));
  const port = await new Promise((resolve, reject) => {
    const socket = createServer();
    socket.on("error", reject);
    socket.listen(0, "127.0.0.1", () => { const p = socket.address().port; socket.close(() => resolve(p)); });
  });
  const token = "a".repeat(48);
  let child;
  async function stop() {
    if (child && child.exitCode === null) {
      const exited = new Promise(resolve => child.once("exit", resolve));
      child.kill("SIGTERM");
      await exited;
    }
  }
  t.after(async () => { await stop(); rmSync(dir, { recursive: true, force: true }); });
  async function start() {
    child = spawn(process.execPath, ["server.mjs"], {
      cwd: dir, env: { ...process.env, HARNESS_PROBE_TOKEN: token, HARNESS_PROBE_PORT: String(port) },
      stdio: "ignore",
    });
    for (let i = 0; i < 50; i++) {
      try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return; } catch {}
      if (child.exitCode !== null) throw new Error("Test server exited.");
      await delay(50);
    }
    throw new Error("Test server did not start.");
  }
  async function connect() {
    const client = new Client({ name: "adaptive-test", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/${token}/mcp`)));
    return client;
  }
  async function call(client, name, args) {
    const result = await client.callTool({ name, arguments: args });
    assert.notEqual(result.isError, true, JSON.stringify(result.content));
    return JSON.parse(result.content.find(item => item.type === "text").text);
  }
  await start();
  let client = await connect();
  assert.ok((await client.listTools()).tools.find(tool => tool.name === "begin_reasoning"));
  assert.match(client.getInstructions(), /previous invocation does NOT/);
  const linear = await call(client, "begin_reasoning", { task: "Legacy workflow.", strategy: "linear" });
  assert.equal(linear.phase, "plan");
  let run = await call(client, "begin_reasoning", { task: "Calculate 1+1." });
  run = await call(client, "advance_reasoning", {
    run_id: run.run_id, stage_key: run.stage_key,
    artifact: { kind: "adaptive_step", action: "EXPAND", summary: "1+1=2.", progress: true,
      rationale: "A candidate is available.", candidate: { id: "C1", strategy: "addition", answer: "2" },
      proposed_action: "FINALIZE" },
  });
  assert.equal(run.action, "CHALLENGE");
  await client.close();
  await stop();
  await start();
  client = await connect();
  const restored = await call(client, "reasoning_status", { run_id: run.run_id });
  assert.equal(restored.stage_key, run.stage_key);
  const done = await call(client, "advance_reasoning", {
    run_id: restored.run_id, stage_key: restored.stage_key,
    artifact: { kind: "adaptive_step", action: "CHALLENGE", summary: "Checked current version.",
      rationale: "Ready to finish.", review: { candidate_id: "C1", candidate_version: 1, finding: "1+1=2." },
      finalize: { selected_candidate_id: "C1", selected_candidate_version: 1 } },
  });
  assert.equal(done.status, "completed");
  await client.close();
});
