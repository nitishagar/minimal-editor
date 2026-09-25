import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import './styles.css';

self.MonacoEnvironment = { getWorker: () => new editorWorker() };

// ---- Preload API surface (see electron/preload.cjs) ----
interface TreeNode {
  type: 'dir' | 'file';
  name: string;
  path: string;
  size?: number;
  children?: TreeNode[];
}
interface ReadResult {
  content: string | null;
  truncated: boolean;
  binary: boolean;
  size: number;
}
interface ChangedFile {
  code: string;
  path: string;
}
interface SearchHit {
  path: string;
  line: number;
  preview: string;
}
interface Api {
  openFolder: () => Promise<string | null>;
  listDir: (root: string) => Promise<TreeNode[]>;
  readFile: (root: string, rel: string) => Promise<ReadResult>;
  writeFile: (root: string, rel: string, content: string) => Promise<boolean>;
  search: (root: string, query: string) => Promise<SearchHit[]>;
  gitIsRepo: (root: string) => Promise<boolean>;
  gitStatus: (root: string) => Promise<ChangedFile[]>;
  gitShowHead: (root: string, rel: string) => Promise<string>;
  gitBranch: (root: string) => Promise<string>;
}
declare global {
  interface Window {
    api: Api;
  }
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;

const EXT_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescriptreact', js: 'javascript', jsx: 'javascript',
  mjs: 'javascript', cjs: 'javascript', json: 'json', md: 'markdown',
  markdown: 'markdown', py: 'python', c: 'c', h: 'cpp', cpp: 'cpp', hpp: 'cpp',
  rs: 'rust', go: 'go', java: 'java', kt: 'kotlin', css: 'css', scss: 'scss',
  html: 'html', htm: 'html', xml: 'xml', yml: 'yaml', yaml: 'yaml',
  toml: 'plaintext', sh: 'shell', bash: 'shell', sql: 'sql', vue: 'html',
  svelte: 'html', txt: 'plaintext', log: 'plaintext',
};
const langOf = (p: string) =>
  EXT_LANG[p.split('.').pop()?.toLowerCase() ?? ''] ?? 'plaintext';

// ---- State ----
let root: string | null = null;
let tree: TreeNode[] = [];
let changed: ChangedFile[] = [];
let tabs: { path: string; saved: string }[] = [];
let active: string | null = null;
let models = new Map<string, monaco.editor.ITextModel>();
let viewingDiff: string | null = null;
let mode: 'files' | 'changes' | 'search' = 'files';
let searchHits: SearchHit[] = [];

// ---- Editors ----
const editorHost = $('editor');
const viewHost = document.createElement('div');
viewHost.id = 'view';
const diffHost = document.createElement('div');
diffHost.id = 'diff';
diffHost.style.display = 'none';
editorHost.append(viewHost, diffHost);

const editor = monaco.editor.create(viewHost, {
  theme: 'vs-dark',
  automaticLayout: true,
  minimap: { enabled: false },
  fontSize: 13,
  fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
  scrollBeyondLastLine: false,
  renderWhitespace: 'boundary',
});
const diffEditor = monaco.editor.createDiffEditor(diffHost, {
  theme: 'vs-dark',
  automaticLayout: true,
  minimap: { enabled: false },
  fontSize: 13,
  fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
  scrollBeyondLastLine: false,
  renderSideBySide: true,
});

function setStatus(left: string, right = '') {
  $('status-left').textContent = left;
  $('status-right').textContent = right;
}

function showEmpty(show: boolean) {
  $('empty').style.display = show ? 'flex' : 'none';
  editorHost.style.display = show ? 'none' : 'block';
}

// ---- Tabs ----
function renderTabs() {
  const bar = $('tabs');
  bar.innerHTML = '';
  for (const t of tabs) {
    const el = document.createElement('div');
    el.className = 'tab' + (t.path === active && !viewingDiff ? ' active' : '');
    const m = models.get(t.path);
    const dirty = m && m.getValue() !== t.saved;
    const label = document.createElement('span');
    label.textContent = (dirty ? '● ' : '') + t.path.split('/').pop();
    label.title = t.path;
    const x = document.createElement('button');
    x.className = 'tab-x';
    x.textContent = '×';
    x.onclick = (e) => {
      e.stopPropagation();
      closeTab(t.path);
    };
    el.onclick = () => openFile(t.path);
    el.append(label, x);
    bar.append(el);
  }
}

function closeTab(path: string) {
  tabs = tabs.filter((t) => t.path !== path);
  models.get(path)?.dispose();
  models.delete(path);
  if (active === path) {
    active = tabs.length ? tabs[tabs.length - 1].path : null;
    editor.setModel(active ? models.get(active)! : null);
  }
  viewingDiff = null;
  syncView();
  renderTabs();
}

