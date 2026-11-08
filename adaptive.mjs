import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createAdaptiveEngine } from "./adaptive-core.mjs";

export { adaptiveArtifactSchema, budgetSchema } from "./adaptive-core.mjs";

export function createAdaptive({ directory, ...options } = {}) {
  if (!directory) throw new Error("Adaptive state directory required.");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = id => join(directory, `${id}.json`);
  const store = {
    owns: id => existsSync(path(id)),
    load(id) {
      try { return JSON.parse(readFileSync(path(id), "utf8")); } catch (error) {
        if (error.code === "ENOENT") return undefined;
        throw error;
      }
    },
    save(run) {
      const target = path(run.id);
      const temp = `${target}.${randomUUID()}.tmp`;
      writeFileSync(temp, JSON.stringify(run), { mode: 0o600, flag: "wx" });
      renameSync(temp, target);
    },
  };
  return createAdaptiveEngine({ ...options, store });
}
