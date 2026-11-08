import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { cases, question } from "./cases.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const cache = new Map();
const capacity = (c, time) => c.maintenance.find(m => m.from <= time && time < m.to)?.capacity ?? c.capacity;
function resourceOK(c, tasks, starts) {
  const points = [...new Set([
    ...tasks.flatMap(t => [starts[t.id], starts[t.id] + t.duration]),
    ...c.maintenance.flatMap(m => [m.from, m.to]),
  ])].sort((a, b) => a - b);
  return points.every(time => tasks.reduce((load, t) =>
    load + (starts[t.id] <= time && time < starts[t.id] + t.duration ? t.workers : 0), 0) <= capacity(c, time));
}
function scheduleOracle(c) {
  const tasks = c.tasks;
  const byId = new Map(tasks.map(t => [t.id, t]));
  const sequential = {};
  let cursor = Math.max(0, ...c.maintenance.map(m => m.to), ...tasks.map(t => t.release));
  for (const t of tasks) { sequential[t.id] = cursor; cursor += t.duration; }
  let best = { starts: sequential, makespan: cursor };
  const starts = {};
  function visit(i) {
    if (i === tasks.length) {
      best = { starts: { ...starts }, makespan: Math.max(...tasks.map(t => starts[t.id] + t.duration)) };
      return;
    }
    const t = tasks[i];
    const earliest = Math.max(t.release, ...t.after.map(id => starts[id] + byId.get(id).duration));
    for (let time = earliest; time + t.duration < best.makespan; time++) {
      starts[t.id] = time;
      if (resourceOK(c, tasks.slice(0, i + 1), starts)) visit(i + 1);
    }
    delete starts[t.id];
  }
  visit(0);
  return best;
}
function selectionErrors(c, selected) {
  if (!Array.isArray(selected) || selected.some(id => !c.items.some(i => i.id === id)) ||
      new Set(selected).size !== selected.length) return ["Selected IDs must exist and be unique."];
  const errors = [];
  for (const [a, b] of c.requires) if (selected.includes(a) && !selected.includes(b)) errors.push(`${a} requires ${b}.`);
  for (const [a, b] of c.excludes) if (selected.includes(a) && selected.includes(b)) errors.push(`${a} excludes ${b}.`);
  if (c.items.filter(i => selected.includes(i.id)).reduce((s, i) => s + i.cost, 0) > c.budget)
    errors.push("Budget exceeded.");
  return errors;
}
function selectionOracle(c) {
  let best;
  for (let mask = 0; mask < 2 ** c.items.length; mask++) {
    const items = c.items.filter((_, i) => mask & (1 << i));
    const result = { selected: items.map(i => i.id), cost: items.reduce((s, i) => s + i.cost, 0),
      value: items.reduce((s, i) => s + i.value, 0) };
    if (!selectionErrors(c, result.selected).length &&
        (!best || result.value > best.value || (result.value === best.value && result.cost < best.cost))) best = result;
  }
  return best;
}
function assignmentErrors(c, a) {
  const ids = c.costs.map((_, i) => `P${i + 1}`);
  if (!a || ids.some(id => !Number.isInteger(a[id]) || a[id] < 1 || a[id] > ids.length) ||
      new Set(ids.map(id => a[id])).size !== ids.length) return ["Assign each person a distinct shift in 1..6."];
  const errors = [];
  for (const [id, shift] of c.forbidden) if (a[id] === shift) errors.push(`${id} cannot use shift ${shift}.`);
  if (a[c.before[0]] >= a[c.before[1]]) errors.push("Shift order violated.");
  if (Math.abs(a[c.nonAdjacent[0]] - a[c.nonAdjacent[1]]) === 1) errors.push("Non-adjacency violated.");
  return errors;
}
function assignmentOracle(c) {
  let best;
  const assignment = {};
  function visit(i, remaining) {
    if (i === c.costs.length) {
      if (assignmentErrors(c, assignment).length) return;
      const total_cost = c.costs.reduce((sum, row, k) => sum + row[assignment[`P${k + 1}`] - 1], 0);
      if (!best || total_cost < best.total_cost) best = { assignment: { ...assignment }, total_cost };
      return;
    }
    for (const shift of remaining) {
      assignment[`P${i + 1}`] = shift;
      visit(i + 1, remaining.filter(s => s !== shift));
    }
  }
  visit(0, c.costs.map((_, i) => i + 1));
  return best;
}
export function oracle(c) {
  if (cache.has(c.id)) return cache.get(c.id);
  let value;
  if (c.type === "python") {
    value = JSON.parse(execFileSync("python3", ["-I", "-c", c.code], {
      encoding: "utf8", timeout: 5000, maxBuffer: 1024 * 1024,
    }));
  } else if (c.type === "schedule") value = scheduleOracle(c);
  else if (c.type === "selection") value = selectionOracle(c);
  else value = assignmentOracle(c);
  if (!value) throw new Error(`No oracle solution for ${c.id}`);
  cache.set(c.id, value);
  return value;
}
export function grade(c, answer) {
  const expected = oracle(c);
  if (c.type === "python") {
    const passed = isDeepStrictEqual(answer, expected);
    return { passed, constraints_passed: null, errors: passed ? [] : ["Printed JSON does not match executed output."] };
  }
  let errors = [];
  let optimal = false;
  if (c.type === "schedule") {
    const s = answer?.starts;
    if (!s || c.tasks.some(t => !Number.isSafeInteger(s[t.id]) || s[t.id] < 0 ||
        !Number.isSafeInteger(s[t.id] + t.duration))) {
      errors.push("Provide nonnegative safe integer starts for every task.");
    } else {
      for (const t of c.tasks) {
        if (s[t.id] < t.release) errors.push(`${t.id} starts before release.`);
        for (const parent of t.after) {
          if (s[t.id] < s[parent] + c.tasks.find(p => p.id === parent).duration) errors.push(`${t.id} starts before ${parent} ends.`);
        }
      }
      if (!resourceOK(c, c.tasks, s)) errors.push("Worker capacity exceeded.");
      const makespan = Math.max(...c.tasks.map(t => s[t.id] + t.duration));
      if (answer.makespan !== makespan) errors.push("Declared makespan is inconsistent.");
      optimal = makespan === expected.makespan;
    }
  } else if (c.type === "selection") {
    errors = selectionErrors(c, answer?.selected);
    if (!errors.length) {
      const selected = c.items.filter(i => answer.selected.includes(i.id));
      const cost = selected.reduce((s, i) => s + i.cost, 0);
      const value = selected.reduce((s, i) => s + i.value, 0);
      if (cost !== answer.cost || value !== answer.value) errors.push("Declared totals are inconsistent.");
      optimal = cost === expected.cost && value === expected.value;
    }
  } else {
    errors = assignmentErrors(c, answer?.assignment);
    if (!errors.length) {
      const total = c.costs.reduce((s, row, i) => s + row[answer.assignment[`P${i + 1}`] - 1], 0);
      if (total !== answer.total_cost) errors.push("Declared total cost is inconsistent.");
      optimal = total === expected.total_cost;
    }
  }
  const constraints_passed = errors.length === 0;
  if (constraints_passed && !optimal) errors.push("Feasible answer, but not globally optimal under the stated objective.");
  return { passed: errors.length === 0, constraints_passed, errors };
}

