export const cases = [
  {
    id: "py-a", type: "python",
    code: `import json

def build(scale, box={"items": []}):
    funcs = []
    for i in range(3):
        def f(x, captured=i):
            box["items"].append(scale * x + i - captured)
            return list(box["items"])
        funcs.append(f)
    return funcs, box

f, a = build(2)
g, b = build(3)
out = [f[0](2), g[2](1)]
snapshot = a["items"][:]
a["items"] = a["items"] + [8]
out.append(f[1](0))
b = {"items": b["items"][:]}
b["items"].append(9)
out.append(g[0](-1))
print(json.dumps({"out": out, "snapshot": snapshot,
                  "a": a, "b": b, "same": a is b}))
`,
  },
  {
    id: "py-b", type: "python",
    code: `import json

rows = dict.fromkeys(["a", "b"], [])
ops = []
for i in range(3):
    ops.append(lambda n=i: rows["a"].append(n) or len(rows["b"]))
out = [ops[2](), ops[0]()]
snapshot = rows["b"][:]
rows["a"] = rows["a"] + [7]
out.append(ops[1]())
it = iter(rows["a"])
first = next(it)
rows["a"].pop(0)
rest = list(it)
rows["b"][:] = [5]
out.append(ops[0]())
print(json.dumps({"out": out, "snapshot": snapshot, "first": first,
                  "rest": rest, "rows": rows,
                  "same": rows["a"] is rows["b"]}))
`,
  },
  {
    id: "sched-a", type: "schedule", capacity: 2,
    maintenance: [{ from: 3, to: 5, capacity: 1 }],
    tasks: [
      { id: "A", duration: 2, workers: 2, after: [], release: 0 },
      { id: "B", duration: 3, workers: 1, after: [], release: 1 },
      { id: "C", duration: 3, workers: 1, after: ["A"], release: 0 },
      { id: "D", duration: 2, workers: 2, after: ["B"], release: 0 },
      { id: "E", duration: 2, workers: 1, after: ["C", "D"], release: 0 },
      { id: "F", duration: 1, workers: 2, after: ["E"], release: 0 },
    ],
  },
  {
    id: "sched-b", type: "schedule", capacity: 3,
    maintenance: [{ from: 2, to: 4, capacity: 1 }],
    tasks: [
      { id: "A", duration: 3, workers: 2, after: [], release: 0 },
      { id: "B", duration: 2, workers: 1, after: [], release: 1 },
      { id: "C", duration: 2, workers: 2, after: ["A"], release: 0 },
      { id: "D", duration: 3, workers: 1, after: ["B"], release: 0 },
      { id: "F", duration: 1, workers: 1, after: ["C"], release: 0 },
      { id: "E", duration: 2, workers: 3, after: ["C", "D", "F"], release: 0 },
    ],
  },
  {
    id: "select-a", type: "selection", budget: 15,
    items: [
      { id: "A", cost: 4, value: 8 }, { id: "B", cost: 3, value: 7 },
      { id: "C", cost: 5, value: 12 }, { id: "D", cost: 2, value: 5 },
      { id: "E", cost: 6, value: 14 }, { id: "F", cost: 4, value: 10 },
      { id: "G", cost: 3, value: 9 }, { id: "H", cost: 2, value: 4 },
    ],
    requires: [["C", "A"], ["G", "B"]], excludes: [["D", "E"], ["F", "G"]],
  },
  {
    id: "assign-a", type: "assignment",
    costs: [
      [9, 2, 7, 8, 6, 4], [6, 4, 3, 7, 5, 8], [5, 8, 1, 8, 3, 7],
      [7, 6, 9, 4, 8, 2], [8, 5, 2, 9, 7, 6], [4, 7, 8, 3, 6, 5],
    ],
    forbidden: [["P2", 3], ["P5", 2]], before: ["P1", "P4"], nonAdjacent: ["P3", "P5"],
  },
];

export function question(c) {
  if (c.type === "python") return `下面的 Python 3 程序打印什么？不修改也不执行程序。给出完整 JSON 和简要依据。\n\n\`\`\`python\n${c.code}\`\`\``;
  if (c.type === "schedule") {
    const rows = c.tasks.map(t => `| ${t.id} | ${t.duration} | ${t.workers} | ${t.after.join("、") || "无"} | ${t.release} |`).join("\n");
    return `为下列不可中断任务安排非负整数开始时间，使所有任务的最晚结束时间 makespan 最小。
通常有 ${c.capacity} 名工人；${c.maintenance.map(m => `[${m.from},${m.to}) 内只有 ${m.capacity} 名工人`).join("；")}。
任务在半开区间 [开始,开始+持续时间) 占用工人；所有前置任务结束后才能开始。

| 任务 | 持续时间 | 工人数 | 前置任务 | 最早开始 |
| --- | --- | --- | --- | --- |
${rows}

给出 JSON {"starts":{"A":整数,"B":整数,"C":整数,"D":整数,"E":整数,"F":整数},"makespan":整数}，
并简要说明可行性及为什么不存在更短的排程。`;
  }
  if (c.type === "selection") return `从项目 A–H 中选择一个子集，每项最多选一次，总成本不得超过 ${c.budget}。
先最大化总价值；若价值相同，再最小化总成本。仍并列时任一最优子集均可。

| 项目 | 成本 | 价值 |
| --- | --- | --- |
${c.items.map(i => `| ${i.id} | ${i.cost} | ${i.value} |`).join("\n")}

${c.requires.map(([a, b]) => `选择 ${a} 必须同时选择 ${b}。`).join("\n")}
${c.excludes.map(([a, b]) => `${a} 与 ${b} 不能同时选择。`).join("\n")}

给出 JSON {"selected":["项目ID"],"cost":整数,"value":整数}，并简要说明约束及最优性。`;
  return `六人 P1–P6 分配到按时间顺序编号的六个班次 1–6，每人恰好一个班次，每班次恰好一人。
总成本为每人对应班次成本之和，目标是最小化总成本。

| 人员 | 班次1 | 班次2 | 班次3 | 班次4 | 班次5 | 班次6 |
| --- | --- | --- | --- | --- | --- | --- |
${c.costs.map((row, i) => `| P${i + 1} | ${row.join(" | ")} |`).join("\n")}

${c.forbidden.map(([p, s]) => `${p} 不能安排到班次 ${s}。`).join("\n")}
${c.before[0]} 的班次编号必须小于 ${c.before[1]}。
${c.nonAdjacent.join(" 和 ")} 的班次不能相邻，即编号差的绝对值不能为 1。

给出 JSON {"assignment":{"P1":整数,"P2":整数,"P3":整数,"P4":整数,"P5":整数,"P6":整数},"total_cost":整数}，
并简要说明可行性和最优性。`;
}