// ---- Sidebar ----
function renderSidebar() {
  const side = $('sidebar');
  side.innerHTML = '';
  $('tab-files').classList.toggle('active', mode === 'files');
  $('tab-changes').classList.toggle('active', mode === 'changes');
  if (!root) {
    side.innerHTML = '<div class="hint">No folder open.<br>Press Ctrl+O.</div>';
    return;
  }
  if (mode === 'search') return renderSearchResults(side);
  if (mode === 'changes') return renderChanges(side);
  const ul = document.createElement('ul');
  ul.className = 'tree';
  for (const n of tree) ul.append(treeNode(n));
  side.append(ul);
}

function treeNode(n: TreeNode): HTMLElement {
  const li = document.createElement('li');
  if (n.type === 'dir') {
    const row = document.createElement('div');
    row.className = 'tree-dir';
    row.innerHTML = `<span class="twisty">▸</span><span></span>`;
    row.lastChild!.textContent = n.name;
    const kids = document.createElement('ul');
    kids.className = 'tree nested collapsed';
    for (const c of n.children ?? []) kids.append(treeNode(c));
    row.onclick = () => {
      const open = kids.classList.toggle('collapsed');
      row.querySelector('.twisty')!.textContent = open ? '▸' : '▾';
    };
    li.append(row, kids);
  } else {
    const row = document.createElement('div');
    row.className = 'tree-file' + (n.path === active ? ' active' : '');
    row.textContent = n.name;
    row.title = n.path;
    row.onclick = () => openFile(n.path);
    li.append(row);
  }
  return li;
}

function renderChanges(side: HTMLElement) {
  if (!changed.length) {
    side.innerHTML = '<div class="hint">No changes.<br>Working tree clean.</div>';
    return;
  }
  for (const c of changed) {
    const row = document.createElement('div');
    row.className = 'change-row' + (c.path === viewingDiff ? ' active' : '');
    const badge = document.createElement('span');
    badge.className = 'badge ' + badgeClass(c.code);
    badge.textContent = c.code.trim() || 'M';
    const name = document.createElement('span');
    name.textContent = c.path;
    name.title = c.path;
    row.append(badge, name);
    row.onclick = () => openDiff(c.path);
    side.append(row);
  }
}

function badgeClass(code: string): string {
  const c = code.trim();
  if (c === '??') return 'b-new';
  if (c.includes('D')) return 'b-del';
  if (c.includes('R')) return 'b-ren';
  return 'b-mod';
}

function renderSearchResults(side: HTMLElement) {
  if (!searchHits.length) {
    side.innerHTML = '<div class="hint">No matches.</div>';
    return;
  }
  for (const h of searchHits) {
    const row = document.createElement('div');
    row.className = 'hit-row';
    const p = document.createElement('div');
    p.className = 'hit-path';
    p.textContent = h.line ? `${h.path}:${h.line}` : h.path;
    const prev = document.createElement('div');
    prev.className = 'hit-prev';
    prev.textContent = h.preview;
    row.append(p, prev);
    row.onclick = () => openFile(h.path, h.line || undefined);
    side.append(row);
  }
}

// ---- Open file / diff ----
async function openFile(path: string, line?: number) {
  if (!root) return;
  viewingDiff = null;
  let m = models.get(path);
  if (!m) {
    let res: ReadResult;
    try {
      res = await window.api.readFile(root, path);
    } catch (e) {
      setStatus(`Cannot open ${path}: ${(e as Error).message}`);
      return;
    }
    if (res.binary) {
      setStatus(`${path}: binary file, not shown`);
      return;
    }
    if (res.content === null) {
      setStatus(`${path}: too large (${Math.round(res.size / 1024)} KiB), not shown`);
      return;
    }
    m = monaco.editor.createModel(res.content, langOf(path), monaco.Uri.parse(`file:///${path}`));
    models.set(path, m);
    if (!tabs.find((t) => t.path === path)) tabs.push({ path, saved: res.content });
    m.onDidChangeModelContent(() => renderTabs());
  }
  active = path;
  editor.setModel(m);
  if (line) editor.revealLineInCenter(line);
  syncView();
  renderTabs();
  renderSidebar();
  setStatus(path);
}

