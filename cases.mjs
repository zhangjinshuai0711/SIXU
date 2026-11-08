export const case01 = {
  id: "sched-01",
  question: `为以下 6 个不可中断的任务安排非负整数开始时间，使最后一个任务的结束时间（makespan）最小。
通常共有 2 名工人，但维护时段 [4,6) 只有 1 名工人可用。

| 任务 | 持续时间 | 所需工人数 | 前置任务 | 最早开始时间 |
| --- | --- | --- | --- | --- |
| A | 3 | 2 | 无 | 0 |
| B | 4 | 1 | 无 | 1 |
| C | 2 | 1 | A | 0 |
| D | 3 | 2 | B | 0 |
| E | 2 | 1 | C、D | 0 |
| F | 1 | 2 | E | 0 |

任务在半开区间 [开始时间, 开始时间+持续时间) 内占用工人。前置任务全部结束后才能开始。
所有任务都必须完成，工人可在不同任务之间调配。
请先给出 JSON：{"starts":{"A":整数,"B":整数,"C":整数,"D":整数,"E":整数,"F":整数},"makespan":整数}，
再简要解释排程为何满足约束，以及为什么不存在更短的排程。`,
};

const tasks = [
  { id: "A", duration: 3, workers: 2, after: [], release: 0 },
  { id: "B", duration: 4, workers: 1, after: [], release: 1 },
  { id: "C", duration: 2, workers: 1, after: ["A"], release: 0 },
  { id: "D", duration: 3, workers: 2, after: ["B"], release: 0 },
  { id: "E", duration: 2, workers: 1, after: ["C", "D"], release: 0 },
  { id: "F", duration: 1, workers: 2, after: ["E"], release: 0 },
];
const capacity = time => time >= 4 && time < 6 ? 1 : 2;
const end = (task, starts) => starts[task.id] + task.duration;

function resourceErrors(selected, starts) {
  const errors = [];
  const maxEnd = Math.max(0, ...selected.map(task => end(task, starts)));
  for (let time = 0; time < maxEnd; time++) {
    const load = selected.filter(task => starts[task.id] <= time && time < end(task, starts))
      .reduce((sum, task) => sum + task.workers, 0);
    if (load > capacity(time)) errors.push(`Worker load ${load} exceeds capacity ${capacity(time)} at [${time},${time + 1}).`);
  }
  return errors;
}

// Enumerate all starts in topological order, pruning only infeasible partial
// assignments and branches that cannot improve the best feasible schedule.
export function schedulingOracle() {
  let best = Infinity;
  let witness;
  const starts = {};
  const horizon = 24;
  function visit(index) {
    if (index === tasks.length) {
      const makespan = Math.max(...tasks.map(task => end(task, starts)));
      if (makespan < best) { best = makespan; witness = { ...starts }; }
      return;
    }
    const task = tasks[index];
    const earliest = Math.max(task.release, ...task.after.map(id => {
      const parent = tasks.find(item => item.id === id);
      return end(parent, starts);
    }));
    for (let time = earliest; time + task.duration < Math.min(best, horizon + 1); time++) {
      starts[task.id] = time;
      if (resourceErrors(tasks.slice(0, index + 1), starts).length === 0) visit(index + 1);
    }
    delete starts[task.id];
  }
  visit(0);
  if (!witness) throw new Error("No feasible schedule found within the fixed test horizon.");
  // A feasible solution below horizon proves that excluded starts cannot improve it.
  return { makespan: best, starts: witness };
}

let oracle;
export function gradeCase(id, result) {
  if (id !== case01.id) throw new Error("Unknown case.");
  const starts = result?.starts;
  if (!starts || tasks.some(task => !Number.isInteger(starts[task.id]) ||
      starts[task.id] < 0 || starts[task.id] > 24)) {
    return { passed: false, errors: ["Provide all six integer starts in [0,24] in result.starts."] };
  }
  const errors = [];
  for (const task of tasks) {
    if (starts[task.id] < task.release) errors.push(`${task.id} starts before release ${task.release}.`);
    for (const id of task.after) {
      if (starts[task.id] < end(tasks.find(parent => parent.id === id), starts)) {
        errors.push(`${task.id} starts before ${id} finishes.`);
      }
    }
  }
  errors.push(...resourceErrors(tasks, starts));
  const makespan = Math.max(...tasks.map(task => end(task, starts)));
  if (result.makespan !== makespan) errors.push("Declared makespan does not match task completion times.");
  oracle ??= schedulingOracle();
  if (errors.length === 0 && makespan !== oracle.makespan) errors.push("Feasible schedule, but not globally optimal.");
  return { passed: errors.length === 0, errors, feasible_makespan: makespan };
}
