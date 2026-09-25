// minimal-editor: one window, local-only commands. No network, no updates,
// no phone-home, no extension host — just a folder dialog and local fs/git.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod core;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use tauri::Manager;

use core::fs::{ReadResult, SearchHit, TreeNode};
use core::git::ChangedFile;

// ---------- Tauri commands (see src/api.ts) ----------

#[tauri::command]
fn list_dir(root: String) -> Result<Vec<TreeNode>, String> {
    core::fs::list_tree(&root)
}

#[tauri::command]
fn read_file(root: String, rel: String) -> Result<ReadResult, String> {
    core::fs::read_file(&root, &rel)
}

#[tauri::command]
fn write_file(root: String, rel: String, content: String) -> Result<bool, String> {
    core::fs::write_file(&root, &rel, &content)
}

#[tauri::command]
fn search(root: String, query: String) -> Result<Vec<SearchHit>, String> {
    core::fs::search(&root, &query)
}

#[tauri::command]
fn git_is_repo(root: String) -> Result<bool, String> {
    Ok(core::git::is_repo(&root))
}

#[tauri::command]
fn git_status(root: String) -> Result<Vec<ChangedFile>, String> {
    core::git::status(&root)
}

#[tauri::command]
fn git_show_head(root: String, rel: String) -> Result<String, String> {
    core::git::show_head(&root, &rel)
}

#[tauri::command]
fn git_branch(root: String) -> Result<String, String> {
    core::git::branch(&root)
}

// ---------- E2E harness ----------

/// Fired by the webview once Tauri IPC is up; the harness then injects the driver.
#[tauri::command]
fn e2e_ready(flag: tauri::State<'_, Arc<AtomicBool>>) -> Result<(), String> {
    flag.store(true, Ordering::SeqCst);
    Ok(())
}

/// Receives the driver's JSON report and forwards it to the waiting thread.
#[tauri::command]
fn e2e_report(
    payload: String,
    tx: tauri::State<'_, Arc<Mutex<Option<mpsc::Sender<String>>>>>,
) -> Result<(), String> {
    if let Some(tx) = tx.lock().unwrap().take() {
        tx.send(payload).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Build a deterministic fixture repo for the e2e driver and return its path.
fn build_fixture() -> Result<String, String> {
    use std::process::Command;
    let dir = std::env::temp_dir().join(format!("minimal-editor-e2e-{}", std::process::id()));
    if dir.exists() {
        std::fs::remove_dir_all(&dir).ok();
    }
    std::fs::create_dir_all(dir.join("src")).map_err(|e| e.to_string())?;
    let sh = |args: &[&str]| -> Result<(), String> {
        let st = Command::new("git")
            .args(args)
            .current_dir(&dir)
            .status()
            .map_err(|e| e.to_string())?;
        if st.success() {
            Ok(())
        } else {
            Err(format!("git {args:?} failed"))
        }
    };
    std::fs::write(dir.join("a.txt"), "one\n").map_err(|e| e.to_string())?;
    std::fs::write(dir.join("src/b.py"), "print(1)\n").map_err(|e| e.to_string())?;
    sh(&["init", "-q"])?;
    sh(&["config", "user.email", "e2e@e2e"])?;
    sh(&["config", "user.name", "e2e"])?;
    sh(&["config", "commit.gpgsign", "false"])?;
    sh(&["add", "."])?;
    sh(&["commit", "-qm", "init"])?;
    // Dirty state the driver asserts on: 2 modified + 1 untracked + 1 binary.
    std::fs::write(dir.join("a.txt"), "one\ntwo\n").map_err(|e| e.to_string())?;
    std::fs::write(dir.join("src/b.py"), "print(1)\nprint(2)  # needle-e2e\n")
        .map_err(|e| e.to_string())?;
    std::fs::write(dir.join("c-new.txt"), "fresh\n").map_err(|e| e.to_string())?;
    std::fs::write(dir.join("blob.bin"), [0u8, 1, 2]).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

fn percent_encode(path: &str) -> String {
    let mut out = String::with_capacity(path.len());
    for b in path.bytes() {
        if b.is_ascii_alphanumeric() || b"/.-_~".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

fn run_e2e(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
    t0: std::time::Instant,
) -> Result<(), String> {
    let ready = app.state::<Arc<AtomicBool>>();
    // Wait for the webview to signal IPC readiness (it invokes e2e_ready).
    for _ in 0..300 {
        if ready.load(Ordering::SeqCst) {
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    if !ready.load(Ordering::SeqCst) {
        return Err("e2e: webview never became ready".into());
    }
    println!("BOOT_MS:{}", t0.elapsed().as_millis());
    let fixture = build_fixture()?;
    let fixture_js = serde_json::to_string(&fixture).map_err(|e| e.to_string())?;
    window
        .eval(format!("window.__E2E_ROOT__={fixture_js}"))
        .map_err(|e| e.to_string())?;
    window
        .eval(include_str!("../../e2e/driver.js"))
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn run() {
    let t0 = std::time::Instant::now();
    let args: Vec<String> = std::env::args().skip(1).collect();
    let e2e = args.iter().any(|a| a == "--e2e");
    // `--root <path>` or a bare positional path; both open that folder at boot.
    let mut start_root: Option<String> = None;
    let mut iter = args.iter();
    while let Some(a) = iter.next() {
        if a == "--root" {
            start_root = iter.next().cloned();
        } else if !a.starts_with('-') && start_root.is_none() {
            start_root = Some(a.clone());
        }
    }

    let ready_flag: Arc<AtomicBool> = Arc::new(AtomicBool::new(false));
    let (tx, rx) = mpsc::channel::<String>();
    let tx_state: Arc<Mutex<Option<mpsc::Sender<String>>>> = Arc::new(Mutex::new(Some(tx)));

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(ready_flag)
        .manage(tx_state)
        .invoke_handler(tauri::generate_handler![
            list_dir,
            read_file,
            write_file,
            search,
            git_is_repo,
            git_status,
            git_show_head,
            git_branch,
            e2e_ready,
            e2e_report
        ])
        .setup(move |app| {
            let url = if e2e {
                "index.html?e2e=1".to_string()
            } else if let Some(root) = &start_root {
                format!("index.html?root={}", percent_encode(root))
            } else {
                "index.html".to_string()
            };
            let window = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App(url.into()),
            )
            .title("minimal-editor")
            .inner_size(1280.0, 800.0)
            .build()?;
            if e2e {
                // The whole e2e flow runs off-thread: setup must return so the
                // event loop (and the webview) can start.
                let handle = app.handle().clone();
                let win = window.clone();
                std::thread::spawn(move || {
                    if let Err(e) = run_e2e(&handle, &win, t0) {
                        eprintln!("{e}");
                        handle.exit(1);
                        return;
                    }
                    // Wait for the report (or time out) and exit with its verdict.
                    match rx.recv_timeout(Duration::from_secs(120)) {
                        Ok(json) => {
                            println!("E2E_JSON:{json}");
                            let ok = json.contains("\"failed\":0");
                            handle.exit(if ok { 0 } else { 1 });
                        }
                        Err(_) => {
                            eprintln!("e2e: timed out waiting for driver report");
                            handle.exit(1);
                        }
                    }
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn main() {
    run()
}
