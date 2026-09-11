import { createRequire } from "node:module";
globalThis.require = createRequire(import.meta.url);
const { build } = await import("esbuild");
await build({
  entryPoints: ["scaffold-run-entry.mjs"],
  platform: "node",
  bundle: true,
  format: "esm",
  outfile: "dist/scaffold-run.mjs",
  logLevel: "warning",
  external: ["pg", "@neondatabase/serverless", "dotenv"],
  banner: {
    js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';
globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);`,
  },
});
console.log("bundled");
