use super::processes::{
    spawn_dev_server_parent_death_watcher, stop_process_group, DEV_SERVER_STOP_TIMEOUT,
};
use super::state::{build_group_state, dev_server_group_key, sync_group_state};
use super::terminal::{
    emit_terminal_chunk, spawn_terminal_forwarder, DEV_SERVER_TERMINAL_BUFFER_BYTE_LIMIT,
    DEV_SERVER_TERMINAL_BUFFER_CHUNK_LIMIT,
};
use crate::app_service::test_support::{
    build_service_with_state, build_service_with_store, init_git_repo, lock_env, make_task,
    set_env_var, spawn_sleep_process_group, unique_temp_path, wait_for_path_exists,
    wait_for_process_exit, write_executable_script,
};
use crate::app_service::{
    DevServerEmitter, DevServerGroupRuntime, HookTrustConfirmationPort,
    HookTrustConfirmationRequest,
};
use anyhow::Result;
use host_domain::{
    DevServerEvent, DevServerGroupState, DevServerScriptState, DevServerScriptStatus,
    DevServerTerminalChunk, GitCurrentBranch, TaskStatus,
};
use host_infra_system::{AppConfigStore, RepoConfig, RepoDevServerScript};
use std::collections::{HashMap, VecDeque};
use std::fs;
use std::io::{self, Read};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

struct AllowHookTrustConfirmationPort;

impl HookTrustConfirmationPort for AllowHookTrustConfirmationPort {
    fn confirm_trusted_hooks(&self, _request: &HookTrustConfirmationRequest) -> Result<()> {
        Ok(())
    }
}

fn repo_config(dev_servers: Vec<RepoDevServerScript>) -> RepoConfig {
    RepoConfig {
        dev_servers,
        ..Default::default()
    }
}

enum ScriptedReadStep {
    Chunk(Vec<u8>),
    Error(io::ErrorKind),
    Eof,
}

struct ScriptedReader {
    steps: VecDeque<ScriptedReadStep>,
}

impl ScriptedReader {
    fn new(steps: Vec<ScriptedReadStep>) -> Self {
        Self {
            steps: steps.into(),
        }
    }
}

impl Read for ScriptedReader {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        match self.steps.pop_front().unwrap_or(ScriptedReadStep::Eof) {
            ScriptedReadStep::Chunk(bytes) => {
                let read = bytes.len().min(buffer.len());
                buffer[..read].copy_from_slice(&bytes[..read]);
                Ok(read)
            }
            ScriptedReadStep::Error(kind) => Err(io::Error::from(kind)),
            ScriptedReadStep::Eof => Ok(0),
        }
    }
}

fn build_runtime_groups_for_forwarder_test() -> Arc<Mutex<HashMap<String, DevServerGroupRuntime>>> {
    Arc::new(Mutex::new(HashMap::from([(
        "repo::task-forwarder".to_string(),
        DevServerGroupRuntime {
            state: DevServerGroupState {
                repo_path: "repo".to_string(),
                task_id: "task-forwarder".to_string(),
                worktree_path: Some("/tmp/worktree".to_string()),
                scripts: vec![DevServerScriptState {
                    script_id: "server-1".to_string(),
                    name: "Server".to_string(),
                    command: "bun run dev".to_string(),
                    status: DevServerScriptStatus::Running,
                    pid: Some(99),
                    started_at: Some("2026-03-19T10:00:00Z".to_string()),
                    exit_code: None,
                    last_error: None,
                    buffered_terminal_chunks: Vec::new(),
                    next_terminal_sequence: 0,
                }],
                updated_at: "2026-03-19T10:00:00Z".to_string(),
            },
            emitter: None,
        },
    )])))
}

fn read_forwarder_output(groups: &Arc<Mutex<HashMap<String, DevServerGroupRuntime>>>) -> String {
    groups
        .lock()
        .expect("group lock poisoned")
        .get("repo::task-forwarder")
        .expect("runtime present")
        .state
        .scripts[0]
        .buffered_terminal_chunks
        .iter()
        .map(|chunk| chunk.data.as_str())
        .collect::<String>()
}

