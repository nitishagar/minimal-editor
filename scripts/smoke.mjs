// Smoke test: verifies a production build exists and boots in Electron.
// Run: npm run build && npm run smoke   (under xvfb-run on headless CI)
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fail = (msg) => {
  console.error(`SMOKE FAIL: ${msg}`);
  process.exit(1);
};

const html = path.join(root, 'dist', 'index.html');
if (!existsSync(html)) fail('dist/index.html missing — run `npm run build` first');
console.log(`dist/index.html present (${statSync(html).size} bytes)`);

const electron = require('electron');
const app = spawn(electron, ['.', '--smoke', '--no-sandbox', '--disable-gpu'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
});

let err = '';
app.stderr.on('data', (d) => {
  err += d;
});
app.stdout.on('data', (d) => {
  process.stdout.write(`[app] ${d}`);
});

const timeout = setTimeout(() => {
  app.kill('SIGKILL');
  fail('app did not exit within 45s\n' + err.slice(-2000));
}, 45000);

app.on('close', (code) => {
  clearTimeout(timeout);
  if (code !== 0) fail(`app exited with code ${code}\n${err.slice(-2000)}`);
  console.log('smoke ok: app booted and exited cleanly');
});
