// Unit tests for electron/files.cjs against a temp fixture tree.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const files = require('../electron/files.cjs');

let tmp;
before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'me-files-'));
  await fs.mkdir(path.join(tmp, 'src', 'sub'), { recursive: true });
  await fs.mkdir(path.join(tmp, 'node_modules', 'dep'), { recursive: true });
  await fs.writeFile(path.join(tmp, 'src', 'a.ts'), 'export const x = 1;\n');
  await fs.writeFile(path.join(tmp, 'src', 'sub', 'b.py'), 'print("needle-here")\n');
  await fs.writeFile(path.join(tmp, 'README.md'), '# hello\n');
  await fs.writeFile(path.join(tmp, 'node_modules', 'dep', 'x.js'), 'needle-here\n');
  await fs.writeFile(path.join(tmp, 'blob.bin'), Buffer.from([0, 1, 2, 3]));
});

after(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('files.cjs', () => {
  it('listTree skips node_modules and sorts dirs first', async () => {
    const tree = await files.listTree(tmp);
    const names = tree.map((n) => n.name);
    assert.ok(!names.includes('node_modules'));
    assert.deepEqual(names, ['src', 'blob.bin', 'README.md']);
    assert.equal(tree[0].children[0].name, 'sub');
  });

  it('readFile detects binary files', async () => {
    const res = await files.readFile(tmp, 'blob.bin');
    assert.equal(res.binary, true);
    assert.equal(res.content, null);
  });

  it('readFile returns utf8 content', async () => {
    const res = await files.readFile(tmp, 'src/a.ts');
    assert.equal(res.content, 'export const x = 1;\n');
  });

  it('writeFile round-trips', async () => {
    await files.writeFile(tmp, 'src/new.txt', 'hi');
    const res = await files.readFile(tmp, 'src/new.txt');
    assert.equal(res.content, 'hi');
  });

  it('search finds content hits but not inside node_modules', async () => {
    const hits = await files.search(tmp, 'needle-here');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].path, 'src/sub/b.py');
    assert.equal(hits[0].line, 1);
  });

  it('search matches filenames', async () => {
    const hits = await files.search(tmp, 'README');
    assert.ok(hits.some((h) => h.path === 'README.md'));
  });

  it('readFile/writeFile reject paths escaping root', async () => {
    await assert.rejects(() => files.readFile(tmp, '../outside.txt'), /outside root/);
    await assert.rejects(() => files.readFile(tmp, '/etc/hostname'), /outside root/);
    await assert.rejects(() => files.writeFile(tmp, '../../tmp/evil.txt', 'x'), /outside root/);
    await assert.rejects(() => files.writeFile(tmp, '', 'x'), /outside root/);
  });
});