#[test]
fn sync_group_state_updates_order_and_retains_live_removed_scripts() {
    let mut state = DevServerGroupState {
        repo_path: "/repo".to_string(),
        task_id: "task-1".to_string(),
        worktree_path: Some("/repo/worktree".to_string()),
        scripts: vec![
            DevServerScriptState {
                script_id: "frontend".to_string(),
                name: "Frontend old".to_string(),
                command: "bun run dev:old".to_string(),
                status: DevServerScriptStatus::Stopped,
                pid: None,
                started_at: None,
                exit_code: None,
                last_error: None,
                buffered_terminal_chunks: vec![DevServerTerminalChunk {
                    script_id: "frontend".to_string(),
                    sequence: 0,
                    data: "kept\r\n".to_string(),
                    timestamp: "2026-03-19T10:00:00Z".to_string(),
                }],
                next_terminal_sequence: 1,
            },
            DevServerScriptState {
                script_id: "orphan".to_string(),
                name: "Old orphan".to_string(),
                command: "sleep 30".to_string(),
                status: DevServerScriptStatus::Running,
                pid: Some(4242),
                started_at: Some("2026-03-19T10:01:00Z".to_string()),
                exit_code: None,
                last_error: None,
                buffered_terminal_chunks: Vec::new(),
                next_terminal_sequence: 0,
            },
        ],
        updated_at: "2026-03-19T10:00:00Z".to_string(),
    };

    sync_group_state(
        &mut state,
        "/repo",
        "task-1",
        Some("/repo/worktree-next".to_string()),
        &repo_config(vec![
            RepoDevServerScript {
                id: "backend".to_string(),
                name: "Backend".to_string(),
                command: "bun run api".to_string(),
            },
            RepoDevServerScript {
                id: "frontend".to_string(),
                name: "Frontend".to_string(),
                command: "bun run web".to_string(),
            },
        ]),
    );

    assert_eq!(state.worktree_path.as_deref(), Some("/repo/worktree-next"));
    assert_eq!(state.scripts.len(), 3);
    assert_eq!(state.scripts[0].script_id, "backend");
    assert_eq!(state.scripts[0].name, "Backend");
    assert_eq!(state.scripts[1].script_id, "frontend");
    assert_eq!(state.scripts[1].name, "Frontend");
    assert_eq!(state.scripts[1].command, "bun run web");
    assert_eq!(state.scripts[1].buffered_terminal_chunks.len(), 1);
    assert_eq!(state.scripts[2].script_id, "orphan");
    assert_eq!(state.scripts[2].pid, Some(4242));
}

#[test]
fn emit_terminal_chunk_trims_buffer_and_emits_events() {
    let events = Arc::new(Mutex::new(Vec::new()));
    let emitter_events = events.clone();
    let emitter: DevServerEmitter = Arc::new(move |event| {
        emitter_events
            .lock()
            .expect("event lock poisoned")
            .push(event);
    });
    let groups = Arc::new(Mutex::new(HashMap::from([(
        "repo::task-1".to_string(),
        DevServerGroupRuntime {
            state: DevServerGroupState {
                repo_path: "repo".to_string(),
                task_id: "task-1".to_string(),
                worktree_path: Some("/tmp/worktree".to_string()),
                scripts: vec![DevServerScriptState {
                    script_id: "server-1".to_string(),
                    name: "Server".to_string(),
                    command: "bun run dev".to_string(),
                    status: DevServerScriptStatus::Running,
                    pid: Some(99),
                    started_at: Some("2026-03-19T10:00:00Z".to_string()),
                    exit_code: None,
                    last_error: None,
                    buffered_terminal_chunks: Vec::new(),
                    next_terminal_sequence: 0,
                }],
                updated_at: "2026-03-19T10:00:00Z".to_string(),
            },
            emitter: Some(emitter),
        },
    )])));

    for index in 0..(DEV_SERVER_TERMINAL_BUFFER_CHUNK_LIMIT + 5) {
        emit_terminal_chunk(
            &groups,
            "repo::task-1",
            "repo",
            "task-1",
            "server-1",
            format!("line-{index}"),
        );
    }

    let groups = groups.lock().expect("group lock poisoned");
    let runtime = groups.get("repo::task-1").expect("runtime present");
    let logs = &runtime.state.scripts[0].buffered_terminal_chunks;
    assert_eq!(logs.len(), DEV_SERVER_TERMINAL_BUFFER_CHUNK_LIMIT);
    assert_eq!(
        logs.first().map(|chunk| chunk.data.as_str()),
        Some("line-5")
    );
    assert_eq!(
        logs.last().map(|chunk| chunk.data.as_str()),
        Some("line-2004")
    );
    drop(groups);

    let emitted = events.lock().expect("event lock poisoned");
    assert_eq!(emitted.len(), DEV_SERVER_TERMINAL_BUFFER_CHUNK_LIMIT + 5);
    assert!(matches!(
        emitted.last(),
        Some(DevServerEvent::TerminalChunk { terminal_chunk, .. }) if terminal_chunk.data == "line-2004"
    ));
}

