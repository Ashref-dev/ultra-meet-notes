#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const args = process.argv.slice(2);
const scriptDir = __dirname;

const tauri = spawnSync('tauri', args, { stdio: 'inherit', cwd: path.resolve(scriptDir, '..') });
process.exit(tauri.status ?? 0);
