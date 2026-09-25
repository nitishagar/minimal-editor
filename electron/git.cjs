// Shared git helpers (plain Node, unit-testable). All commands run with
// `git -C <root>` and never touch the network (no fetch/pull/push here).
const { execFile } = require('node:child_process');

function runGit(root, args) {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', root, ...args], { maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`git ${args.join(' ')} failed: ${(stderr || err.message).trim()}`));
      } else {
        resolve(stdout);
      }
    });
  });
}

async function isRepo(root) {
  try {
    const out = await runGit(root, ['rev-parse', '--is-inside-work-tree']);
    return out.trim() === 'true';
  } catch {
    return false;
  }
}

async function status(root) {
  // Porcelain v2 gives stable machine-readable paths.
  const out = await runGit(root, ['status', '--porcelain=v2', '--untracked-files=normal']);
  const files = [];
  for (const line of out.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const kind = line[0];
    if (kind === '1' || kind === '2') {
      // "1 <xy> <subm> <mH> <mI> <mW> <hH> <hI> <path>" (v2 "2" adds R-score + orig path)
      const parts = line.split(' ');
      const p = kind === '1' ? parts.slice(8).join(' ') : parts.slice(9).join(' ');
      files.push({ code: parts[1], path: p });
    } else if (kind === '?') {
      files.push({ code: '??', path: line.slice(2) });
    }
  }
  return files;
}

// Reject absolute paths and `..` escapes before they reach git. (Git would
// constrain `HEAD:path` lookups to the repo anyway; this fails fast.)
function assertRepoPath(file) {
  if (typeof file !== 'string' || !file || file.startsWith('/') || file.split('/').includes('..')) {
    throw new Error(`rejected repo path: ${String(file).slice(0, 80)}`);
  }
}

async function diff(root, file) {
  // Worktree diff for one path against HEAD.
  assertRepoPath(file);
  try {
    return await runGit(root, ['diff', 'HEAD', '--', file]);
  } catch {
    return '';
  }
}

async function showHead(root, file) {
  // Original content of a path at HEAD; empty string when the file is new.
  assertRepoPath(file);
  try {
    return await runGit(root, ['show', `HEAD:${file}`]);
  } catch {
    return '';
  }
}

async function log(root, n = 20) {
  const out = await runGit(root, ['log', `--max-count=${n}`, '--format=%h %s']);
  return out.trim() ? out.trim().split('\n') : [];
}

async function branch(root) {
  try {
    return (await runGit(root, ['branch', '--show-current'])).trim();
  } catch {
    return '';
  }
}

module.exports = { isRepo, status, diff, showHead, log, branch };