#[test]
fn emit_terminal_chunk_trims_buffer_by_byte_budget() {
    let groups = Arc::new(Mutex::new(HashMap::from([(
        "repo::task-1".to_string(),
        DevServerGroupRuntime {
            state: DevServerGroupState {
                repo_path: "repo".to_string(),
                task_id: "task-1".to_string(),
                worktree_path: Some("/tmp/worktree".to_string()),
                scripts: vec![DevServerScriptState {
                    script_id: "server-1".to_string(),
                    name: "Server".to_string(),
                    command: "bun run dev".to_string(),
                    status: DevServerScriptStatus::Running,
                    pid: Some(99),
                    started_at: Some("2026-03-19T10:00:00Z".to_string()),
                    exit_code: None,
                    last_error: None,
                    buffered_terminal_chunks: Vec::new(),
                    next_terminal_sequence: 0,
                }],
                updated_at: "2026-03-19T10:00:00Z".to_string(),
            },
            emitter: None,
        },
    )])));

    emit_terminal_chunk(
        &groups,
        "repo::task-1",
        "repo",
        "task-1",
        "server-1",
        "a".repeat(DEV_SERVER_TERMINAL_BUFFER_BYTE_LIMIT - 32),
    );
    emit_terminal_chunk(
        &groups,
        "repo::task-1",
        "repo",
        "task-1",
        "server-1",
        "b".repeat(128),
    );

    let groups = groups.lock().expect("group lock poisoned");
    let runtime = groups.get("repo::task-1").expect("runtime present");
    let buffered = &runtime.state.scripts[0].buffered_terminal_chunks;
    assert_eq!(buffered.len(), 1);
    assert!(buffered[0].data.starts_with('b'));
}

#[test]
fn spawn_terminal_forwarder_retries_interrupted_reads() {
    let groups = build_runtime_groups_for_forwarder_test();

    spawn_terminal_forwarder(
        groups.clone(),
        "repo::task-forwarder".to_string(),
        "repo".to_string(),
        "task-forwarder".to_string(),
        "server-1".to_string(),
        ScriptedReader::new(vec![
            ScriptedReadStep::Error(io::ErrorKind::Interrupted),
            ScriptedReadStep::Chunk(b"ready\r\n".to_vec()),
            ScriptedReadStep::Eof,
        ]),
    );

    let mut captured = String::new();
    for _ in 0..20 {
        thread::sleep(Duration::from_millis(25));
        captured = read_forwarder_output(&groups);
        if captured.contains("ready\r\n") {
            break;
        }
    }

    assert!(captured.contains("ready\r\n"));
    assert!(!captured.contains("terminal stream failed"));
}

#[test]
fn spawn_terminal_forwarder_skips_invalid_utf8_and_continues_streaming() {
    let groups = build_runtime_groups_for_forwarder_test();

    spawn_terminal_forwarder(
        groups.clone(),
        "repo::task-forwarder".to_string(),
        "repo".to_string(),
        "task-forwarder".to_string(),
        "server-1".to_string(),
        ScriptedReader::new(vec![
            ScriptedReadStep::Chunk(vec![0xff]),
            ScriptedReadStep::Chunk(b"ready\r\n".to_vec()),
            ScriptedReadStep::Eof,
        ]),
    );

    let mut captured = String::new();
    for _ in 0..20 {
        thread::sleep(Duration::from_millis(25));
        captured = read_forwarder_output(&groups);
        if captured.contains("ready\r\n") {
            break;
        }
    }

    assert!(captured.contains(
        "Dev server terminal output contained invalid UTF-8 bytes and could not be fully rendered."
    ));
    assert!(captured.contains("ready\r\n"));
}

