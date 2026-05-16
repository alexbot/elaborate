/**
 * Build the deployable skill bundle: SKILL.md + bundled elaborate.cjs
 *
 * Output: skills/elaborate/
 *   ├── SKILL.md              (copied from src/skill/)
 *   └── scripts/
 *       └── elaborate.cjs     (single file, all dependencies included)
 */

import * as esbuild from "esbuild";
import { appendFileSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = dirname(__dirname);

const outDir = `${root}/skills/elaborate/scripts`;

mkdirSync(outDir, { recursive: true });

await esbuild.build({
  entryPoints: [`${root}/src/skill/adapter.ts`],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  outfile: `${outDir}/elaborate.cjs`,
  minify: true,
  sourcemap: "external",
  sourcesContent: false,
  banner: { js: "#!/usr/bin/env node" },
});

appendFileSync(`${outDir}/elaborate.cjs`, "\n//# sourceMappingURL=elaborate.cjs.map\n");

copyFileSync(`${root}/src/skill/SKILL.md`, `${root}/skills/elaborate/SKILL.md`);

console.log("Skill built → skills/elaborate/");
