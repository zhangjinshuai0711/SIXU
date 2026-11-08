import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const manifest = JSON.parse(readFileSync(new URL("../.openai/hosting.json", import.meta.url), "utf8"));
const result = await build({
  entryPoints: [fileURLToPath(new URL("worker.mjs", import.meta.url))],
  bundle: true, write: false, format: "esm", platform: "browser", target: "es2022",
  plugins: [{
    name: "worker-crypto",
    setup(build) {
      build.onResolve({ filter: /^node:crypto$/ }, () => ({ path: "crypto", namespace: "worker" }));
      build.onLoad({ filter: /.*/, namespace: "worker" }, () => ({
        contents: "export const randomUUID = () => crypto.randomUUID();",
      }));
    },
  }],
});
mkdirSync(new URL("../dist/server/", import.meta.url), { recursive: true });
mkdirSync(new URL("../dist/.openai/", import.meta.url), { recursive: true });
writeFileSync(new URL("../dist/server/index.js", import.meta.url), result.outputFiles[0].text);
writeFileSync(new URL("../dist/.openai/hosting.json", import.meta.url), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({ built: true, project_registered: Boolean(manifest.project_id), bytes: result.outputFiles[0].contents.length }));
