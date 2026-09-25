// Frontend API adapter. Same surface the renderer has always used; backed by
// Tauri commands (src-tauri/src/main.rs) instead of Electron IPC.
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';

export interface TreeNode {
  type: 'dir' | 'file';
  name: string;
  path: string;
  size?: number;
  children?: TreeNode[];
}
export interface ReadResult {
  content: string | null;
  truncated: boolean;
  binary: boolean;
  size: number;
}
export interface ChangedFile {
  code: string;
  path: string;
}
export interface SearchHit {
  path: string;
  line: number;
  preview: string;
}
export interface Api {
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

// E2E harness channel (used only with ?e2e=1).
export const e2eReady = (): Promise<void> => invoke('e2e_ready');
export const e2eReport = (payload: string): Promise<void> => invoke('e2e_report', { payload });

export const api: Api = {
  openFolder: () => open({ directory: true }),
  listDir: (root) => invoke('list_dir', { root }),
  readFile: (root, rel) => invoke('read_file', { root, rel }),
  writeFile: (root, rel, content) => invoke('write_file', { root, rel, content }),
  search: (root, query) => invoke('search', { root, query }),
  gitIsRepo: (root) => invoke('git_is_repo', { root }),
  gitStatus: (root) => invoke('git_status', { root }),
  gitShowHead: (root, rel) => invoke('git_show_head', { root, rel }),
  gitBranch: (root) => invoke('git_branch', { root }),
};