const treatments = {
  A: "仅使用当前选定的 Instant 直接完成下面的问题，不使用任何工具或其他模型。给出最终 JSON 和简要依据。",
  B: "仅使用当前选定的 Instant，不使用任何工具或其他模型。先构造候选答案，逐项检查原始约束、边界和可能的反例；必要时修正后再给出最终 JSON 和简要依据。不要输出冗长的中间过程。",
  C: `仅使用当前选定的 Instant 与思序自适应插件。
调用 begin_reasoning，task 传入下方完整任务正文，strategy=adaptive_search，feedback=none，
client_tag=pilot-v021。不要传 case_id，使用默认预算。
按 next_action 和最新 stage_key 持续调用 advance_reasoning，直到 completed；
不要强制安排某个动作，不等待用户逐阶段催促，不使用其他工具或模型。
最终给出 JSON、简要依据、未解决事项及 run_id。工具失败时如实报告。`,
};
const orders = [["A", "B", "C"], ["B", "C", "A"], ["C", "A", "B"], ["A", "C", "B"], ["C", "B", "A"], ["B", "A", "C"]];
function prepare() {
  const out = join(root, ".runtime/pilot-v02");
  if (existsSync(join(out, "manifest.json"))) throw new Error("Pilot already prepared; preserve existing prompts and results.");
  mkdirSync(join(out, "prompts"), { recursive: true, mode: 0o700 });
  mkdirSync(join(out, "responses"), { recursive: true, mode: 0o700 });
  mkdirSync(join(out, "answers"), { recursive: true, mode: 0o700 });
  const runs = [];
  for (const [i, c] of cases.entries()) {
    const task = question(c);
    for (const group of orders[i]) {
      const key = `${String(runs.length + 1).padStart(2, "0")}-${group}-${c.id}`;
      const file = `prompts/${key}.md`;
      writeFileSync(join(out, file), `${treatments[group]}\n\n任务正文：\n\n${task}\n`, { mode: 0o600, flag: "wx" });
      runs.push({ key, group, case_id: c.id, question_sha256: createHash("sha256").update(task).digest("hex"),
        prompt_file: file, raw_response_file: `responses/${key}.txt`, final_json_file: `answers/${key}.json`,
        status: "pending", elapsed_seconds: null, model_self_report: null, run_id: null });
    }
  }
  writeFileSync(join(out, "manifest.json"), JSON.stringify({
    protocol: "pilot-v021-6cases-3groups-v1", created_at: new Date().toISOString(),
    harness_version: "0.2.1", runs,
    limitations: "Pending manual Instant trials; no model output or measured result has been generated.",
  }, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  console.log(JSON.stringify({ prepared: true, cases: cases.length, pending_trials: runs.length,
    first_prompt: join(out, runs[0].prompt_file), manifest: join(out, "manifest.json"), model_calls: 0 }, null, 2));
}
function selfcheck() {
  for (const c of cases) {
    const expected = oracle(c);
    if (!grade(c, expected).passed || grade(c, {}).passed) throw new Error(`Oracle or invalid-answer check failed: ${c.id}`);
    if (c.type === "schedule") {
      const delayed = { starts: Object.fromEntries(Object.entries(expected.starts).map(([id, s]) => [id, s + 100])),
        makespan: expected.makespan + 100 };
      if (grade(c, delayed).passed) throw new Error(`Suboptimal answer accepted: ${c.id}`);
    }
    if (!question(c).length) throw new Error(`Empty question: ${c.id}`);
  }
  console.log(JSON.stringify({ selfcheck: "passed", cases: cases.length, model_calls: 0,
    note: "Checks graders only; not an Instant evaluation result." }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, id, answerFile] = process.argv.slice(2);
  if (command === "prepare") prepare();
  else if (command === "selfcheck") selfcheck();
  else if (command === "grade") {
    const c = cases.find(c => c.id === id);
    if (!c || !answerFile) throw new Error("Usage: node pilot.mjs grade CASE_ID FINAL_JSON_PATH");
    console.log(JSON.stringify({ case_id: id, ...grade(c, JSON.parse(readFileSync(answerFile, "utf8"))),
      explanation_review: "pending_manual_review" }, null, 2));
  } else throw new Error("Commands: prepare | selfcheck | grade CASE_ID FINAL_JSON_PATH");
}
