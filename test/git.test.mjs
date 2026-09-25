// Unit tests for electron/git.cjs against a temp git fixture repo.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const git = require('../electron/git.cjs');

function sh(cwd, ...args) {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

let repo;
let plain;
before(async () => {
  repo = await fs.mkdtemp(path.join(os.tmpdir(), 'me-git-'));
  sh(repo, 'init', '-q');
  sh(repo, 'config', 'user.email', 't@t.t');
  sh(repo, 'config', 'user.name', 't');
  sh(repo, 'config', 'commit.gpgsign', 'false');
  await fs.writeFile(path.join(repo, 'a.txt'), 'one\n');
  sh(repo, 'add', '.');
  sh(repo, 'commit', '-qm', 'init');
  // Modify tracked file + add untracked file.
  await fs.writeFile(path.join(repo, 'a.txt'), 'one\ntwo\n');
  await fs.writeFile(path.join(repo, 'new.txt'), 'fresh\n');

  plain = await fs.mkdtemp(path.join(os.tmpdir(), 'me-plain-'));
});

after(async () => {
  await fs.rm(repo, { recursive: true, force: true });
  await fs.rm(plain, { recursive: true, force: true });
});

describe('git.cjs', () => {
  it('isRepo distinguishes repos from plain dirs', async () => {
    assert.equal(await git.isRepo(repo), true);
    assert.equal(await git.isRepo(plain), false);
  });

  it('status lists modified and untracked files', async () => {
    const files = await git.status(repo);
    const byPath = Object.fromEntries(files.map((f) => [f.path, f.code]));
    assert.ok(byPath['a.txt'], 'modified file listed');
    assert.equal(byPath['new.txt'], '??');
  });

  it('showHead returns HEAD content, empty for new files', async () => {
    assert.equal(await git.showHead(repo, 'a.txt'), 'one\n');
    assert.equal(await git.showHead(repo, 'new.txt'), '');
  });

  it('diff returns a unified diff for modified files', async () => {
    const d = await git.diff(repo, 'a.txt');
    assert.match(d, /^\+two$/m);
  });

  it('diff/showHead reject escaping paths', async () => {
    await assert.rejects(() => git.diff(repo, '../a.txt'), /repo path/);
    await assert.rejects(() => git.showHead(repo, '/etc/hostname'), /repo path/);
  });

  it('branch and log work', async () => {
    const b = await git.branch(repo);
    assert.ok(b.length > 0);
    const entries = await git.log(repo, 5);
    assert.equal(entries.length, 1);
    assert.match(entries[0], /init/);
  });
});
