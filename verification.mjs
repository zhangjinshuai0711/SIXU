import { z } from "zod";

const label = z.string().trim().min(1).max(2500);
const key = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
const path = z.array(z.union([
  z.string().max(80).refine(name => !["__proto__", "prototype", "constructor"].includes(name), "Unsafe path."),
  z.number().int().min(0).max(63),
])).max(8);
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const expression = z.lazy(() => z.union([
  z.number().finite(),
  z.object({ path }).strict(),
  z.object({ op: z.enum(["add", "subtract", "multiply", "divide"]), left: expression, right: expression }).strict(),
]));
const field = z.object({
  path, type: z.enum(["string", "number", "integer", "boolean", "array", "object"]),
  required: z.boolean().default(true), min: z.number().finite().optional(),
  max: z.number().finite().optional(), unique: z.boolean().optional(),
}).strict();
const item = z.object({ id: key, cost: integer, value: integer.optional() }).strict();
const task = z.object({
  id: key, duration: integer, demand: integer.default(1), release: integer.default(0),
  after: z.array(key).max(64).default([]),
}).strict();
const base = { id: key, requirement_id: key };
export const requirementSchema = z.object({
  id: key, quote: label, method: z.enum(["model", "internal"]),
}).strict();
export const checkSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("arithmetic"), left: expression, right: expression,
    relation: z.enum(["eq", "le", "ge"]).default("eq") }).strict(),
  z.object({ ...base, type: z.literal("structure"), fields: z.array(field).min(1).max(64) }).strict(),
  z.object({ ...base, type: z.literal("selection"), path, unit: label,
    items: z.array(item).min(1).max(64), budget: integer,
    requires: z.array(z.tuple([key, key])).max(64).default([]),
    excludes: z.array(z.tuple([key, key])).max(64).default([]),
    cost_path: path.optional(), value_path: path.optional(),
  }).strict(),
  z.object({ ...base, type: z.literal("schedule"), path, unit: label,
    tasks: z.array(task).min(1).max(64), capacity: integer,
    maintenance: z.array(z.object({ from: integer, to: integer, capacity: integer }).strict()).max(64).default([]),
    makespan_path: path.optional(),
  }).strict(),
]);

export function validateJson(value, depth = 0) {
  if (depth > 8) throw new Error("Result nesting exceeds 8.");
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value) && value.length <= 64) {
    value.forEach(entry => validateJson(entry, depth + 1));
    return;
  }
  if (value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).length <= 64) {
    for (const [name, entry] of Object.entries(value)) {
      if (["__proto__", "prototype", "constructor"].includes(name)) throw new Error("Unsafe result key.");
      validateJson(entry, depth + 1);
    }
    return;
  }
  throw new Error("Result must be bounded JSON; arrays and objects allow at most 64 entries.");
}

