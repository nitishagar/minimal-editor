// Cross-platform env wrapper: sets the user-space webkit header env on
// machines that have ~/.webkit (no-op everywhere else, including CI),
// then execs the given command. Replaces `. ./scripts/env.sh && ...`,
// which only works in sh.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const wk = path.join(os.homedir(), '.webkit');
const env = { ...process.env };
if (existsSync(path.join(wk, 'usr/lib/x86_64-linux-gnu/pkgconfig'))) {
  env.PKG_CONFIG_PATH = [
    path.join(wk, 'usr/lib/x86_64-linux-gnu/pkgconfig'),
    path.join(wk, 'usr/share/pkgconfig'),
  ].join(':');
  env.PKG_CONFIG_SYSROOT_DIR = wk;
}

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error('usage: with-env.mjs <cmd> [args...]');
  process.exit(2);
}
const r = spawnSync(cmd, args, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env,
});
process.exit(r.status ?? 1);
