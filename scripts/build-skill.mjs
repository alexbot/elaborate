/**
 * Build the deployable skill bundle: SKILL.md + bundled elaborate.cjs
 *
 * Output: dist/skill/
 *   ├── SKILL.md    (copied from src/skill/)
 *   └── elaborate.cjs     (single file, all dependencies included)
 */

import * as esbuild from "esbuild";
import { appendFileSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = dirname(__dirname);

const outDir = `${root}/dist/skill`;

mkdirSync(outDir, { recursive: true });

await esbuild.build({
  entryPoints: [`${root}/src/skill/adapter.ts`],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  outfile: `${outDir}/elaborate.cjs`,
  sourcemap: "external",
  sourcesContent: false,
  banner: { js: "#!/usr/bin/env node" },
});

appendFileSync(`${outDir}/elaborate.cjs`, "\n//# sourceMappingURL=elaborate.cjs.map\n");

copyFileSync(`${root}/src/skill/SKILL.md`, `${outDir}/SKILL.md`);

console.log("Skill built → dist/skill/");