export const sameJson = (left, right) => {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const names = Object.keys(left);
  return names.length === Object.keys(right).length &&
    names.every(name => Object.hasOwn(right, name) && sameJson(left[name], right[name]));
};
const unique = values => new Set(values).size === values.length;
const safe = value => Number.isSafeInteger(value) && value >= 0;
const near = (left, right) => Math.abs(left - right) <= 1e-9 * Math.max(1, Math.abs(left), Math.abs(right));
function readPath(result, names) {
  let value = result;
  for (const name of names) {
    if (["__proto__", "prototype", "constructor"].includes(String(name)) ||
        !value || typeof value !== "object" || !Object.hasOwn(value, name)) return undefined;
    value = value[name];
  }
  return value;
}
function walkExpression(node, depth = 0, count = { used: 0 }) {
  if (++count.used > 64 || depth > 8) throw new Error("Expression exceeds 64 nodes or depth 8.");
  if (typeof node === "number" || node.path) return;
  walkExpression(node.left, depth + 1, count);
  walkExpression(node.right, depth + 1, count);
}
function evaluate(node, result) {
  if (typeof node === "number") return node;
  if (node.path) {
    const value = readPath(result, node.path);
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Expected finite number at ${JSON.stringify(node.path)}.`);
    return value;
  }
  const left = evaluate(node.left, result);
  const right = evaluate(node.right, result);
  if (node.op === "divide" && right === 0) throw new Error("Division by zero.");
  const value = node.op === "add" ? left + right : node.op === "subtract" ? left - right :
    node.op === "multiply" ? left * right : left / right;
  if (!Number.isFinite(value)) throw new Error("Arithmetic overflow.");
  return value;
}

export function validateDefinitions(taskText, requirements, checks) {
  if (requirements.length > 64 || checks.length > 32) throw new Error("At most 64 requirements and 32 checks.");
  if (!unique(requirements.map(entry => entry.id)) || !unique(checks.map(entry => entry.id)))
    throw new Error("Requirement and check IDs must be unique and cannot be replaced.");
  for (const requirement of requirements) {
    if (!taskText.includes(requirement.quote)) throw new Error(`Requirement ${requirement.id} quote must occur in the task.`);
    if (requirement.method === "internal" && !checks.some(check => check.requirement_id === requirement.id))
      throw new Error(`Internal requirement ${requirement.id} needs a check.`);
  }
  for (const check of checks) {
    if (!requirements.some(entry => entry.id === check.requirement_id && entry.method === "internal"))
      throw new Error(`Check ${check.id} needs an internal requirement.`);
    if (check.type === "arithmetic") {
      const count = { used: 0 };
      walkExpression(check.left, 0, count);
      walkExpression(check.right, 0, count);
    }
    if (check.type === "selection" || check.type === "schedule") {
      const records = check.type === "selection" ? check.items : check.tasks;
      const ids = records.map(entry => entry.id);
      if (!unique(ids)) throw new Error("Data IDs must be unique.");
      const references = check.type === "selection" ? [...check.requires, ...check.excludes].flat() :
        check.tasks.flatMap(entry => entry.after);
      if (references.some(reference => !ids.includes(reference))) throw new Error("Unknown constraint reference.");
      if (check.type === "schedule" && check.maintenance.some(window => window.from >= window.to))
        throw new Error("Maintenance windows require from < to.");
    }
    if (check.type === "structure" && check.fields.some(entry =>
      entry.min !== undefined && entry.max !== undefined && entry.min > entry.max))
      throw new Error("Field minimum exceeds maximum.");
  }
}

function inspect(check, result) {
  const errors = [];
  const fail = (location, message) => errors.push({ path: location, message });
  if (check.type === "arithmetic") {
    const left = evaluate(check.left, result);
    const right = evaluate(check.right, result);
    const passed = near(left, right) || (check.relation === "le" ? left <= right : check.relation === "ge" ? left >= right : false);
    if (!passed) fail([], `${left} does not satisfy ${check.relation} ${right}.`);
  } else if (check.type === "structure") {
    for (const rule of check.fields) {
      const value = readPath(result, rule.path);
      if (value === undefined) {
        if (rule.required) fail(rule.path, "Required field missing.");
        continue;
      }
      const schema = {
        string: z.string(), number: z.number().finite(), integer: z.number().int().finite(),
        boolean: z.boolean(), array: z.array(z.unknown()).max(64), object: z.record(z.string(), z.unknown()),
      }[rule.type];
      if (!schema.safeParse(value).success) { fail(rule.path, `Expected ${rule.type}.`); continue; }
      if (typeof value === "number" && ((rule.min !== undefined && value < rule.min) || (rule.max !== undefined && value > rule.max)))
        fail(rule.path, "Number out of range.");
      if (rule.unique && Array.isArray(value) && value.some((entry, index) => value.slice(0, index).some(previous => sameJson(entry, previous))))
        fail(rule.path, "Array entries must be unique.");
    }
  } else if (check.type === "selection") {
    const selected = readPath(result, check.path);
    const ids = check.items.map(entry => entry.id);
    if (!Array.isArray(selected) || !unique(selected) || selected.some(entry => !ids.includes(entry)))
      fail(check.path, "Select unique known item IDs.");
    else {
      const items = check.items.filter(entry => selected.includes(entry.id));
      const cost = items.reduce((total, entry) => total + entry.cost, 0);
      const value = items.reduce((total, entry) => total + (entry.value ?? 0), 0);
      if (!safe(cost) || !safe(value)) fail(check.path, "Totals exceed safe integer range.");
      if (cost > check.budget) fail(check.path, `Cost ${cost} exceeds budget ${check.budget}.`);
      for (const [itemId, requiredId] of check.requires)
        if (selected.includes(itemId) && !selected.includes(requiredId)) fail(check.path, `${itemId} requires ${requiredId}.`);
      for (const [leftId, rightId] of check.excludes)
        if (selected.includes(leftId) && selected.includes(rightId)) fail(check.path, `${leftId} excludes ${rightId}.`);
      if (check.cost_path && readPath(result, check.cost_path) !== cost) fail(check.cost_path, `Declared cost must be ${cost}.`);
      if (check.value_path && readPath(result, check.value_path) !== value) fail(check.value_path, `Declared value must be ${value}.`);
    }
  } else {
    const starts = readPath(result, check.path);
    const valid = starts && check.tasks.every(entry => safe(starts[entry.id]) && safe(starts[entry.id] + entry.duration));
    if (!valid) fail(check.path, "Provide nonnegative safe integer starts for every task.");
    else {
      for (const entry of check.tasks) {
        if (starts[entry.id] < entry.release) fail([...check.path, entry.id], "Starts before release.");
        for (const parentId of entry.after) {
          const parent = check.tasks.find(record => record.id === parentId);
          if (starts[entry.id] < starts[parentId] + parent.duration) fail([...check.path, entry.id], `Starts before ${parentId} ends.`);
        }
      }
      const points = [...new Set([...check.tasks.flatMap(entry => [starts[entry.id], starts[entry.id] + entry.duration]),
        ...check.maintenance.flatMap(window => [window.from, window.to])])];
      for (const time of points) {
        const capacity = Math.min(check.capacity, ...check.maintenance.filter(window => window.from <= time && time < window.to).map(window => window.capacity));
        const demand = check.tasks.reduce((total, entry) =>
          total + (starts[entry.id] <= time && time < starts[entry.id] + entry.duration ? entry.demand : 0), 0);
        if (!safe(demand) || demand > capacity) fail(check.path, `Capacity exceeded at ${time}: ${demand} > ${capacity}.`);
      }
      const makespan = Math.max(...check.tasks.map(entry => starts[entry.id] + entry.duration));
      if (check.makespan_path && readPath(result, check.makespan_path) !== makespan)
        fail(check.makespan_path, `Declared makespan must be ${makespan}.`);
    }
  }
  return errors;
}

export function runChecks(checks, candidate) {
  return checks.map(check => {
    let errors;
    try {
      if (candidate.result === undefined) throw new Error("Candidate result missing; cannot execute this check.");
      errors = inspect(check, candidate.result);
    } catch (error) { errors = [{ path: [], message: error.message }]; }
    return {
      check_id: check.id, requirement_id: check.requirement_id,
      candidate_id: candidate.id, candidate_version: candidate.version,
      method: check.type, verification: "service_executed", passed: errors.length === 0, errors,
    };
  });
}
