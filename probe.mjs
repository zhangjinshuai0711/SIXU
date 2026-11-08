import { randomInt, randomUUID } from "node:crypto";

export const tasks = Object.freeze([
  Object.freeze({ id: "A", duration: 2, resource: 2, after: [] }),
  Object.freeze({ id: "B", duration: 3, resource: 2, after: [] }),
  Object.freeze({ id: "C", duration: 2, resource: 1, after: ["A"] }),
  Object.freeze({ id: "D", duration: 1, resource: 2, after: ["B", "C"] }),
]);

export function validate(candidate, releaseB) {
  const errors = [];
  const starts = candidate.starts;
  if (!starts || tasks.some(t => !Number.isInteger(starts[t.id]) ||
      starts[t.id] < 0 || starts[t.id] > 16)) {
    return ["Each start must be an integer from 0 to 16."];
  }
  if (starts.B < releaseB) errors.push(`B cannot start before ${releaseB}.`);
  for (const task of tasks) {
    for (const dependency of task.after) {
      const parent = tasks.find(t => t.id === dependency);
      if (starts[task.id] < starts[dependency] + parent.duration) {
        errors.push(`${task.id} must wait for ${dependency} to finish.`);
      }
    }
  }
  const makespan = Math.max(...tasks.map(t => starts[t.id] + t.duration));
  for (let time = 0; time < makespan; time++) {
    const load = tasks.filter(t => starts[t.id] <= time &&
      time < starts[t.id] + t.duration).reduce((sum, t) => sum + t.resource, 0);
    if (load > 3) errors.push(`Resource load ${load} exceeds 3 at [${time},${time + 1}).`);
  }
  if (candidate.makespan !== makespan) errors.push(`Declared makespan must be ${makespan}.`);
  return errors;
}

export function findOptimum(releaseB) {
  let best = Infinity;
  // A=0, C=2, B=max(2, releaseB), D=B+3 is feasible and finishes by 10.
  // Consequently an optimum has all starts <= 10.
  for (let A = 0; A <= 10; A++) for (let B = 0; B <= 10; B++) {
    for (let C = 0; C <= 10; C++) for (let D = 0; D <= 10; D++) {
      const candidate = { starts: { A, B, C, D }, makespan: Math.max(A + 2, B + 3, C + 2, D + 1) };
      if (candidate.makespan < best && validate(candidate, releaseB).length === 0) {
        best = candidate.makespan;
      }
    }
  }
  return best;
}

export function createProbe({ onEvent = () => {}, ttlMs = 2 * 60 * 60 * 1000 } = {}) {
  const runs = new Map();
  const optima = new Map();
  function stage(run) {
    return {
      run_id: run.id,
      stage_key: run.stageKey,
      phase: run.phase === 0 ? "base" : "changed_constraint",
      tasks,
      resource_capacity: 3,
      earliest_start_B: run.phase === 0 ? 0 : run.releaseB,
      rules: "Minimize makespan. Starts are nonnegative integers <=16. Tasks cannot be interrupted. Resources are occupied on [start,start+duration). Dependencies must finish before a task starts.",
      next_action: "Solve this phase, then call submit with run_id, stage_key, starts, and makespan. A text answer alone does not complete the experiment.",
    };
  }
  function lookup(id) {
    const run = runs.get(id);
    if (!run || Date.now() - run.createdAt > ttlMs) throw new Error("Run missing or expired; call start.");
    return run;
  }
  return {
    start(clientTag = "unspecified") {
      for (const [id, run] of runs) if (Date.now() - run.createdAt > ttlMs) runs.delete(id);
      if (runs.size >= 64) throw new Error("Run limit reached.");
      const run = {
        id: randomUUID(), stageKey: randomUUID(), phase: 0,
        releaseB: randomInt(3, 7), createdAt: Date.now(), attempts: [],
        clientTag,
      };
      runs.set(run.id, run);
      onEvent({ event: "run_started", run_id: run.id, client_tag: clientTag });
      return stage(run);
    },
    submit({ run_id, stage_key, starts, makespan }) {
      const run = lookup(run_id);
      if (run.phase === 2) return { status: "completed", run_id };
      if (stage_key !== run.stageKey) return { status: "stale_stage", ...stage(run) };
      if (run.attempts.length >= 12) return { status: "stopped", reason: "12-submission limit reached." };
      const releaseB = run.phase === 0 ? 0 : run.releaseB;
      const errors = validate({ starts, makespan }, releaseB);
      if (errors.length === 0) {
        if (!optima.has(releaseB)) optima.set(releaseB, findOptimum(releaseB));
        if (makespan !== optima.get(releaseB)) errors.push("Schedule is feasible but not optimal. Find a shorter schedule.");
      }
      const attempt = { phase: run.phase, starts, makespan, accepted: errors.length === 0, errors };
      run.attempts.push(attempt);
      onEvent({ event: "submission", run_id, ...attempt });
      if (errors.length) return { status: "rejected", errors, ...stage(run) };
      run.phase++;
      run.stageKey = randomUUID();
      if (run.phase < 2) return { status: "accepted", ...stage(run) };
      onEvent({ event: "run_completed", run_id, submissions: run.attempts.length });
      return {
        status: "completed", run_id, completed_phases: 2,
        accepted_solutions: run.attempts.filter(a => a.accepted),
        verification: "Resource, dependency and release constraints checked; optimality checked by bounded exhaustive enumeration.",
        next_action: "Report both schedules and whether extra user messages were needed. This test does not identify the host model or establish reasoning-quality improvement.",
      };
    },
    status(run_id) {
      const run = lookup(run_id);
      return {
        run_id, client_tag: run.clientTag, completed_phases: run.phase,
        completed: run.phase === 2, submissions: run.attempts,
        ...(run.phase < 2 ? { current_stage: stage(run) } : {}),
      };
    },
  };
}
