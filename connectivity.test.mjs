import { test } from "node:test";
import assert from "node:assert/strict";
import { checkConnection, processAlive } from "./connectivity.mjs";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { spawn } from "node:child_process";

const state = {
  server_pid: 11, tunnel_pid: 12,
  local_url: "http://127.0.0.1:1234/private-token/mcp",
  mcp_url: "https://example.test/private-token/mcp",
};
const healthyResponse = () => Response.json({
  ok: true, service: "reasoning-harness-probe", version: "0.2.1",
});

test("alive processes do not hide an unreachable public tunnel after a network change", async () => {
  const result = await checkConnection(state, {
    isAlive: () => true,
    fetchImpl: async url => {
      if (url.hostname === "127.0.0.1") return healthyResponse();
      throw new TypeError("Connection failed: private-token", { cause: { code: "ECONNRESET" } });
    },
  });
  assert.equal(result.healthy, false);
  assert.equal(result.local.reachable, true);
  assert.equal(result.public_from_this_machine.error, "ECONNRESET");
  assert.equal(result.diagnosis, "public_connection_unavailable");
  assert.equal(JSON.stringify(result).includes("private-token"), false);
});

test("a subsequent check observes recovery without rotating the capability URL", async () => {
  const visited = [];
  const result = await checkConnection(state, {
    isAlive: () => true,
    fetchImpl: async url => { visited.push(url.href); return healthyResponse(); },
  });
  assert.equal(result.healthy, true);
  assert.equal(result.host_plugin_verified, false);
  assert.deepEqual(visited.sort(), ["http://127.0.0.1:1234/health", "https://example.test/health"]);
  assert.equal(state.mcp_url, "https://example.test/private-token/mcp");
});

test("local failure and a gateway's unrelated success page are distinguished", async () => {
  const localFailure = await checkConnection(state, {
    isAlive: pid => pid !== 11, fetchImpl: async () => healthyResponse(),
  });
  assert.equal(localFailure.diagnosis, "local_service_unavailable");
  const gateway = await checkConnection(state, {
    isAlive: () => true, fetchImpl: async () => Response.json({ ok: true }),
  });
  assert.equal(gateway.healthy, false);
  assert.equal(gateway.public_from_this_machine.error, "UNEXPECTED_HEALTH_RESPONSE");
  assert.equal(processAlive(undefined), false);
});

test("launcher refuses an unhealthy existing connection and doctor exits nonzero without leaking its URL", async t => {
  const dir = mkdtempSync(join(tmpdir(), "sixu-connectivity-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const file of ["launch.mjs", "connectivity.mjs"])
    cpSync(new URL(file, import.meta.url), join(dir, file));
  mkdirSync(join(dir, ".runtime"));
  const local = createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "reasoning-harness-probe", version: "0.2.1" }));
  });
  const remote = createServer((req, res) => { res.writeHead(503).end(); });
  for (const server of [local, remote]) {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
  }
  writeFileSync(join(dir, ".runtime/connection.json"), JSON.stringify({
    ...state, server_pid: process.pid, tunnel_pid: process.pid,
    local_url: `http://127.0.0.1:${local.address().port}/private-token/mcp`,
    mcp_url: `http://127.0.0.1:${remote.address().port}/private-token/mcp`,
  }));
  for (const args of [[], ["doctor"]]) {
    const child = spawn(process.execPath, ["launch.mjs", ...args], { cwd: dir });
    let output = "";
    child.stdout.on("data", data => { output += data; });
    child.stderr.on("data", data => { output += data; });
    const code = await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", resolve);
    });
    assert.equal(code, 1);
    assert.equal(JSON.parse(output).diagnosis, "public_connection_unavailable");
    assert.equal(output.includes("private-token"), false);
  }
});