#[test]
fn start_dev_server_script_rejects_blank_commands() {
    let (service, _task_state, _git_state) = build_service_with_state(Vec::new());
    let repo_path = "/repo";
    let task_id = "task-parse";
    let group_key = dev_server_group_key(repo_path, task_id);
    let script = RepoDevServerScript {
        id: "frontend".to_string(),
        name: "Frontend".to_string(),
        command: "   ".to_string(),
    };

    service
        .dev_server_groups
        .lock()
        .expect("group lock poisoned")
        .insert(
            group_key.clone(),
            DevServerGroupRuntime {
                state: build_group_state(
                    repo_path,
                    task_id,
                    Some("/tmp/worktree".to_string()),
                    &repo_config(vec![script.clone()]),
                ),
                emitter: None,
            },
        );

    let error = service
        .start_dev_server_script(
            group_key.as_str(),
            repo_path,
            task_id,
            "/tmp/worktree",
            script,
        )
        .expect_err("blank command should fail");

    assert!(error
        .to_string()
        .contains("Dev server command is empty for Frontend"));

    let groups = service
        .dev_server_groups
        .lock()
        .expect("group lock poisoned");
    let runtime = groups.get(&group_key).expect("runtime present");
    let script = &runtime.state.scripts[0];
    assert_eq!(script.status, DevServerScriptStatus::Failed);
    assert_eq!(script.pid, None);
    assert_eq!(script.started_at, None);
    assert_eq!(script.exit_code, None);
    assert!(matches!(
        script.last_error.as_deref(),
        Some(message) if message.contains("Dev server command is empty for Frontend")
    ));
    assert!(script.buffered_terminal_chunks.iter().any(|chunk| chunk
        .data
        .contains("Dev server command is empty for Frontend")));
}

