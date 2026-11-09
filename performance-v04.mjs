import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { createAdaptiveEngine } from "./adaptive-core.mjs";

const records = new Map();
const engine = createAdaptiveEngine({ store: {
  owns: runId => records.has(runId), load: runId => records.get(runId), save: run => records.set(run.id, run),
} });
const bytes = value => Buffer.byteLength(JSON.stringify(value));
const description = "A concrete finding checked against the original problem. ".repeat(20);
let state = engine.start({ task: "Compare plans with total 90 minutes. ".repeat(100), auto_upgrade: false, budget: { max_steps: 8 } });
let compactBytes = 0;
let fullBytes = 0;
const started = performance.now();
for (let stepNumber = 1; stepNumber <= 8; stepNumber++) {
  const artifact = {
    kind: "adaptive_step", action: state.action, summary: description, rationale: description,
    proposed_action: "CHALLENGE",
    ...(stepNumber === 1 ? { candidate: { id: "C1", strategy: description, answer: description } } :
      { review: { candidate_id: "C1", candidate_version: 1, finding: `${description}Check ${stepNumber}.` } }),
  };
  state = engine.submit({ run_id: state.run_id, stage_key: state.stage_key, artifact });
  assert.notEqual(state.status, "rejected", JSON.stringify(state.errors));
  compactBytes += bytes(state);
  fullBytes += bytes(engine.status(state.run_id, { detail: "full" }));
}
const reduction = 1 - compactBytes / fullBytes;
assert.ok(reduction >= 0.4, `Compact response reduction ${reduction} is below 40%.`);
assert.equal(engine.status(state.run_id, { detail: "full" }).history.length, 8);
function completionReplay(combined) {
  let run = engine.start({ task: "Calculate 2+2." });
  const submit = artifact => engine.submit({ run_id: run.run_id, stage_key: run.stage_key, artifact });
  run = submit({ kind: "adaptive_step", action: "EXPAND", summary: "Construct.", rationale: "Review.",
    candidate: { id: "C1", strategy: "addition", answer: "4" } });
  const selection = { selected_candidate_id: "C1", selected_candidate_version: 1 };
  run = submit({ kind: "adaptive_step", action: "CHALLENGE", summary: "Reviewed.", rationale: "Finish.",
    review: { candidate_id: "C1", candidate_version: 1, finding: "2+2=4." }, proposed_action: "FINALIZE",
    ...(combined ? { finalize: selection } : {}) });
  if (!combined) run = submit({ kind: "adaptive_final", ...selection });
  assert.equal(run.status, "completed");
  return run;
}
const combined = completionReplay(true);
const separate = completionReplay(false);
assert.deepEqual(combined.final, separate.final);
assert.equal(separate.metrics.accepted_responses - combined.metrics.accepted_responses, 1);
console.log(JSON.stringify({
  version: "0.4.0", kind: "deterministic_eight_step_replay", steps: 8,
  compact_bytes: compactBytes, full_bytes: fullBytes, reduction_percent: Number((reduction * 100).toFixed(2)),
  local_replay_ms: Number((performance.now() - started).toFixed(2)),
  combined_round_trips: combined.metrics.accepted_responses,
  separate_round_trips: separate.metrics.accepted_responses,
  scope: "Same persisted v0.4 state, compact versus full; not ChatGPT latency or model quality.",
}, null, 2));
