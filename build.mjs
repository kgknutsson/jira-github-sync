/**
 * Bundles TypeScript sources into committed `dist/run.mjs` and `dist/verify.mjs`, and writes
 * `jira-sync.config.schema.json` from the config catalog.
 *
 * Resolves esbuild from this folder or, when vendored under `.github/workflows/<folder>/`,
 * from the host repository root. After editing sync sources, run `node build.mjs` and commit `dist/`.
 *
 * @module build
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
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

await esbuild.build({
  ...shared,
  entryPoints: [join(here, 'index.ts')],
  // Bundled CommonJS dependencies (yaml) call require('process'); give the ESM bundle a real require.
  banner: {
    js: [
      '#!/usr/bin/env node',
      "import { createRequire as __createRequire } from 'node:module';",
      'const require = __createRequire(import.meta.url);',
    ].join('\n'),
  },
});

const schemaBuild = await esbuild.build({
  absWorkingDir: here,
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  logLevel: 'silent',
  write: false,
  entryPoints: [join(here, 'lib/config/configSchema.ts')],
  outfile: join(here, 'schema.mjs'),
});
const schemaModule = Buffer.from(schemaBuild.outputFiles[0].text).toString('base64');
const { buildConfigSchema } = await import(`data:text/javascript;base64,${schemaModule}`);
writeFileSync(
  join(here, 'jira-sync.config.schema.json'),
  `${JSON.stringify(buildConfigSchema(), null, 2)}\n`
);

console.log('[jira-sync] Built dist/ and jira-sync.config.schema.json');
