// Shared filesystem helpers (plain Node, unit-testable).
const { promises: fs } = require('node:fs');
const path = require('node:path');

const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'out', 'build', '__pycache__',
  '.venv', 'target', '.cache', '.idea', '.vscode',
]);

const MAX_TREE_ENTRIES = 8000;
const MAX_FILE_BYTES = 1024 * 1024; // 1 MiB preview cap
const MAX_RESULTS = 200;

// Resolve `rel` inside `root`; throw on absolute paths, `..` escapes,
// and symlink escapes. Every IPC file operation must go through this.
function resolveInRoot(root, rel) {
  if (typeof rel !== 'string' || !rel || path.isAbsolute(rel)) {
    throw new Error(`rejected path outside root: ${String(rel).slice(0, 80)}`);
  }
  const base = path.resolve(root);
  const full = path.resolve(base, rel);
  if (full !== base && !full.startsWith(base + path.sep)) {
    throw new Error(`rejected path outside root: ${rel.slice(0, 80)}`);
  }
  return full;
}

async function listTree(root, rel = '', depth = 0, budget = { n: 0 }) {
  const dir = path.join(root, rel);
  let names;
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  names.sort((a, b) => a.localeCompare(b));
  const out = [];
  for (const name of names) {
    if (budget.n >= MAX_TREE_ENTRIES) break;
    if (SKIP_DIRS.has(name)) continue;
    const childRel = rel ? `${rel}/${name}` : name;
    const full = path.join(root, childRel);
    let st;
    try {
      st = await fs.stat(full);
    } catch {
      continue;
    }
    budget.n += 1;
    if (st.isDirectory()) {
      const children = depth < 12 ? await listTree(root, childRel, depth + 1, budget) : [];
      out.push({ type: 'dir', name, path: childRel, children });
    } else {
      out.push({ type: 'file', name, path: childRel, size: st.size });
    }
  }
  // Directories first, then files.
  out.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
  return out;
}

async function readFile(root, rel) {
  const full = resolveInRoot(root, rel);
  const st = await fs.stat(full);
  if (st.size > MAX_FILE_BYTES) {
    return { content: null, truncated: true, binary: false, size: st.size };
  }
  const buf = await fs.readFile(full);
  if (buf.includes(0)) {
    return { content: null, truncated: false, binary: true, size: st.size };
  }
  return { content: buf.toString('utf8'), truncated: false, binary: false, size: st.size };
}

async function writeFile(root, rel, content) {
  const full = resolveInRoot(root, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, 'utf8');
  return true;
}

const SEARCHABLE = /\.(ts|js|tsx|jsx|mjs|cjs|py|md|markdown|json|txt|css|scss|html|htm|c|h|cpp|hpp|rs|go|java|kt|sh|bash|yml|yaml|toml|xml|vue|svelte|sql)$/i;

async function search(root, query, rel = '', results = []) {
  if (!query || results.length >= MAX_RESULTS) return results;
  const dir = path.join(root, rel);
  let names;
  try {
    names = await fs.readdir(dir);
  } catch {
    return results;
  }
  const q = query.toLowerCase();
  for (const name of names) {
    if (results.length >= MAX_RESULTS) break;
    const childRel = rel ? `${rel}/${name}` : name;
    const full = path.join(root, childRel);
    let st;
    try {
      st = await fs.stat(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      await search(root, query, childRel, results);
    } else {
      if (st.size > MAX_FILE_BYTES) continue;
      if (name.toLowerCase().includes(q)) {
        results.push({ path: childRel, line: 0, preview: name });
        continue;
      }
      if (!SEARCHABLE.test(name)) continue;
      let text;
      try {
        const buf = await fs.readFile(full);
        if (buf.includes(0)) continue;
        text = buf.toString('utf8');
      } catch {
        continue;
      }
      const lines = text.split('\n');
      for (let i = 0; i < lines.length && results.length < MAX_RESULTS; i++) {
        if (lines[i].toLowerCase().includes(q)) {
          results.push({ path: childRel, line: i + 1, preview: lines[i].trim().slice(0, 160) });
          break; // one hit per file keeps results scannable
        }
      }
    }
  }
  return results;
}

module.exports = { SKIP_DIRS, MAX_TREE_ENTRIES, MAX_FILE_BYTES, MAX_RESULTS, listTree, readFile, writeFile, search, resolveInRoot };
