// E2E driver: injected into the webview by the Rust harness (--e2e).
// Exercises every shipped feature against the fixture repo at
// window.__E2E_ROOT__ and reports JSON via the e2e_report command.
// Monaco is VS Code's editor verbatim, so the editor-behavior cases below
// drive the same code paths VS Code's own editor tests cover (models,
// edits, undo, diff mapping, cursor/selection).
(async () => {
  const results = [];
  const pass = (name) => results.push({ name, ok: true });
  const fail = (name, detail) => results.push({ name, ok: false, detail: String(detail).slice(0, 300) });
  const check = async (name, fn) => {
    try {
      await fn();
      pass(name);
    } catch (e) {
      fail(name, e && e.message ? e.message : e);
    }
  };
  const assert = (cond, msg) => {
    if (!cond) throw new Error(msg);
  };

  const T = window.__e2e;
  const root = window.__E2E_ROOT__;

  await check('boot: e2e hook and fixture root present', async () => {
    assert(T && root, 'missing __e2e or __E2E_ROOT__');
  });

  await check('folder: openRoot lists tree', async () => {
    await T.openRoot(root);
    const tree = await T.api.listDir(root);
    const names = tree.map((n) => n.name);
    assert(names.includes('a.txt') && names.includes('src'), `tree: ${names}`);
  });

  await check('file: open shows content in editor model', async () => {
    await T.openFile('a.txt');
    const v = T.editor().getModel().getValue();
    assert(v === 'one\ntwo\n', `model value: ${JSON.stringify(v)}`);
    assert(T.state().active === 'a.txt', 'a.txt not active');
  });

  await check('edit: insert + undo round-trip in Monaco model', async () => {
    const ed = T.editor();
    const model = ed.getModel();
    model.setValue('one\ntwo\n');
    ed.executeEdits('e2e', [{ range: new T.monaco.Range(3, 1, 3, 1), text: 'three\n', forceMoveMarkers: true }]);
    assert(model.getValue() === 'one\ntwo\nthree\n', 'insert failed');
    ed.trigger('e2e', 'undo', null);
    assert(model.getValue() === 'one\ntwo\n', 'undo failed');
    ed.setPosition({ lineNumber: 2, column: 2 });
    const pos = ed.getPosition();
    assert(pos.lineNumber === 2 && pos.column === 2, 'cursor move failed');
  });

  await check('save: persists to disk', async () => {
    await T.api.writeFile(root, 'a.txt', 'one\ntwo\n');
    await T.openFile('a.txt');
    const ed = T.editor();
    ed.getModel().setValue('one\ntwo\n');
    ed.executeEdits('e2e', [{ range: new T.monaco.Range(3, 1, 3, 1), text: 'three\n', forceMoveMarkers: true }]);
    await T.saveActive();
    const disk = await T.api.readFile(root, 'a.txt');
    assert(disk.content === 'one\ntwo\nthree\n', 'disk content mismatch');
    await T.api.writeFile(root, 'a.txt', 'one\ntwo\n'); // restore fixture
  });

  await check('binary: refused with flag', async () => {
    const res = await T.api.readFile(root, 'blob.bin');
    assert(res.binary === true && res.content === null, 'binary not flagged');
  });

  await check('git: status, branch, head content', async () => {
    assert((await T.api.gitIsRepo(root)) === true, 'not a repo');
    const st = await T.api.gitStatus(root);
    const paths = st.map((f) => f.path);
    assert(paths.includes('a.txt') && paths.includes('c-new.txt'), `status: ${paths}`);
    assert((await T.api.gitBranch(root)).length > 0, 'empty branch');
    assert((await T.api.gitShowHead(root, 'a.txt')) === 'one\n', 'head mismatch');
    assert((await T.api.gitShowHead(root, 'c-new.txt')) === '', 'new file head should be empty');
  });

  await check('diff: side-by-side original vs modified', async () => {
    await T.api.writeFile(root, 'a.txt', 'one\ntwo\n');
    await T.openDiff('a.txt');
    assert(T.state().viewingDiff === 'a.txt', 'diff not viewing');
    const m = T.diffEditor().getModel();
    assert(m.original.getValue() === 'one\n', 'diff original wrong');
    assert(m.modified.getValue() === 'one\ntwo\n', 'diff modified wrong');
    // Diff computation is async: wait for the update event (or timeout).
    await new Promise((resolve) => {
      if (T.diffEditor().getLineChanges()) return resolve();
      const d = T.diffEditor().onDidUpdateDiff(() => {
        d.dispose();
        resolve();
      });
      setTimeout(() => {
        d.dispose();
        resolve();
      }, 3000);
    });
    const changes = T.diffEditor().getLineChanges();
    assert(changes && changes.length >= 1, 'no line changes computed');
  });

  await check('diff: stepChange cycles changed files', async () => {
    const before = T.state().viewingDiff;
    T.stepChange(1);
    await new Promise((r) => setTimeout(r, 300));
    assert(T.state().viewingDiff && T.state().viewingDiff !== before, 'step did not advance');
  });

  await check('editor: mapped languages registered', async () => {
    const ids = T.monaco.languages.getLanguages().map((l) => l.id);
    for (const want of ['typescript', 'python', 'rust', 'go', 'markdown', 'json', 'shell']) {
      assert(ids.includes(want), `language missing: ${want}`);
    }
  });

  await check('search: finds content hit', async () => {
    const hits = await T.api.search(root, 'needle-e2e');
    assert(hits.length === 1 && hits[0].path === 'src/b.py', `hits: ${JSON.stringify(hits)}`);
  });

  await check('tabs: open two, close one', async () => {
    await T.openFile('src/b.py');
    assert(T.state().tabs.length >= 2, `tabs: ${T.state().tabs}`);
    T.closeTab('src/b.py');
    assert(!T.state().tabs.includes('src/b.py'), 'tab not closed');
  });

  await check('traversal: escapes rejected', async () => {
    for (const bad of ['../x', '/etc/hostname', '']) {
      let threw = false;
      try {
        await T.api.readFile(root, bad);
      } catch {
        threw = true;
      }
      assert(threw, `readFile accepted ${JSON.stringify(bad)}`);
    }
    let threw = false;
    try {
      await T.api.writeFile(root, '../../tmp/e2e-evil', 'x');
    } catch {
      threw = true;
    }
    assert(threw, 'writeFile accepted escape');
  });

  await check('local-only: no remote resources loaded', async () => {
    const res = performance.getEntriesByType('resource').map((r) => r.name);
    const remote = res.filter((u) => u.startsWith('http://') || u.startsWith('https://'));
    // In dev mode the frontend itself is served from localhost: ignore it.
    const nonLocal = remote.filter((u) => !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u));
    assert(nonLocal.length === 0, `remote: ${nonLocal}`);
  });

  const failed = results.filter((r) => !r.ok).length;
  const report = JSON.stringify({ passed: results.length - failed, failed, results });
  try {
    await T.e2eReport(report);
  } catch (e) {
    document.title = `E2E_REPORT_FAILED:${e}`;
  }
})();
