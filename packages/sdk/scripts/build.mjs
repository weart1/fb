import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const SIZE_LIMIT = 10 * 1024; // core bundle, gzipped
const sizeOnly = process.argv.includes('--size');

rmSync('dist', { recursive: true, force: true });
const common = { bundle: true, target: ['es2019', 'safari13'], legalComments: 'none', logLevel: 'warning' };

await Promise.all([
  // <script> bundles
  build({ ...common, entryPoints: ['src/browser.ts'], outfile: 'dist/weart.js', format: 'iife', minify: true }),
  build({ ...common, entryPoints: ['src/replay.ts'], outfile: 'dist/weart-replay.js', format: 'iife', minify: true }),
  // npm (ESM) entries
  build({ ...common, entryPoints: ['src/index.ts'], outfile: 'dist/index.js', format: 'esm', minify: false }),
  build({ ...common, entryPoints: ['src/replay.ts'], outfile: 'dist/replay.js', format: 'esm', external: ['@rrweb/record'] }),
]);

if (!sizeOnly) {
  execFileSync('npx', ['tsc', '-p', 'tsconfig.build.json'], { stdio: 'inherit' });
}

const report = (file) => {
  const buf = readFileSync(file);
  const gz = gzipSync(buf, { level: 9 }).length;
  console.log(`${file.padEnd(24)} ${(buf.length / 1024).toFixed(1).padStart(7)} KB  ${(gz / 1024).toFixed(2).padStart(6)} KB gz`);
  return gz;
};
const core = report('dist/weart.js');
report('dist/weart-replay.js');
if (core > SIZE_LIMIT) {
  console.error(`\n✖ core bundle is ${(core / 1024).toFixed(2)} KB gz, limit is ${SIZE_LIMIT / 1024} KB`);
  process.exit(1);
}
console.log(`\n✔ core bundle within ${SIZE_LIMIT / 1024} KB gz budget`);
