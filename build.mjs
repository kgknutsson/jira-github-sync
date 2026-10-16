/**
 * Bundles TypeScript sources into committed `dist/run.mjs` and `dist/verify.mjs`.
 *
 * Resolves esbuild from this folder or, when vendored under `.github/workflows/<folder>/`,
 * from the host repository root. After editing sync sources, run `node build.mjs` and commit `dist/`.
 *
 * @module build
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function loadEsbuild() {
  const candidates = [
    join(here, '../../../node_modules/esbuild'),
    join(here, 'node_modules/esbuild'),
  ];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      /* esbuild not at this path — try next candidate */
    }
  }
  throw new Error(
    'esbuild not found. Run `npm ci` in this folder (or install esbuild at the host repo root).'
  );
}

const esbuild = loadEsbuild();

mkdirSync(join(here, 'dist'), { recursive: true });

const shared = {
  absWorkingDir: here,
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  logLevel: 'info',
  legalComments: 'none',
  sourcemap: false,
  outdir: join(here, 'dist'),
  outExtension: { '.js': '.mjs' },
};

await esbuild.build({
  ...shared,
  entryPoints: [join(here, 'run.ts'), join(here, 'verify.ts')],
});

console.log('[jira-sync] Built dist/run.mjs and dist/verify.mjs');