async function openDiff(path: string) {
  if (!root) return;
  viewingDiff = path;
  active = path;
  let current = '';
  try {
    const res = await window.api.readFile(root, path);
    if (res.binary) {
      setStatus(`${path}: binary file, diff not shown`);
      return;
    }
    if (res.content === null) {
      setStatus(`${path}: too large (${Math.round(res.size / 1024)} KiB), diff not shown`);
      return;
    }
    current = res.content;
  } catch {
    current = '';
  }
  const original = await window.api.gitShowHead(root, path).catch(() => '');
  const lang = langOf(path);
  // Dispose the previous diff models to avoid leaking one pair per navigation.
  const prev = diffEditor.getModel();
  if (prev) {
    prev.original.dispose();
    prev.modified.dispose();
  }
  const origModel = monaco.editor.createModel(original, lang);
  const modModel = monaco.editor.createModel(current, lang);
  diffEditor.setModel({ original: origModel, modified: modModel });
  syncView();
  renderTabs();
  renderSidebar();
  setStatus(`diff ${path}`);
}

function syncView() {
  const showDiff = viewingDiff !== null;
  viewHost.style.display = showDiff ? 'none' : 'block';
  diffHost.style.display = showDiff ? 'block' : 'none';
  showEmpty(active === null);
  editor.layout();
  diffEditor.layout();
}

function stepChange(dir: 1 | -1) {
  if (!changed.length) return;
  const i = changed.findIndex((c) => c.path === viewingDiff);
  const next = changed[(i + dir + changed.length) % changed.length];
  openDiff(next.path);
}

// ---- Folder / refresh ----
async function openRoot(p: string) {
  root = p;
  tabs = [];
  active = null;
  viewingDiff = null;
  for (const m of models.values()) m.dispose();
  models.clear();
  editor.setModel(null);
  const prevDiff = diffEditor.getModel();
  if (prevDiff) {
    prevDiff.original.dispose();
    prevDiff.modified.dispose();
    diffEditor.setModel(null);
  }
  await refreshAll();
}

async function refreshAll() {
  if (!root) return;
  setStatus('Loading…');
  try {
    tree = await window.api.listDir(root);
    const repo = await window.api.gitIsRepo(root);
    changed = repo ? await window.api.gitStatus(root) : [];
    const branch = repo ? await window.api.gitBranch(root) : '';
    renderSidebar();
    setStatus(
      root,
      repo ? `${branch || 'detached'} · ${changed.length} changed` : 'not a git repo',
    );
  } catch (e) {
    setStatus(`Error: ${(e as Error).message}`);
  }
}

async function saveActive() {
  if (!root || !active) return;
  if (viewingDiff) {
    setStatus('Diff view is read-only — open the file from Files to edit');
    return;
  }
  const m = models.get(active);
  if (!m) return;
  await window.api.writeFile(root, active, m.getValue());
  const t = tabs.find((t) => t.path === active);
  if (t) t.saved = m.getValue();
  renderTabs();
  setStatus(`Saved ${active}`);
  changed = await window.api.gitStatus(root).catch(() => changed);
  if (mode === 'changes') renderSidebar();
}

// ---- Events ----
$('btn-open').onclick = async () => {
  const p = await window.api.openFolder();
  if (p) openRoot(p);
};
$('tab-files').onclick = () => {
  mode = 'files';
  renderSidebar();
};
$('tab-changes').onclick = async () => {
  mode = 'changes';
  if (root && (await window.api.gitIsRepo(root))) {
    changed = await window.api.gitStatus(root);
  }
  renderSidebar();
};
$('search').addEventListener('keydown', async (e) => {
  const input = e.target as HTMLInputElement;
  if (e.key === 'Enter' && root && input.value.trim()) {
    searchHits = await window.api.search(root, input.value.trim());
    mode = 'search';
    renderSidebar();
    setStatus(`${searchHits.length} matches for "${input.value.trim()}"`);
  } else if (e.key === 'Escape') {
    input.value = '';
    mode = 'files';
    renderSidebar();
  }
});
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
    e.preventDefault();
    $('btn-open').click();
  } else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    saveActive();
  } else if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
    e.preventDefault();
    if (active) closeTab(active);
  } else if (e.key === ']' && viewingDiff && document.activeElement?.tagName !== 'INPUT') {
    stepChange(1);
  } else if (e.key === '[' && viewingDiff && document.activeElement?.tagName !== 'INPUT') {
    stepChange(-1);
  }
});
editor.onDidChangeCursorPosition((e) => {
  $('status-right').textContent = `Ln ${e.position.lineNumber}, Col ${e.position.column}`;
});

// ---- Boot ----
showEmpty(true);
renderTabs();
renderSidebar();
const bootRoot = new URLSearchParams(location.search).get('root');
if (bootRoot) openRoot(bootRoot);
(function markReady() {
  // Signal for automated smoke tests that the renderer booted.
  (window as unknown as { __ready: boolean }).__ready = true;
})();