#[test]
fn dev_server_start_requires_builder_worktree_before_hook_trust() {
    let root = unique_temp_path("dev-server-start-missing-worktree");
    let repo = root.join("repo");
    init_git_repo(&repo).expect("test repo should initialize");

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let (service, _task_state, _git_state) = build_service_with_store(
        vec![make_task("task-1", "task", TaskStatus::InProgress)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
        config_store,
    );
    let repo_path = repo.to_string_lossy().to_string();
    service
        .workspace_add(repo_path.as_str())
        .expect("workspace should add");
    service
        .workspace_update_repo_config(
            repo_path.as_str(),
            RepoConfig {
                dev_servers: vec![RepoDevServerScript {
                    id: "frontend".to_string(),
                    name: "Frontend".to_string(),
                    command: "bun run dev".to_string(),
                }],
                trusted_hooks: false,
                trusted_hooks_fingerprint: None,
                ..Default::default()
            },
        )
        .expect("repo config should persist");

    let emitter: DevServerEmitter = Arc::new(|_| {});
    let error = service
        .dev_server_start(repo_path.as_str(), "task-1", emitter)
        .expect_err("missing builder worktree should fail before hook trust");
    assert_eq!(
        error.to_string(),
        "Builder continuation cannot start until a builder worktree exists for task task-1. Start Builder first."
    );

    let _ = fs::remove_dir_all(root);
}

#[test]
fn start_dev_server_script_reports_immediate_shell_failures() {
    let (service, _task_state, _git_state) = build_service_with_state(Vec::new());
    let repo_path = "/repo";
    let task_id = "task-spawn";
    let worktree_path = unique_temp_path("dev-server-worktree");
    fs::create_dir_all(&worktree_path).expect("create worktree path");
    let worktree_path = worktree_path.to_string_lossy().to_string();
    let group_key = dev_server_group_key(repo_path, task_id);
    let script = RepoDevServerScript {
        id: "backend".to_string(),
        name: "Backend".to_string(),
        command: "__odt_missing_executable__ --port 3000".to_string(),
    };

    service
        .dev_server_groups
        .lock()
        .expect("group lock poisoned")
        .insert(
            group_key.clone(),
            DevServerGroupRuntime {
                state: build_group_state(
                    repo_path,
                    task_id,
                    Some(worktree_path.clone()),
                    &repo_config(vec![script.clone()]),
                ),
                emitter: None,
            },
        );

    let error = service
        .start_dev_server_script(
            group_key.as_str(),
            repo_path,
            task_id,
            worktree_path.as_str(),
            script,
        )
        .expect_err("missing command should fail during startup");

    assert!(error
        .to_string()
        .contains("Dev server exited with code 127"));

    let groups = service
        .dev_server_groups
        .lock()
        .expect("group lock poisoned");
    let runtime = groups.get(&group_key).expect("runtime present");
    let script = &runtime.state.scripts[0];
    assert_eq!(script.status, DevServerScriptStatus::Failed);
    assert_eq!(script.pid, None);
    assert_eq!(script.started_at, None);
    assert_eq!(script.exit_code, Some(127));
    assert!(matches!(
        script.last_error.as_deref(),
        Some(message) if message.contains("Dev server exited with code")
    ));
    assert!(script
        .buffered_terminal_chunks
        .iter()
        .any(|chunk| chunk.data.contains("Dev server exited with code")));
}

#[cfg(unix)]
#[test]
fn dev_server_start_keeps_successful_scripts_running_when_another_script_fails() {
    let root = unique_temp_path("dev-server-partial-start");
    let repo = root.join("repo");
    init_git_repo(&repo).expect("test repo should initialize");

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let (service, _task_state, _git_state) = build_service_with_store(
        vec![make_task("task-1", "task", TaskStatus::InProgress)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
        config_store,
    );
    let repo_path = repo.to_string_lossy().to_string();
    let worktree_path = repo.join(".openducktor-worktree");
    fs::create_dir_all(&worktree_path).expect("create worktree path");
    let worktree_path = worktree_path.to_string_lossy().to_string();

    service
        .workspace_add(repo_path.as_str())
        .expect("workspace should add");
    service
        .workspace_update_repo_config(
            repo_path.as_str(),
            RepoConfig {
                trusted_hooks: true,
                dev_servers: vec![
                    RepoDevServerScript {
                        id: "frontend".to_string(),
                        name: "Frontend".to_string(),
                        command: "sleep 20".to_string(),
                    },
                    RepoDevServerScript {
                        id: "backend".to_string(),
                        name: "Backend".to_string(),
                        command: "__odt_missing_executable__ --port 3000".to_string(),
                    },
                ],
                ..Default::default()
            },
        )
        .expect("repo config should persist");
    let challenge = service
        .workspace_prepare_trusted_hooks_challenge(repo_path.as_str())
        .expect("trust challenge should prepare");
    service
        .workspace_set_trusted_hooks(
            repo_path.as_str(),
            true,
            Some(challenge.nonce.as_str()),
            Some(challenge.fingerprint.as_str()),
            &AllowHookTrustConfirmationPort,
        )
        .expect("hook trust should persist");

    let mut session = crate::app_service::test_support::make_session("task-1", "build-session");
    session.role = "build".to_string();
    session.working_directory = worktree_path;
    service
        .agent_session_upsert(repo_path.as_str(), "task-1", session)
        .expect("builder session should persist");

    let emitter: DevServerEmitter = Arc::new(|_| {});
    let state = service
        .dev_server_start(repo_path.as_str(), "task-1", emitter)
        .expect("partial dev server start should keep successful scripts running");

    let frontend = state
        .scripts
        .iter()
        .find(|script| script.script_id == "frontend")
        .expect("frontend script present");
    assert_eq!(frontend.status, DevServerScriptStatus::Running);
    assert!(frontend.pid.is_some());

    let backend = state
        .scripts
        .iter()
        .find(|script| script.script_id == "backend")
        .expect("backend script present");
    assert_eq!(backend.status, DevServerScriptStatus::Failed);
    assert_eq!(backend.exit_code, Some(127));
    assert!(matches!(
        backend.last_error.as_deref(),
        Some(message) if message.contains("Dev server exited with code 127")
    ));

    let stopped = service
        .dev_server_stop(repo_path.as_str(), "task-1")
        .expect("running scripts should stop cleanly");
    let stopped_frontend = stopped
        .scripts
        .iter()
        .find(|script| script.script_id == "frontend")
        .expect("frontend script present after stop");
    assert_eq!(stopped_frontend.status, DevServerScriptStatus::Stopped);
    assert_eq!(stopped_frontend.pid, None);

    let _ = fs::remove_dir_all(root);
}

#[cfg(unix)]
#[test]
fn start_dev_server_script_uses_augmented_subprocess_path() {
    let _env_lock = lock_env();
    let (service, _task_state, _git_state) = build_service_with_state(Vec::new());
    let repo_path = "/repo";
    let task_id = "task-path";
    let sandbox = unique_temp_path("dev-server-path");
    let home = sandbox.join("home");
    let login_bin = sandbox.join("login-bin");
    fs::create_dir_all(&login_bin).expect("create login shell path");
    let pnpm_path = login_bin.join("pnpm");
    let node_path = login_bin.join("node");
    let shell_path = sandbox.join("fake-shell");
    let marker_path = sandbox.join("pnpm-marker");
    write_executable_script(
        pnpm_path.as_path(),
        "#!/usr/bin/env node\nconsole.log('pnpm shim');\n",
    )
    .expect("write fake pnpm");
    write_executable_script(
        node_path.as_path(),
        format!(
            r#"#!/bin/sh
touch "{}"
sleep 5
"#,
            marker_path.display()
        )
        .as_str(),
    )
    .expect("write fake node");
    write_executable_script(
        shell_path.as_path(),
        format!(
            "#!/bin/sh\nprintf 'shell startup noise\\n'\nprintf '__OPENDUCKTOR_ENV_START__\\0PATH={}\\0'\n",
            login_bin.display()
        )
        .as_str(),
    )
    .expect("write fake shell");

    let worktree_path = sandbox.join("worktree");
    fs::create_dir_all(&worktree_path).expect("create worktree path");
    let worktree_path = worktree_path.to_string_lossy().to_string();
    let group_key = dev_server_group_key(repo_path, task_id);
    let script = RepoDevServerScript {
        id: "frontend".to_string(),
        name: "Frontend".to_string(),
        command: "pnpm".to_string(),
    };

    service
        .dev_server_groups
        .lock()
        .expect("group lock poisoned")
        .insert(
            group_key.clone(),
            DevServerGroupRuntime {
                state: build_group_state(
                    repo_path,
                    task_id,
                    Some(worktree_path.clone()),
                    &repo_config(vec![script.clone()]),
                ),
                emitter: None,
            },
        );

    let _home_guard = set_env_var("HOME", home.to_string_lossy().as_ref());
    let _shell_guard = set_env_var("SHELL", shell_path.to_string_lossy().as_ref());
    let _user_guard = set_env_var("USER", "odt-test");
    let _logname_guard = set_env_var("LOGNAME", "odt-test");
    let _path_guard = set_env_var("PATH", "/usr/bin:/bin");

    let pid = service
        .start_dev_server_script(
            group_key.as_str(),
            repo_path,
            task_id,
            worktree_path.as_str(),
            script,
        )
        .expect("fake pnpm and node from augmented PATH should start");

    assert!(
        wait_for_path_exists(marker_path.as_path(), Duration::from_secs(10)),
        "expected fake pnpm script to resolve node from augmented PATH"
    );
    stop_process_group(pid, DEV_SERVER_STOP_TIMEOUT).expect("stop dev server");
}

#[cfg(unix)]
#[test]
fn start_dev_server_script_streams_logs_before_process_exit_and_clears_old_logs() {
    let (service, _task_state, _git_state) = build_service_with_state(Vec::new());
    let repo_path = "/repo";
    let task_id = "task-stream";
    let worktree_path = unique_temp_path("dev-server-stream-worktree");
    fs::create_dir_all(&worktree_path).expect("create worktree path");
    let worktree_path = worktree_path.to_string_lossy().to_string();
    let group_key = dev_server_group_key(repo_path, task_id);
    let script = RepoDevServerScript {
        id: "frontend".to_string(),
        name: "Frontend".to_string(),
        command:
            "printf 'db generated\\n' && python3 -c \"import time; print('ready'); time.sleep(5)\""
                .to_string(),
    };

    let mut state = build_group_state(
        repo_path,
        task_id,
        Some(worktree_path.clone()),
        &repo_config(vec![script.clone()]),
    );
    state.scripts[0]
        .buffered_terminal_chunks
        .push(DevServerTerminalChunk {
            script_id: "frontend".to_string(),
            sequence: 0,
            data: "stale log\r\n".to_string(),
            timestamp: "2026-03-19T10:00:00Z".to_string(),
        });
    state.scripts[0].next_terminal_sequence = 1;

    service
        .dev_server_groups
        .lock()
        .expect("group lock poisoned")
        .insert(
            group_key.clone(),
            DevServerGroupRuntime {
                state,
                emitter: None,
            },
        );

    service
        .start_dev_server_script(
            group_key.as_str(),
            repo_path,
            task_id,
            worktree_path.as_str(),
            script,
        )
        .expect("dev server should start");

    let mut saw_ready_log = false;
    let mut saw_setup_log = false;
    let mut pid = None;
    for _ in 0..30 {
        thread::sleep(Duration::from_millis(100));
        let groups = service
            .dev_server_groups
            .lock()
            .expect("group lock poisoned");
        let runtime = groups.get(&group_key).expect("runtime present");
        let script = &runtime.state.scripts[0];
        pid = script.pid;
        assert!(script
            .buffered_terminal_chunks
            .iter()
            .all(|chunk| chunk.data != "stale log\r\n"));
        saw_setup_log = script
            .buffered_terminal_chunks
            .iter()
            .any(|chunk| chunk.data.contains("db generated"));
        saw_ready_log = script
            .buffered_terminal_chunks
            .iter()
            .any(|chunk| chunk.data.contains("ready"));
        if saw_setup_log && saw_ready_log {
            break;
        }
    }

    assert!(
        saw_setup_log,
        "expected chained shell setup log before process exit"
    );
    assert!(saw_ready_log, "expected log line before process exit");

    let pid = pid.expect("dev server pid missing");
    stop_process_group(pid, DEV_SERVER_STOP_TIMEOUT).expect("stop streamed dev server");
    for _ in 0..30 {
        thread::sleep(Duration::from_millis(50));
        let groups = service
            .dev_server_groups
            .lock()
            .expect("group lock poisoned");
        let runtime = groups.get(&group_key).expect("runtime present");
        if runtime.state.scripts[0].pid.is_none() {
            break;
        }
    }
}

#[cfg(unix)]
#[test]
fn start_dev_server_script_preserves_terminal_sequences_and_merges_stderr() {
    let (service, _task_state, _git_state) = build_service_with_state(Vec::new());
    let repo_path = "/repo";
    let task_id = "task-terminal";
    let worktree_path = unique_temp_path("dev-server-terminal-worktree");
    fs::create_dir_all(&worktree_path).expect("create worktree path");
    let worktree_path = worktree_path.to_string_lossy().to_string();
    let group_key = dev_server_group_key(repo_path, task_id);
    let script = RepoDevServerScript {
        id: "frontend".to_string(),
        name: "Frontend".to_string(),
        command: "printf '\\033[32mready\\033[0m\\r' && printf 'stderr info\\r\\n' >&2 && sleep 5"
            .to_string(),
    };

    service
        .dev_server_groups
        .lock()
        .expect("group lock poisoned")
        .insert(
            group_key.clone(),
            DevServerGroupRuntime {
                state: build_group_state(
                    repo_path,
                    task_id,
                    Some(worktree_path.clone()),
                    &repo_config(vec![script.clone()]),
                ),
                emitter: None,
            },
        );

    service
        .start_dev_server_script(
            group_key.as_str(),
            repo_path,
            task_id,
            worktree_path.as_str(),
            script,
        )
        .expect("dev server should start");

    let mut pid = None;
    let mut captured = String::new();
    for _ in 0..30 {
        thread::sleep(Duration::from_millis(100));
        let groups = service
            .dev_server_groups
            .lock()
            .expect("group lock poisoned");
        let runtime = groups.get(&group_key).expect("runtime present");
        let script = &runtime.state.scripts[0];
        pid = script.pid;
        captured = script
            .buffered_terminal_chunks
            .iter()
            .map(|chunk| chunk.data.as_str())
            .collect::<String>();
        if captured.contains("stderr info") {
            break;
        }
    }

    assert!(captured.contains("\u{1b}[32mready\u{1b}[0m\r"));
    assert!(captured.contains("stderr info"));

    let pid = pid.expect("dev server pid missing");
    stop_process_group(pid, DEV_SERVER_STOP_TIMEOUT).expect("stop terminal dev server");
}

#[test]
fn mark_dev_servers_stopping_clears_terminal_replay_and_resets_failed_scripts() {
    let (service, _task_state, _git_state) = build_service_with_state(Vec::new());
    let group_key = "repo::task-stop".to_string();
    service
        .dev_server_groups
        .lock()
        .expect("group lock poisoned")
        .insert(
            group_key.clone(),
            DevServerGroupRuntime {
                state: DevServerGroupState {
                    repo_path: "repo".to_string(),
                    task_id: "task-stop".to_string(),
                    worktree_path: Some("/tmp/worktree".to_string()),
                    scripts: vec![
                        DevServerScriptState {
                            script_id: "frontend".to_string(),
                            name: "Frontend".to_string(),
                            command: "bun run dev".to_string(),
                            status: DevServerScriptStatus::Running,
                            pid: Some(4242),
                            started_at: Some("2026-03-19T10:00:00Z".to_string()),
                            exit_code: None,
                            last_error: None,
                            buffered_terminal_chunks: vec![DevServerTerminalChunk {
                                script_id: "frontend".to_string(),
                                sequence: 0,
                                data: "ready\r\n".to_string(),
                                timestamp: "2026-03-19T10:00:00Z".to_string(),
                            }],
                            next_terminal_sequence: 1,
                        },
                        DevServerScriptState {
                            script_id: "backend".to_string(),
                            name: "Backend".to_string(),
                            command: "bun run api".to_string(),
                            status: DevServerScriptStatus::Failed,
                            pid: None,
                            started_at: None,
                            exit_code: Some(1),
                            last_error: Some("boom".to_string()),
                            buffered_terminal_chunks: vec![DevServerTerminalChunk {
                                script_id: "backend".to_string(),
                                sequence: 0,
                                data: "boom\r\n".to_string(),
                                timestamp: "2026-03-19T10:00:01Z".to_string(),
                            }],
                            next_terminal_sequence: 1,
                        },
                    ],
                    updated_at: "2026-03-19T10:00:00Z".to_string(),
                },
                emitter: None,
            },
        );

    let targets = service
        .mark_dev_servers_stopping(group_key.as_str())
        .expect("stop mark should succeed");

    assert_eq!(targets, vec![("frontend".to_string(), 4242)]);

    let groups = service
        .dev_server_groups
        .lock()
        .expect("group lock poisoned");
    let runtime = groups.get(&group_key).expect("runtime present");
    assert_eq!(
        runtime.state.scripts[0].status,
        DevServerScriptStatus::Stopping
    );
    assert!(runtime.state.scripts[0].buffered_terminal_chunks.is_empty());
    assert_eq!(
        runtime.state.scripts[1].status,
        DevServerScriptStatus::Stopped
    );
    assert_eq!(runtime.state.scripts[1].last_error, None);
    assert_eq!(runtime.state.scripts[1].exit_code, None);
    assert!(runtime.state.scripts[1].buffered_terminal_chunks.is_empty());
}

#[cfg(unix)]
#[test]
fn dev_server_parent_death_watcher_terminates_orphaned_process_group() {
    let mut child = spawn_sleep_process_group(20);
    let pid = child.id();

    spawn_dev_server_parent_death_watcher(999_999, pid)
        .expect("watcher should start for dev server process");

    assert!(
        wait_for_process_exit(pid as i32, Duration::from_secs(3)),
        "dev server process group should exit when parent is already gone"
    );
    let _ = child.wait().expect("failed waiting dev server child");
}
