/**
 * Bundles the action into the committed `dist/index.mjs` (plus `dist/licenses.txt` for bundled
 * dependencies) and writes `jira-sync.config.schema.json` from the config catalog. Run after
 * editing sources and commit the results.
 *
 * @module build
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as esbuild from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const shared = {
  absWorkingDir: here,
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  legalComments: 'none',
};

mkdirSync(join(here, 'dist'), { recursive: true });

const action = await esbuild.build({
  ...shared,
  logLevel: 'info',
  metafile: true,
  entryPoints: [join(here, 'index.ts')],
  outfile: join(here, 'dist/index.mjs'),
  // Bundled CommonJS dependencies (yaml) call require('process'); give the ESM bundle a real require.
  banner: {
    js: [
      '#!/usr/bin/env node',
      "import { createRequire as __createRequire } from 'node:module';",
      'const require = __createRequire(import.meta.url);',
    ].join('\n'),
  },
});

const bundled = new Set(
  Object.keys(action.metafile.inputs)
    .map((input) => input.match(/node_modules\/((?:@[^/]+\/)?[^/]+)\//)?.[1])
    .filter(Boolean)
);
const licenses = [...bundled].sort().map((name) => {
  const dir = join(here, 'node_modules', name);
  const { version, license } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const file = readdirSync(dir).find((entry) => /^licen[cs]e/i.test(entry));
  const text = file && existsSync(join(dir, file)) ? readFileSync(join(dir, file), 'utf8').trim() : '';
  return `${name}@${version} (${license})\n\n${text}`;
});
writeFileSync(
  join(here, 'dist/licenses.txt'),
  `Third-party packages bundled into dist/index.mjs\n\n${licenses.join('\n\n---\n\n')}\n`
);

const schemaBuild = await esbuild.build({
  ...shared,
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
