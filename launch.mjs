import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "node:net";
import { checkConnection, processAlive as alive } from "./connectivity.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const runtime = `${root}.runtime/`;
const statePath = `${runtime}connection.json`;
mkdirSync(runtime, { recursive: true, mode: 0o700 });
const old = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : null;
if (process.argv[2] === "stop") {
  for (const pid of [old?.tunnel_pid, old?.server_pid]) if (pid && alive(pid)) process.kill(pid, "SIGTERM");
  console.log("Probe services stopped.");
} else if (process.argv[2] === "status") {
  console.log(JSON.stringify(old ? {
    ...old, ...await checkConnection(old),
  } : { running: false }, null, 2));
} else if (process.argv[2] === "doctor") {
  const connection = await checkConnection(old);
  console.log(JSON.stringify(connection, null, 2));
  if (!connection.healthy) process.exitCode = 1;
} else if (process.argv[2] === "restart") {
  if (!old || !alive(old.tunnel_pid)) throw new Error("An active tunnel is required to preserve the current address.");
  if (alive(old.server_pid)) process.kill(old.server_pid, "SIGTERM");
  for (let attempt = 0; attempt < 40 && alive(old.server_pid); attempt++) await delay(100);
  if (alive(old.server_pid)) throw new Error("Previous server has not exited.");
  const token = new URL(old.local_url).pathname.split("/")[1];
  const log = openSync(`${runtime}server.log`, "a", 0o600);
  const server = spawn(process.execPath, ["server.mjs"], {
    cwd: root, detached: true, stdio: ["ignore", log, log],
    env: { ...process.env, HARNESS_PROBE_TOKEN: token, HARNESS_PROBE_PORT: String(old.port) },
  });
  server.unref();
  const state = { ...old, server_pid: server.pid, restarted_at: new Date().toISOString() };
  writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
  let healthy = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { healthy = (await fetch(`http://127.0.0.1:${old.port}/health`)).ok; } catch {}
    if (healthy) break;
    await delay(150);
  }
  if (!healthy) throw new Error("Updated server did not become healthy; inspect .runtime/server.log.");
  console.log(JSON.stringify({
    restarted: true, address_preserved: true, ...await checkConnection(state),
  }, null, 2));
} else if (old && alive(old.server_pid) && alive(old.tunnel_pid)) {
  const connection = await checkConnection(old);
  if (!connection.healthy) {
    console.error(JSON.stringify(connection, null, 2));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify(old, null, 2));
  }
} else {
  if (old && [old.server_pid, old.tunnel_pid].some(alive)) {
    throw new Error("Partial previous run exists. Run npm run stop before restarting.");
  }
  const port = await new Promise((resolve, reject) => {
    const socket = createServer();
    socket.on("error", reject);
    socket.listen(0, "127.0.0.1", () => {
      const chosen = socket.address().port;
      socket.close(() => resolve(chosen));
    });
  });
  const token = randomBytes(24).toString("hex");
  const log = openSync(`${runtime}server.log`, "a", 0o600);
  const server = spawn(process.execPath, ["server.mjs"], {
    cwd: root, detached: true, stdio: ["ignore", log, log],
    env: { ...process.env, HARNESS_PROBE_TOKEN: token, HARNESS_PROBE_PORT: String(port) },
  });
  server.unref();
  let tunnel;
  try {
    let healthy = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      try { healthy = (await fetch(`http://127.0.0.1:${port}/health`)).ok; } catch {}
      if (healthy) break;
      await delay(200);
    }
    if (!healthy) throw new Error("Local service failed to start; inspect .runtime/server.log.");
    const tunnelLog = `${runtime}tunnel.log`;
    writeFileSync(tunnelLog, "", { mode: 0o600 });
    const out = openSync(tunnelLog, "a", 0o600);
    tunnel = spawn("cloudflared", ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`], {
      cwd: root, detached: true, stdio: ["ignore", out, out],
    });
    tunnel.unref();
    let baseUrl;
    for (let attempt = 0; attempt < 100; attempt++) {
      baseUrl = readFileSync(tunnelLog, "utf8").match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0];
      if (baseUrl) break;
      if (!alive(tunnel.pid)) throw new Error("Tunnel exited; inspect .runtime/tunnel.log.");
      await delay(300);
    }
    if (!baseUrl) throw new Error("Tunnel did not return an address.");
    let registered = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      registered = readFileSync(tunnelLog, "utf8").includes("Registered tunnel connection");
      if (registered) break;
      if (!alive(tunnel.pid)) throw new Error("Tunnel exited before registration; inspect .runtime/tunnel.log.");
      await delay(300);
    }
    if (!registered) throw new Error("Tunnel did not register within 30 seconds; inspect .runtime/tunnel.log.");
    const state = {
      created_at: new Date().toISOString(), server_pid: server.pid, tunnel_pid: tunnel.pid,
      port, local_url: `http://127.0.0.1:${port}/${token}/mcp`,
      mcp_url: `${baseUrl}/${token}/mcp`,
      note: "Temporary capability URL for non-sensitive test data only. Keep it private. Stop/start creates a new address; restart preserves an active tunnel.",
    };
    writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
    chmodSync(statePath, 0o600);
    const connection = await checkConnection(state);
    if (connection.healthy) {
      console.log(JSON.stringify(state, null, 2));
    } else {
      console.error(JSON.stringify({ ...connection, connection_saved: true }, null, 2));
      process.exitCode = 1;
    }
  } catch (error) {
    for (const pid of [tunnel?.pid, server.pid]) if (pid && alive(pid)) process.kill(pid, "SIGTERM");
    throw error;
  }
}
