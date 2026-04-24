#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const args = process.argv.slice(2);
const scriptDir = __dirname;
const repoRoot = path.resolve(scriptDir, '..', '..');

const tauri = spawnSync('tauri', args, { stdio: 'inherit', cwd: path.resolve(scriptDir, '..') });
if (tauri.status !== 0) {
  process.exit(tauri.status ?? 1);
}

const isBuild = args.some((a) => a === 'build' || a.startsWith('build:'));
if (!isBuild) {
  process.exit(0);
}

const platform = process.platform;
if (platform !== 'darwin') {
  process.exit(0);
}

const bundle = spawnSync('bash', [path.join(scriptDir, 'bundle-sherpa-libs.sh')], {
  stdio: 'inherit',
  cwd: path.resolve(scriptDir, '..'),
  env: { ...process.env, REPO_ROOT: repoRoot },
});
process.exit(bundle.status ?? 0);
