export function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function health(url, fetchImpl, timeoutMs) {
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return { reachable: false, error: `HTTP_${response.status}` };
    const body = await response.json();
    if (body?.ok !== true || body.service !== "reasoning-harness-probe")
      return { reachable: false, error: "UNEXPECTED_HEALTH_RESPONSE" };
    return { reachable: true, version: body.version };
  } catch (error) {
    // Exception messages can include the capability URL; return only stable error codes.
    const code = error.cause?.code || error.name;
    return { reachable: false, error: /^[A-Z_0-9]+$/.test(code || "") ? code : "CONNECTION_FAILED" };
  }
}

export async function checkConnection(state, {
  fetchImpl = fetch, isAlive = processAlive, timeoutMs = 5000,
} = {}) {
  if (!state) return { healthy: false, diagnosis: "not_started" };
  const server_running = isAlive(state.server_pid);
  const tunnel_running = isAlive(state.tunnel_pid);
  const [local, publicCheck] = await Promise.all([
    health(new URL("/health", state.local_url), fetchImpl, timeoutMs),
    health(new URL("/health", state.mcp_url), fetchImpl, timeoutMs),
  ]);
  const healthy = server_running && tunnel_running && local.reachable && publicCheck.reachable;
  const diagnosis = healthy ? "reachable_from_this_machine"
    : !server_running || !local.reachable ? "local_service_unavailable"
    : !tunnel_running ? "tunnel_process_stopped"
    : "public_connection_unavailable";
  return {
    healthy, server_running, tunnel_running, local,
    public_from_this_machine: publicCheck, diagnosis,
    host_plugin_verified: false,
    ...(healthy ? {} : {
      next_action: diagnosis === "public_connection_unavailable"
        ? "Check VPN/proxy routing and .runtime/tunnel.log. An alive tunnel process does not prove connectivity. Do not rotate its URL silently."
        : "Check the local service and tunnel logs before starting again.",
    }),
  };
}
