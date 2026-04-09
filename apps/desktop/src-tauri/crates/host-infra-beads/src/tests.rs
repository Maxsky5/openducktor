use super::{
    default_ai_review_enabled, metadata_bool_qa_required, metadata_namespace, normalize_labels,
    normalize_text_option, parse_agent_sessions, parse_issue_type, parse_markdown_entries,
    parse_metadata_root, parse_qa_entries, parse_task_status, BeadsTaskStore, CommandRunner,
    ProcessCommandRunner, CUSTOM_STATUS_VALUES, TASK_LIST_CACHE_TTL_MS,
};
use anyhow::{anyhow, Result};
use chrono::{Duration as ChronoDuration, Utc};
use host_domain::{
    AgentSessionDocument, CreateTaskInput, IssueType, QaVerdict, TaskStatus, TaskStore,
    UpdateTaskPatch,
};
use host_infra_system::{
    compute_beads_database_name, compute_repo_slug, read_shared_dolt_server_state,
    resolve_repo_beads_attachment_dir, resolve_repo_beads_attachment_root,
    resolve_shared_dolt_root,
};
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, PartialEq, Eq)]
enum CallKind {
    WithEnv,
    AllowFailureWithEnv,
}

#[derive(Debug, Clone)]
enum MockStep {
    WithEnv(std::result::Result<String, String>),
    AllowFailureWithEnv(std::result::Result<(bool, String, String), String>),
}

#[derive(Debug, Clone)]
struct RecordedCall {
    kind: CallKind,
    program: String,
    args: Vec<String>,
    cwd: Option<String>,
    env: Vec<(String, String)>,
}

#[derive(Debug, Default)]
struct MockCommandRunner {
    steps: Mutex<VecDeque<MockStep>>,
    calls: Mutex<Vec<RecordedCall>>,
}

impl MockCommandRunner {
    fn with_steps(steps: Vec<MockStep>) -> Arc<Self> {
        Arc::new(Self {
            steps: Mutex::new(VecDeque::from(steps)),
            calls: Mutex::new(Vec::new()),
        })
    }

    fn take_calls(&self) -> Vec<RecordedCall> {
        self.calls
            .lock()
            .expect("calls lock poisoned")
            .drain(..)
            .collect()
    }

    fn remaining_steps(&self) -> usize {
        self.steps.lock().expect("steps lock poisoned").len()
    }

    fn pop_step(&self, expected_kind: CallKind) -> MockStep {
        let step = self
            .steps
            .lock()
            .expect("steps lock poisoned")
            .pop_front()
            .expect("unexpected command invocation");
        match (&step, &expected_kind) {
            (MockStep::WithEnv(_), CallKind::WithEnv)
            | (MockStep::AllowFailureWithEnv(_), CallKind::AllowFailureWithEnv) => step,
            _ => panic!(
                "unexpected command invocation kind, expected {:?}, got {:?}",
                expected_kind, step
            ),
        }
    }

    fn record_call(
        &self,
        kind: CallKind,
        program: &str,
        args: &[&str],
        _cwd: Option<&Path>,
        env: &[(&str, &str)],
    ) {
        self.calls
            .lock()
            .expect("calls lock poisoned")
            .push(RecordedCall {
                kind,
                program: program.to_string(),
                args: args.iter().map(|entry| (*entry).to_string()).collect(),
                cwd: _cwd.map(|path| path.display().to_string()),
                env: env
                    .iter()
                    .map(|(key, value)| ((*key).to_string(), (*value).to_string()))
                    .collect(),
            });
    }
}

fn assert_attachment_root_cwd(call: &RecordedCall, repo_path: &Path) {
    let expected = resolve_repo_beads_attachment_root(repo_path)
        .expect("expected attachment root")
        .display()
        .to_string();
    assert_eq!(call.cwd.as_deref(), Some(expected.as_str()));
}

impl CommandRunner for MockCommandRunner {
    fn uses_real_processes(&self) -> bool {
        false
    }

    fn run_with_env(
        &self,
        program: &str,
        args: &[&str],
        cwd: Option<&Path>,
        env: &[(&str, &str)],
    ) -> Result<String> {
        self.record_call(CallKind::WithEnv, program, args, cwd, env);
        match self.pop_step(CallKind::WithEnv) {
            MockStep::WithEnv(result) => result.map_err(|message| anyhow!(message)),
            MockStep::AllowFailureWithEnv(_) => {
                unreachable!("call kind already checked")
            }
        }
    }

    fn run_allow_failure_with_env(
        &self,
        program: &str,
        args: &[&str],
        cwd: Option<&Path>,
        env: &[(&str, &str)],
    ) -> Result<(bool, String, String)> {
        self.record_call(CallKind::AllowFailureWithEnv, program, args, cwd, env);
        match self.pop_step(CallKind::AllowFailureWithEnv) {
            MockStep::AllowFailureWithEnv(result) => result.map_err(|message| anyhow!(message)),
            MockStep::WithEnv(_) => unreachable!("call kind already checked"),
        }
    }
}

struct RepoFixture {
    path: PathBuf,
}

impl RepoFixture {
    fn new(label: &str) -> Self {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock went backwards")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "odt-beads-test-{}-{}-{}",
            label,
            std::process::id(),
            timestamp
        ));
        fs::create_dir_all(&path).expect("failed creating temp repo fixture");
        Self { path }
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for RepoFixture {
    fn drop(&mut self) {
        if let Ok(beads_dir) = resolve_repo_beads_attachment_dir(&self.path) {
            if let Some(parent) = beads_dir.parent() {
                let _ = fs::remove_dir_all(parent);
            }
        }
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn issue_value(
    id: &str,
    status: &str,
    issue_type: &str,
    parent: Option<&str>,
    dependencies: Value,
    metadata: Option<Value>,
) -> Value {
    json!({
        "id": id,
        "title": format!("Task {id}"),
        "description": "",
        "acceptance_criteria": "",
        "notes": "",
        "status": status,
        "priority": 2,
        "issue_type": issue_type,
        "labels": ["backend"],
        "owner": null,
        "parent": parent,
        "dependencies": dependencies,
        "metadata": metadata,
        "updated_at": "2026-02-20T12:00:00Z",
        "created_at": "2026-02-20T11:00:00Z"
    })
}

fn metadata_from_call(call: &RecordedCall) -> Value {
    let index = call
        .args
        .iter()
        .position(|entry| entry == "--metadata")
        .expect("expected --metadata argument");
    serde_json::from_str(
        call.args
            .get(index + 1)
            .expect("expected metadata payload after --metadata"),
    )
    .expect("metadata payload must be valid JSON")
}

fn assert_beads_env(call: &RecordedCall) {
    let beads_dir_entry = call
        .env
        .iter()
        .find(|(key, _)| key == "BEADS_DIR")
        .expect("expected BEADS_DIR env entry");
    assert!(
        !beads_dir_entry.1.trim().is_empty(),
        "BEADS_DIR must be set"
    );
    assert!(call
        .env
        .iter()
        .any(|(key, value)| key == "BEADS_DOLT_SERVER_MODE" && value == "1"));
    assert!(call
        .env
        .iter()
        .any(|(key, value)| key == "BEADS_DOLT_SERVER_HOST" && value == "127.0.0.1"));
    assert!(call
        .env
        .iter()
        .any(|(key, value)| key == "BEADS_DOLT_SERVER_PORT" && !value.trim().is_empty()));
    assert!(call
        .env
        .iter()
        .any(|(key, value)| key == "BEADS_DOLT_SERVER_USER" && value == "root"));
}

fn assert_init_args(call: &RecordedCall, repo_path: &Path, beads_dir: &Path) {
    let expected_slug = compute_repo_slug(repo_path);
    let expected_database = compute_beads_database_name(repo_path).expect("expected database name");
    let port = call
        .env
        .iter()
        .find(|(key, _)| key == "BEADS_DOLT_SERVER_PORT")
        .map(|(_, value)| value.clone())
        .expect("expected BEADS_DOLT_SERVER_PORT");
    assert_eq!(
        call.args,
        vec![
            "init".to_string(),
            "--server".to_string(),
            "--server-host".to_string(),
            "127.0.0.1".to_string(),
            "--server-port".to_string(),
            port,
            "--server-user".to_string(),
            "root".to_string(),
            "--quiet".to_string(),
            "--skip-hooks".to_string(),
            "--skip-agents".to_string(),
            "--prefix".to_string(),
            expected_slug,
            "--database".to_string(),
            expected_database,
        ]
    );
    assert!(beads_dir.ends_with(".beads"));
}

fn assert_dolt_backup_restore_args(call: &RecordedCall, repo_path: &Path, beads_dir: &Path) {
    let database_name = compute_beads_database_name(repo_path).expect("expected database name");
    assert_eq!(
        call.args,
        vec![
            "backup".to_string(),
            "restore".to_string(),
            format!("file://{}/backup", beads_dir.display()),
            database_name,
        ]
    );
    let expected_cwd = resolve_shared_dolt_root()
        .expect("expected shared dolt root")
        .display()
        .to_string();
    assert_eq!(call.cwd.as_deref(), Some(expected_cwd.as_str()));
    assert!(call.env.is_empty());
}

fn write_attachment_metadata(beads_dir: &Path, repo_path: &Path, port: u16) {
    fs::create_dir_all(beads_dir).expect("beads dir should be writable");
    let database_name = compute_beads_database_name(repo_path).expect("expected database name");
    let effective_port = read_shared_dolt_server_state()
        .ok()
        .flatten()
        .map(|state| state.port)
        .unwrap_or(port);
    fs::write(
        beads_dir.join("metadata.json"),
        json!({
            "backend": "dolt",
            "dolt_mode": "server",
            "dolt_server_host": "127.0.0.1",
            "dolt_server_port": effective_port,
            "dolt_server_user": "root",
            "dolt_database": database_name,
        })
        .to_string(),
    )
    .expect("metadata.json should be writable");
}

fn make_session(session_id: &str, started_at: &str) -> AgentSessionDocument {
    AgentSessionDocument {
        session_id: session_id.to_string(),
        external_session_id: Some(format!("external-{session_id}")),
        role: "build".to_string(),
        scenario: "build_default".to_string(),
        started_at: started_at.to_string(),
        runtime_kind: "opencode".to_string(),
        working_directory: "/repo".to_string(),
        selected_model: None,
    }
}

#[test]
fn metadata_namespace_roundtrip() {
    let root = parse_metadata_root(Some(json!({
        "openducktor": {
            "qaRequired": true
        },
        "other": {
            "keep": true
        }
    })));

    let namespace = metadata_namespace(&root, "openducktor").expect("namespace missing");
    assert_eq!(metadata_bool_qa_required(namespace), Some(true));
    assert!(root.contains_key("other"));
}

#[test]
fn normalize_helpers_keep_payloads_stable() {
    let labels = normalize_labels(vec![
        "backend".to_string(),
        " backend ".to_string(),
        "".to_string(),
        "api".to_string(),
    ]);
    assert_eq!(labels, vec!["api".to_string(), "backend".to_string()]);

    assert_eq!(
        normalize_text_option(Some("  value  ".to_string())),
        Some("value".to_string())
    );
    assert_eq!(normalize_text_option(Some("   ".to_string())), None);
}

#[test]
fn process_command_runner_executes_commands_with_and_without_failure() -> Result<()> {
    let runner = ProcessCommandRunner;
    let output = runner.run_with_env(
        "sh",
        &["-lc", "printf '%s' \"$ODT_BEADS_RUNNER_TEST\""],
        None,
        &[("ODT_BEADS_RUNNER_TEST", "ok")],
    )?;
    assert_eq!(output, "ok");

    let (ok, stdout, stderr) = runner.run_allow_failure_with_env(
        "sh",
        &["-lc", "echo stdout; echo stderr >&2; exit 9"],
        None,
        &[],
    )?;
    assert!(!ok);
    assert_eq!(stdout, "stdout");
    assert_eq!(stderr, "stderr");
    Ok(())
}

#[test]
fn beads_store_constructors_and_debug_are_stable() {
    let default_store = BeadsTaskStore::new();
    let blank_namespace_store = BeadsTaskStore::with_metadata_namespace("   ");
    let custom_namespace_store = BeadsTaskStore::with_metadata_namespace("custom");

    let default_debug = format!("{default_store:?}");
    let blank_debug = format!("{blank_namespace_store:?}");
    let custom_debug = format!("{custom_namespace_store:?}");

    assert!(default_debug.contains("BeadsTaskStore"));
    assert!(blank_debug.contains("openducktor"));
    assert!(custom_debug.contains("custom"));
}

#[test]
fn run_bd_json_parse_errors_do_not_include_raw_output() {
    let repo = RepoFixture::new("parse-redaction");
    let sensitive = "token-abc123";
    let runner =
        MockCommandRunner::with_steps(vec![MockStep::WithEnv(Ok(format!("not-json-{sensitive}")))]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner);

    let error = store
        .list_tasks(repo.path())
        .expect_err("invalid JSON should fail");
    let message = error.to_string();
    assert!(message.contains("Failed to parse bd JSON output from `bd list`"));
    assert!(!message.contains(sensitive));
}

#[test]
fn verify_repo_initialized_parse_errors_do_not_include_raw_output() -> Result<()> {
    let repo = RepoFixture::new("where-parse-redaction");
    let sensitive = "secret-path";
    let beads_dir = resolve_repo_beads_attachment_dir(repo.path())?;
    write_attachment_metadata(&beads_dir, repo.path(), 3307);
    let runner = MockCommandRunner::with_steps(vec![MockStep::AllowFailureWithEnv(Ok((
        true,
        format!("invalid-json-{sensitive}"),
        String::new(),
    )))]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner);

    let error = store
        .verify_repo_initialized(repo.path(), &beads_dir)
        .expect_err("invalid where payload should fail");
    let message = error.to_string();
    assert!(message.contains("Failed to parse `bd where --json` output"));
    assert!(!message.contains(sensitive));
    Ok(())
}

#[test]
fn verify_repo_initialized_reads_json_errors_from_nonzero_exit() -> Result<()> {
    let repo = RepoFixture::new("where-json-error");
    let beads_dir = resolve_repo_beads_attachment_dir(repo.path())?;
    write_attachment_metadata(&beads_dir, repo.path(), 3307);
    let runner = MockCommandRunner::with_steps(vec![MockStep::AllowFailureWithEnv(Ok((
        false,
        json!({
            "error": "database \"beads\" not found"
        })
        .to_string(),
        String::new(),
    )))]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner);

    let (is_ready, reason) = store.verify_repo_initialized(repo.path(), &beads_dir)?;
    assert!(!is_ready);
    assert_eq!(reason, "database \"beads\" not found");
    Ok(())
}

#[test]
fn get_task_uses_id_flag_when_loading_issue() -> Result<()> {
    let repo = RepoFixture::new("show-with-id-flag");
    let issue = issue_value("task-1", "open", "task", None, json!([]), None);
    let runner =
        MockCommandRunner::with_steps(vec![MockStep::WithEnv(Ok(json!([issue]).to_string()))]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let task = store.get_task(repo.path(), "task-1")?;
    assert_eq!(task.id, "task-1");

    let calls = runner.take_calls();
    assert_eq!(calls.len(), 1);
    assert_eq!(
        calls[0].args,
        vec!["show", "--id", "task-1", "--json"]
            .into_iter()
            .map(str::to_string)
            .collect::<Vec<_>>()
    );
    Ok(())
}

#[test]
fn strict_issue_type_and_status_parsers_return_actionable_errors() {
    assert_eq!(
        parse_issue_type("task-1", "feature").expect("feature should parse"),
        IssueType::Feature
    );
    assert_eq!(
        parse_task_status("task-1", "blocked").expect("blocked should parse"),
        TaskStatus::Blocked
    );
    assert!(default_ai_review_enabled(&IssueType::Epic));
    assert!(default_ai_review_enabled(&IssueType::Bug));

    let issue_type_error = parse_issue_type("task-1", "unknown-type")
        .expect_err("unknown issue type should fail")
        .to_string();
    assert!(issue_type_error.contains("task-1"));
    assert!(issue_type_error.contains("issue type"));
    assert!(issue_type_error.contains("unknown-type"));

    let status_error = parse_task_status("task-1", "backlog")
        .expect_err("unknown status should fail")
        .to_string();
    assert!(status_error.contains("task-1"));
    assert!(status_error.contains("status"));
    assert!(status_error.contains("backlog"));
}

#[test]
fn get_task_rejects_invalid_issue_type_with_task_context() {
    let repo = RepoFixture::new("show-invalid-issue-type");
    let issue = issue_value("task-bad-type", "open", "decision", None, json!([]), None);
    let runner =
        MockCommandRunner::with_steps(vec![MockStep::WithEnv(Ok(json!([issue]).to_string()))]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner);

    let error = store
        .get_task(repo.path(), "task-bad-type")
        .expect_err("invalid issue type should fail");
    let message = error.to_string();
    assert!(message.contains("task-bad-type"));
    assert!(message.contains("issue type"));
    assert!(message.contains("decision"));
}

#[test]
fn get_task_reports_missing_tasks_with_task_context() {
    let repo = RepoFixture::new("show-missing-task");
    let runner = MockCommandRunner::with_steps(vec![MockStep::WithEnv(Ok(json!([]).to_string()))]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner);

    let error = store
        .get_task(repo.path(), "task-missing")
        .expect_err("missing task should fail");
    assert_eq!(error.to_string(), "Task not found: task-missing");
}

#[test]
fn list_tasks_rejects_invalid_status_with_task_context() {
    let repo = RepoFixture::new("list-invalid-status");
    let payload = json!([issue_value(
        "task-bad-status",
        "backlog",
        "task",
        None,
        json!([]),
        None
    )]);
    let runner = MockCommandRunner::with_steps(vec![MockStep::WithEnv(Ok(payload.to_string()))]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner);

    let error = store
        .list_tasks(repo.path())
        .expect_err("invalid status should fail");
    let message = error.to_string();
    assert!(message.contains("task-bad-status"));
    assert!(message.contains("status"));
    assert!(message.contains("backlog"));
}

#[test]
fn markdown_and_qa_entry_parsers_filter_invalid_entries() {
    let markdown_entries = parse_markdown_entries(&json!([
        {
            "markdown": "# Spec",
            "updatedAt": "2026-02-17T12:34:56Z",
            "updatedBy": "planner-agent",
            "sourceTool": "set_spec",
            "revision": 1
        },
        {
            "markdown": 42
        }
    ]))
    .expect("markdown entries");
    assert_eq!(markdown_entries.len(), 1);
    assert_eq!(markdown_entries[0].revision, 1);

    let qa_entries = parse_qa_entries(&json!([
        {
            "markdown": "# QA",
            "verdict": "approved",
            "updatedAt": "2026-02-17T13:10:00Z",
            "updatedBy": "qa-agent",
            "sourceTool": "odt_qa_approved",
            "revision": 2
        },
        {
            "verdict": "rejected"
        }
    ]))
    .expect("qa entries");
    assert_eq!(qa_entries.len(), 1);
    assert_eq!(qa_entries[0].revision, 2);

    let sessions = parse_agent_sessions(&json!([
        {
            "sessionId": "obp-session-1",
            "externalSessionId": "session-opencode-1",
            "role": "spec",
            "scenario": "spec_initial",
            "startedAt": "2026-02-18T17:20:00Z",
            "workingDirectory": "/repo",
            "selectedModel": {
                "providerId": "openai",
                "modelId": "gpt-5",
                "variant": "high",
                "opencodeAgent": "architect"
            }
        },
        {
            "sessionId": 123
        }
    ]))
    .expect("agent sessions");
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].session_id, "obp-session-1");
    assert_eq!(
        sessions[0].external_session_id.as_deref(),
        Some("session-opencode-1")
    );

    let legacy_sessions = parse_agent_sessions(&json!([
        {
            "sessionId": "legacy-planner-session",
            "externalSessionId": "legacy-opencode-session",
            "role": "planner",
            "scenario": "planner_revision",
            "startedAt": "2026-02-18T17:22:00Z",
            "runtimeKind": "opencode",
            "workingDirectory": "/repo",
            "selectedModel": null
        }
    ]))
    .expect("legacy agent sessions");
    assert_eq!(legacy_sessions.len(), 1);
    assert_eq!(legacy_sessions[0].scenario, "planner_initial");
}

#[test]
#[ignore = "manual benchmark scaffold; run with cargo test -p host-infra-beads metadata_parsing_benchmark_scaffold -- --ignored --nocapture"]
fn metadata_parsing_benchmark_scaffold() {
    let markdown_payload = Value::Array(
        (0..200)
            .map(|index| {
                json!({
                    "markdown": format!("# Spec {index}\n\n{}", "detail ".repeat(32)),
                    "updatedAt": "2026-02-17T12:34:56Z",
                    "updatedBy": "planner-agent",
                    "sourceTool": "set_spec",
                    "revision": index + 1
                })
            })
            .collect(),
    );
    let qa_payload = Value::Array(
        (0..200)
            .map(|index| {
                json!({
                    "markdown": format!("# QA {index}\n\n{}", "report ".repeat(48)),
                    "verdict": if index % 2 == 0 { "approved" } else { "rejected" },
                    "updatedAt": "2026-02-17T13:10:00Z",
                    "updatedBy": "qa-agent",
                    "sourceTool": if index % 2 == 0 { "odt_qa_approved" } else { "odt_qa_rejected" },
                    "revision": index + 1
                })
            })
            .collect(),
    );
    let session_payload = Value::Array(
        (0..200)
            .map(|index| {
                json!({
                    "sessionId": format!("obp-session-{index}"),
                    "externalSessionId": format!("session-opencode-{index}"),
                    "role": "build",
                    "scenario": "build_default",
                    "startedAt": "2026-02-18T17:20:00Z",
                    "workingDirectory": "/repo",
                    "selectedModel": null
                })
            })
            .collect(),
    );

    let iterations = 200;
    let started = Instant::now();
    let mut parsed_entries = 0usize;

    for _ in 0..iterations {
        parsed_entries += parse_markdown_entries(&markdown_payload)
            .expect("expected markdown entries")
            .len();
        parsed_entries += parse_qa_entries(&qa_payload)
            .expect("expected qa entries")
            .len();
        parsed_entries += parse_agent_sessions(&session_payload)
            .expect("expected session entries")
            .len();
    }

    let expected_entries = iterations * 600;
    assert_eq!(parsed_entries, expected_entries);
    eprintln!(
        "metadata parsing benchmark scaffold: parsed {parsed_entries} entries in {:?}",
        started.elapsed()
    );
}

#[test]
fn ensure_repo_initialized_skips_init_when_store_is_ready() -> Result<()> {
    let repo = RepoFixture::new("init-ready");
    let beads_dir = resolve_repo_beads_attachment_dir(repo.path())?;
    write_attachment_metadata(&beads_dir, repo.path(), 3307);
    let runner = MockCommandRunner::with_steps(vec![MockStep::AllowFailureWithEnv(Ok((
        true,
        json!({
            "path": beads_dir,
            "prefix": "openducktor"
        })
        .to_string(),
        String::new(),
    )))]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    store.ensure_repo_initialized(repo.path())?;
    assert_eq!(runner.remaining_steps(), 0);

    let calls = runner.take_calls();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].kind, CallKind::AllowFailureWithEnv);
    assert_eq!(
        calls[0].args,
        vec!["where", "--json"]
            .into_iter()
            .map(str::to_string)
            .collect::<Vec<_>>()
    );
    assert_beads_env(&calls[0]);
    assert_attachment_root_cwd(&calls[0], repo.path());
    Ok(())
}

#[test]
fn ensure_repo_initialized_runs_init_then_uses_cache_when_store_exists() -> Result<()> {
    let repo = RepoFixture::new("init-path");
    let beads_dir = resolve_repo_beads_attachment_dir(repo.path())?;
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::AllowFailureWithEnv(Ok((true, String::new(), String::new()))),
        MockStep::AllowFailureWithEnv(Ok((
            true,
            json!({
                "path": beads_dir,
                "prefix": "openducktor"
            })
            .to_string(),
            String::new(),
        ))),
        MockStep::AllowFailureWithEnv(Ok((
            true,
            json!({
                "path": beads_dir,
                "prefix": "openducktor"
            })
            .to_string(),
            String::new(),
        ))),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    store.ensure_repo_initialized(repo.path())?;

    write_attachment_metadata(&beads_dir, repo.path(), 3307);

    store.ensure_repo_initialized(repo.path())?;
    assert_eq!(runner.remaining_steps(), 0);

    let calls = runner.take_calls();
    assert_eq!(calls.len(), 3);
    assert_eq!(calls[0].kind, CallKind::AllowFailureWithEnv);
    assert_init_args(&calls[0], repo.path(), &beads_dir);
    assert_beads_env(&calls[0]);
    assert_attachment_root_cwd(&calls[0], repo.path());
    assert_eq!(calls[1].kind, CallKind::AllowFailureWithEnv);
    assert_eq!(
        calls[1].args,
        vec!["where", "--json"]
            .into_iter()
            .map(str::to_string)
            .collect::<Vec<_>>()
    );
    assert_beads_env(&calls[1]);
    assert_attachment_root_cwd(&calls[1], repo.path());
    assert_eq!(calls[2].kind, CallKind::AllowFailureWithEnv);
    assert_eq!(
        calls[2].args,
        vec!["where", "--json"]
            .into_iter()
            .map(str::to_string)
            .collect::<Vec<_>>()
    );
    assert_beads_env(&calls[2]);
    assert_attachment_root_cwd(&calls[2], repo.path());
    Ok(())
}

#[test]
fn ensure_repo_initialized_repairs_unready_store_footprint() -> Result<()> {
    let repo = RepoFixture::new("init-repair-footprint");
    let beads_dir = resolve_repo_beads_attachment_dir(repo.path())?;
    write_attachment_metadata(&beads_dir, repo.path(), 3307);
    fs::write(beads_dir.join("beads.db"), "stale").expect("beads.db should be writable");
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::AllowFailureWithEnv(Ok((
            false,
            json!({
                "error": "failed to open database: database \"beads\" not found"
            })
            .to_string(),
            String::new(),
        ))),
        MockStep::WithEnv(Ok("doctor fixed".to_string())),
        MockStep::AllowFailureWithEnv(Ok((
            true,
            json!({
                "path": beads_dir,
                "prefix": "openducktor"
            })
            .to_string(),
            String::new(),
        ))),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    store.ensure_repo_initialized(repo.path())?;

    let calls = runner.take_calls();
    assert_eq!(calls.len(), 3);
    assert_eq!(calls[0].kind, CallKind::AllowFailureWithEnv);
    assert_eq!(
        calls[0].args,
        vec!["where", "--json"]
            .into_iter()
            .map(str::to_string)
            .collect::<Vec<_>>()
    );
    assert_eq!(calls[1].kind, CallKind::WithEnv);
    assert_eq!(
        calls[1].args,
        vec!["doctor", "--fix", "--yes"]
            .into_iter()
            .map(str::to_string)
            .collect::<Vec<_>>()
    );
    assert_eq!(calls[2].kind, CallKind::AllowFailureWithEnv);
    assert_eq!(
        calls[2].args,
        vec!["where", "--json"]
            .into_iter()
            .map(str::to_string)
            .collect::<Vec<_>>()
    );
    assert_beads_env(&calls[0]);
    assert_beads_env(&calls[1]);
    assert_beads_env(&calls[2]);
    assert_attachment_root_cwd(&calls[0], repo.path());
    assert_attachment_root_cwd(&calls[1], repo.path());
    assert_attachment_root_cwd(&calls[2], repo.path());
    Ok(())
}

#[test]
fn ensure_repo_initialized_bootstraps_when_database_is_missing() -> Result<()> {
    let repo = RepoFixture::new("init-bootstrap-missing-db");
    let beads_dir = resolve_repo_beads_attachment_dir(repo.path())?;
    write_attachment_metadata(&beads_dir, repo.path(), 3307);
    fs::create_dir_all(beads_dir.join("backup"))?;
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::AllowFailureWithEnv(Ok((
            false,
            String::new(),
            format!(
                "Warning: delayed Dolt wake-up\n{}",
                json!({
                    "error": "failed to open database: database \"odt_fairnest_deadbeef\" not found on Dolt server at 127.0.0.1:3307"
                })
            ),
        ))),
        MockStep::WithEnv(Ok("shared database restored".to_string())),
        MockStep::AllowFailureWithEnv(Ok((
            true,
            json!({
                "path": beads_dir,
                "prefix": "openducktor"
            })
            .to_string(),
            String::new(),
        ))),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    store.ensure_repo_initialized(repo.path())?;

    let calls = runner.take_calls();
    assert_eq!(calls.len(), 3);
    assert_eq!(calls[0].kind, CallKind::AllowFailureWithEnv);
    assert_eq!(calls[1].kind, CallKind::WithEnv);
    assert_eq!(calls[2].kind, CallKind::AllowFailureWithEnv);
    assert_eq!(calls[0].args, vec!["where", "--json"]);
    assert_dolt_backup_restore_args(&calls[1], repo.path(), &beads_dir);
    assert_eq!(calls[2].args, vec!["where", "--json"]);
    assert_beads_env(&calls[0]);
    assert_beads_env(&calls[2]);
    assert_attachment_root_cwd(&calls[0], repo.path());
    assert_attachment_root_cwd(&calls[2], repo.path());
    Ok(())
}

#[test]
fn ensure_repo_initialized_errors_when_database_missing_without_backup() {
    let repo = RepoFixture::new("init-missing-db-no-backup");
    let beads_dir = resolve_repo_beads_attachment_dir(repo.path()).expect("expected beads dir");
    write_attachment_metadata(&beads_dir, repo.path(), 3307);
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::AllowFailureWithEnv(Ok((
            false,
            String::new(),
            json!({
                "error": "failed to open database: database \"odt_fairnest_deadbeef\" not found on Dolt server at 127.0.0.1:3307"
            })
            .to_string(),
        ))),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner);

    let error = store
        .ensure_repo_initialized(repo.path())
        .expect_err("missing shared database without backup should fail");
    assert!(error.to_string().contains("no attachment backup exists"));
}

#[test]
fn ensure_repo_initialized_returns_error_when_init_fails() {
    let repo = RepoFixture::new("init-fails");
    let runner = MockCommandRunner::with_steps(vec![MockStep::AllowFailureWithEnv(Ok((
        false,
        String::new(),
        "permission denied".to_string(),
    )))]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner);

    let error = store
        .ensure_repo_initialized(repo.path())
        .expect_err("init should fail");
    assert!(error.to_string().contains("Failed to initialize Beads"));
    assert!(error.to_string().contains("permission denied"));
}

#[test]
fn ensure_repo_initialized_errors_when_verification_is_still_not_ready() {
    let repo = RepoFixture::new("init-malformed");
    let beads_dir = resolve_repo_beads_attachment_dir(repo.path()).expect("expected beads dir");
    write_attachment_metadata(&beads_dir, repo.path(), 3307);
    fs::write(beads_dir.join("beads.db"), "stale").expect("beads.db should be writable");
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::AllowFailureWithEnv(Ok((false, String::new(), "bd where failed".to_string()))),
        MockStep::WithEnv(Ok("doctor fixed".to_string())),
        MockStep::AllowFailureWithEnv(Ok((true, "{}".to_string(), String::new()))),
        MockStep::AllowFailureWithEnv(Ok((true, String::new(), String::new()))),
        MockStep::AllowFailureWithEnv(Ok((true, "{}".to_string(), String::new()))),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner);

    let error = store
        .ensure_repo_initialized(repo.path())
        .expect_err("init should fail when store remains unready");
    assert!(error
        .to_string()
        .contains("Beads init completed but store is not ready"));
}

#[test]
fn list_tasks_filters_events_and_populates_subtask_ids() -> Result<()> {
    let repo = RepoFixture::new("list-tasks");
    let payload = json!([
        issue_value(
            "task-parent",
            "open",
            "epic",
            None,
            json!([]),
            Some(json!({
                "openducktor": {
                    "qaRequired": true,
                    "documents": {
                        "spec": [
                            {
                                "markdown": "# Spec",
                                "updatedAt": "2026-02-20T09:00:00Z",
                                "updatedBy": "planner-agent",
                                "sourceTool": "set_spec",
                                "revision": 1
                            }
                        ],
                        "qaReports": [
                            {
                                "markdown": "QA approved",
                                "verdict": "approved",
                                "updatedAt": "2026-02-20T10:00:00Z",
                                "updatedBy": "qa-agent",
            "sourceTool": "odt_qa_approved",
                                "revision": 1
                            }
                        ]
                    }
                }
            }))
        ),
        issue_value(
            "task-child",
            "in_progress",
            "task",
            None,
            json!([{"type":"parent-child","depends_on_id":"task-parent"}]),
            None
        ),
        issue_value("task-event", "open", "event", None, json!([]), None),
        issue_value("task-gate", "open", "gate", None, json!([]), None)
    ]);
    let runner = MockCommandRunner::with_steps(vec![MockStep::WithEnv(Ok(payload.to_string()))]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let tasks = store.list_tasks(repo.path())?;
    assert_eq!(tasks.len(), 2);

    let parent = tasks
        .iter()
        .find(|task| task.id == "task-parent")
        .expect("parent task missing");
    assert_eq!(parent.subtask_ids, vec!["task-child".to_string()]);
    assert!(parent.document_summary.spec.has);
    assert_eq!(
        parent.document_summary.spec.updated_at.as_deref(),
        Some("2026-02-20T09:00:00Z")
    );
    assert!(!parent.document_summary.plan.has);
    assert!(parent.document_summary.qa_report.has);
    assert_eq!(
        parent.document_summary.qa_report.updated_at.as_deref(),
        Some("2026-02-20T10:00:00Z")
    );

    let child = tasks
        .iter()
        .find(|task| task.id == "task-child")
        .expect("child task missing");
    assert_eq!(child.parent_id.as_deref(), Some("task-parent"));
    assert!(!child.document_summary.spec.has);
    assert!(!child.document_summary.plan.has);
    assert!(!child.document_summary.qa_report.has);

    let calls = runner.take_calls();
    assert_eq!(calls.len(), 1);
    assert_eq!(
        calls[0].args,
        vec!["list", "--all", "--limit", "0", "--json"]
            .into_iter()
            .map(str::to_string)
            .collect::<Vec<_>>()
    );
    Ok(())
}

#[test]
fn list_tasks_keeps_qa_verdict_but_marks_missing_content_when_latest_markdown_is_empty(
) -> Result<()> {
    let repo = RepoFixture::new("list-qa-empty-markdown");
    let payload = json!([issue_value(
        "task-qa-empty",
        "open",
        "task",
        None,
        json!([]),
        Some(json!({
            "openducktor": {
                "qaRequired": true,
                "documents": {
                    "qaReports": [
                        {
                            "markdown": "previous qa",
                            "verdict": "approved",
                            "updatedAt": "2026-02-20T09:00:00Z",
                            "updatedBy": "qa-agent",
            "sourceTool": "odt_qa_approved",
                            "revision": 1
                        },
                        {
                            "markdown": "   ",
                            "verdict": "rejected",
                            "updatedAt": "2026-02-20T10:00:00Z",
                            "updatedBy": "qa-agent",
            "sourceTool": "odt_qa_rejected",
                            "revision": 2
                        }
                    ]
                }
            }
        })),
    )]);

    let runner = MockCommandRunner::with_steps(vec![MockStep::WithEnv(Ok(payload.to_string()))]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner);

    let tasks = store.list_tasks(repo.path())?;
    assert_eq!(tasks.len(), 1);

    let task = &tasks[0];
    assert!(!task.document_summary.qa_report.has);
    assert!(task.document_summary.qa_report.updated_at.is_none());
    assert_eq!(
        task.document_summary.qa_report.verdict,
        host_domain::QaWorkflowVerdict::Rejected
    );

    Ok(())
}

#[test]
fn list_tasks_uses_short_lived_repo_cache() -> Result<()> {
    let repo = RepoFixture::new("list-cache-hit");
    let payload = json!([issue_value("task-1", "open", "task", None, json!([]), None)]);
    let runner = MockCommandRunner::with_steps(vec![MockStep::WithEnv(Ok(payload.to_string()))]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let first = store.list_tasks(repo.path())?;
    let second = store.list_tasks(repo.path())?;
    assert_eq!(first.len(), 1);
    assert_eq!(second.len(), 1);
    assert_eq!(second[0].id, "task-1");

    let calls = runner.take_calls();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].args[0], "list");
    Ok(())
}

#[test]
fn list_tasks_cache_is_invalidated_after_update_mutation() -> Result<()> {
    let repo = RepoFixture::new("list-cache-invalidate-update");
    let initial_list = json!([issue_value("task-1", "open", "task", None, json!([]), None)]);
    let updated_show = json!([issue_value(
        "task-1",
        "blocked",
        "task",
        None,
        json!([]),
        None
    )]);
    let refreshed_list = json!([issue_value(
        "task-1",
        "blocked",
        "task",
        None,
        json!([]),
        None
    )]);

    let runner = MockCommandRunner::with_steps(vec![
        MockStep::WithEnv(Ok(initial_list.to_string())),
        MockStep::WithEnv(Ok("{}".to_string())),
        MockStep::WithEnv(Ok(updated_show.to_string())),
        MockStep::WithEnv(Ok(refreshed_list.to_string())),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let initial = store.list_tasks(repo.path())?;
    assert_eq!(initial[0].status, TaskStatus::Open);

    let updated = store.update_task(
        repo.path(),
        "task-1",
        UpdateTaskPatch {
            title: None,
            description: None,
            notes: None,
            status: Some(TaskStatus::Blocked),
            priority: None,
            issue_type: None,
            ai_review_enabled: None,
            labels: None,
            assignee: None,
            parent_id: None,
        },
    )?;
    assert_eq!(updated.status, TaskStatus::Blocked);

    let refreshed = store.list_tasks(repo.path())?;
    assert_eq!(refreshed[0].status, TaskStatus::Blocked);

    let calls = runner.take_calls();
    let list_calls = calls
        .iter()
        .filter(|call| call.args.first().map(String::as_str) == Some("list"))
        .count();
    assert_eq!(list_calls, 2);
    Ok(())
}

#[test]
fn list_tasks_cache_is_invalidated_after_metadata_mutation() -> Result<()> {
    let repo = RepoFixture::new("list-cache-invalidate-metadata");
    let initial_list = json!([issue_value("task-1", "open", "task", None, json!([]), None)]);
    let current_issue = issue_value("task-1", "open", "task", None, json!([]), None);
    let refreshed_list = json!([issue_value(
        "task-1",
        "open",
        "task",
        None,
        json!([]),
        Some(json!({
            "openducktor": {
                "documents": {
                    "spec": [
                        {
                            "markdown": "# Spec",
                            "updatedAt": "2026-02-20T12:00:00Z",
                            "updatedBy": "planner-agent",
                            "sourceTool": "set_spec",
                            "revision": 1
                        }
                    ]
                }
            }
        })),
    )]);

    let runner = MockCommandRunner::with_steps(vec![
        MockStep::WithEnv(Ok(initial_list.to_string())),
        MockStep::WithEnv(Ok(json!([current_issue]).to_string())),
        MockStep::WithEnv(Ok("{}".to_string())),
        MockStep::WithEnv(Ok(refreshed_list.to_string())),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let initial = store.list_tasks(repo.path())?;
    assert!(!initial[0].document_summary.spec.has);

    store.set_spec(repo.path(), "task-1", "# Spec")?;

    let refreshed = store.list_tasks(repo.path())?;
    assert!(refreshed[0].document_summary.spec.has);

    let calls = runner.take_calls();
    let list_calls = calls
        .iter()
        .filter(|call| call.args.first().map(String::as_str) == Some("list"))
        .count();
    assert_eq!(list_calls, 2);
    Ok(())
}

#[test]
fn list_tasks_cache_expires_after_ttl() -> Result<()> {
    let repo = RepoFixture::new("list-cache-expiry");
    let initial_list = json!([issue_value("task-1", "open", "task", None, json!([]), None)]);
    let refreshed_list = json!([issue_value(
        "task-1",
        "blocked",
        "task",
        None,
        json!([]),
        None
    )]);
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::WithEnv(Ok(initial_list.to_string())),
        MockStep::WithEnv(Ok(refreshed_list.to_string())),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let initial = store.list_tasks(repo.path())?;
    assert_eq!(initial[0].status, TaskStatus::Open);

    std::thread::sleep(Duration::from_millis(TASK_LIST_CACHE_TTL_MS + 50));

    let refreshed = store.list_tasks(repo.path())?;
    assert_eq!(refreshed[0].status, TaskStatus::Blocked);

    let calls = runner.take_calls();
    let list_calls = calls
        .iter()
        .filter(|call| call.args.first().map(String::as_str) == Some("list"))
        .count();
    assert_eq!(list_calls, 2);
    Ok(())
}

#[test]
fn list_tasks_cache_is_invalidated_after_create_mutation() -> Result<()> {
    let repo = RepoFixture::new("list-cache-invalidate-create");
    let initial_list = json!([issue_value("task-1", "open", "task", None, json!([]), None)]);
    let created = issue_value("task-2", "open", "task", None, json!([]), None);
    let shown = issue_value("task-2", "open", "task", None, json!([]), None);
    let refreshed_list = json!([
        issue_value("task-1", "open", "task", None, json!([]), None),
        issue_value("task-2", "open", "task", None, json!([]), None)
    ]);

    let runner = MockCommandRunner::with_steps(vec![
        MockStep::WithEnv(Ok(initial_list.to_string())),
        MockStep::WithEnv(Ok(created.to_string())),
        MockStep::WithEnv(Ok("{}".to_string())),
        MockStep::WithEnv(Ok(json!([shown]).to_string())),
        MockStep::WithEnv(Ok(refreshed_list.to_string())),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let initial = store.list_tasks(repo.path())?;
    assert_eq!(initial.len(), 1);

    let created_task = store.create_task(
        repo.path(),
        CreateTaskInput {
            title: "New task".to_string(),
            issue_type: IssueType::Task,
            priority: 2,
            description: None,
            labels: None,
            ai_review_enabled: Some(true),
            parent_id: None,
        },
    )?;
    assert_eq!(created_task.id, "task-2");

    let refreshed = store.list_tasks(repo.path())?;
    assert_eq!(refreshed.len(), 2);
    assert!(refreshed.iter().any(|task| task.id == "task-2"));

    let calls = runner.take_calls();
    let list_calls = calls
        .iter()
        .filter(|call| call.args.first().map(String::as_str) == Some("list"))
        .count();
    assert_eq!(list_calls, 2);
    Ok(())
}

#[test]
fn list_tasks_cache_is_invalidated_after_delete_mutation() -> Result<()> {
    let repo = RepoFixture::new("list-cache-invalidate-delete");
    let initial_list = json!([issue_value("task-1", "open", "task", None, json!([]), None)]);
    let refreshed_list = json!([]);

    let runner = MockCommandRunner::with_steps(vec![
        MockStep::WithEnv(Ok(initial_list.to_string())),
        MockStep::WithEnv(Ok("done".to_string())),
        MockStep::WithEnv(Ok(refreshed_list.to_string())),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let initial = store.list_tasks(repo.path())?;
    assert_eq!(initial.len(), 1);

    assert!(store.delete_task(repo.path(), "task-1", false)?);

    let refreshed = store.list_tasks(repo.path())?;
    assert!(refreshed.is_empty());

    let calls = runner.take_calls();
    let list_calls = calls
        .iter()
        .filter(|call| call.args.first().map(String::as_str) == Some("list"))
        .count();
    assert_eq!(list_calls, 2);
    Ok(())
}

#[test]
fn stale_generation_cache_writes_are_ignored() -> Result<()> {
    let repo = RepoFixture::new("list-cache-generation-guard");
    let payload = json!([issue_value("task-1", "open", "task", None, json!([]), None)]);
    let runner = MockCommandRunner::with_steps(vec![MockStep::WithEnv(Ok(payload.to_string()))]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let stale_generation = store.task_list_cache_generation_for_repo(repo.path())?;
    store.invalidate_task_list_cache(repo.path())?;
    store.cache_task_list_for_repo_if_generation(
        repo.path(),
        "openducktor",
        stale_generation,
        &[],
    )?;

    let tasks = store.list_tasks(repo.path())?;
    assert_eq!(tasks.len(), 1);

    let calls = runner.take_calls();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].args[0], "list");
    Ok(())
}

#[test]
fn get_task_metadata_ignores_cached_task_list_metadata() -> Result<()> {
    let repo = RepoFixture::new("metadata-read-bypasses-task-list-cache");
    let stale = issue_value(
        "task-1",
        "open",
        "task",
        None,
        json!([]),
        Some(json!({
            "openducktor": {
                "documents": {
                    "spec": [
                        {
                            "markdown": "# Stale spec",
                            "updatedAt": "2026-02-20T10:00:00Z",
                            "updatedBy": "planner-agent",
                            "sourceTool": "set_spec",
                            "revision": 1
                        }
                    ]
                }
            }
        })),
    );
    let fresh = issue_value(
        "task-1",
        "open",
        "task",
        None,
        json!([]),
        Some(json!({
            "openducktor": {
                "documents": {
                    "spec": [
                        {
                            "markdown": "# Fresh spec",
                            "updatedAt": "2026-02-20T11:00:00Z",
                            "updatedBy": "planner-agent",
                            "sourceTool": "set_spec",
                            "revision": 2
                        }
                    ]
                }
            }
        })),
    );
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::WithEnv(Ok(json!([stale]).to_string())),
        MockStep::WithEnv(Ok(json!([fresh]).to_string())),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let _ = store.list_tasks(repo.path())?;
    let metadata = store.get_task_metadata(repo.path(), "task-1")?;

    assert_eq!(metadata.spec.markdown, "# Fresh spec");
    assert_eq!(
        metadata.spec.updated_at.as_deref(),
        Some("2026-02-20T11:00:00Z")
    );

    let calls = runner.take_calls();
    assert_eq!(calls.len(), 2);
    assert_eq!(calls[0].args[0], "list");
    assert_eq!(calls[1].args[0], "show");
    Ok(())
}

#[test]
fn list_tasks_for_kanban_requests_recent_closed_tasks() -> Result<()> {
    let repo = RepoFixture::new("kanban-list-recent-closed");
    let open_tasks = json!([issue_value("task-1", "open", "task", None, json!([]), None)]);
    let recent_closed = json!([issue_value(
        "task-2",
        "closed",
        "task",
        None,
        json!([]),
        None
    )]);
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::WithEnv(Ok(open_tasks.to_string())),
        MockStep::WithEnv(Ok(recent_closed.to_string())),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let earliest_cutoff = (Utc::now() - ChronoDuration::days(1))
        .format("%Y-%m-%d")
        .to_string();
    let tasks = store.list_tasks_for_kanban(repo.path(), 1)?;
    let latest_cutoff = (Utc::now() - ChronoDuration::days(1))
        .format("%Y-%m-%d")
        .to_string();
    assert_eq!(tasks.len(), 2);
    assert!(tasks.iter().any(|task| task.id == "task-1"));
    assert!(tasks.iter().any(|task| task.id == "task-2"));

    let calls = runner.take_calls();
    assert_eq!(calls.len(), 2);
    assert_eq!(calls[0].args[0], "list");
    assert_eq!(calls[0].args[1], "--limit");
    assert_eq!(calls[0].args[2], "0");
    assert_eq!(calls[1].args[0], "list");
    assert!(calls[1]
        .args
        .windows(2)
        .any(|pair| pair == ["--status", "closed"]));
    let actual_cutoff = calls[1]
        .args
        .windows(2)
        .find_map(|pair| (pair[0] == "--closed-after").then(|| pair[1].clone()))
        .expect("expected --closed-after argument");
    assert!(
        actual_cutoff >= earliest_cutoff && actual_cutoff <= latest_cutoff,
        "unexpected cutoff: {actual_cutoff}"
    );
    Ok(())
}

#[test]
fn list_tasks_for_kanban_skips_closed_fetch_for_zero_days() -> Result<()> {
    let repo = RepoFixture::new("kanban-list-zero-days");
    let open_tasks = json!([issue_value("task-1", "open", "task", None, json!([]), None)]);
    let runner = MockCommandRunner::with_steps(vec![MockStep::WithEnv(Ok(open_tasks.to_string()))]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let tasks = store.list_tasks_for_kanban(repo.path(), 0)?;
    assert_eq!(tasks.len(), 1);

    let calls = runner.take_calls();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].args[0], "list");
    Ok(())
}

#[test]
fn list_tasks_for_kanban_cache_key_includes_done_visible_days() -> Result<()> {
    let repo = RepoFixture::new("kanban-list-cache-key");
    let open_tasks = json!([issue_value("task-1", "open", "task", None, json!([]), None)]);
    let closed_tasks = json!([issue_value(
        "task-2",
        "closed",
        "task",
        None,
        json!([]),
        None
    )]);
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::WithEnv(Ok(open_tasks.to_string())),
        MockStep::WithEnv(Ok(closed_tasks.to_string())),
        MockStep::WithEnv(Ok(open_tasks.to_string())),
        MockStep::WithEnv(Ok(closed_tasks.to_string())),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let first = store.list_tasks_for_kanban(repo.path(), 1)?;
    let second = store.list_tasks_for_kanban(repo.path(), 1)?;
    let third = store.list_tasks_for_kanban(repo.path(), 7)?;
    assert_eq!(first.len(), 2);
    assert_eq!(second.len(), 2);
    assert_eq!(third.len(), 2);

    let calls = runner.take_calls();
    let list_calls = calls
        .iter()
        .filter(|call| call.args.first().map(String::as_str) == Some("list"))
        .count();
    assert_eq!(list_calls, 4);
    Ok(())
}

#[test]
fn create_task_normalizes_payload_and_persists_qa_flag() -> Result<()> {
    let repo = RepoFixture::new("create-task");
    let created = issue_value("task-1", "open", "feature", None, json!([]), None);
    let shown = issue_value(
        "task-1",
        "open",
        "feature",
        Some("epic-1"),
        json!([]),
        Some(json!({"openducktor": {"qaRequired": false}})),
    );
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::WithEnv(Ok(created.to_string())),
        MockStep::WithEnv(Ok("{}".to_string())),
        MockStep::WithEnv(Ok(json!([shown]).to_string())),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let task = store.create_task(
        repo.path(),
        CreateTaskInput {
            title: "Build API".to_string(),
            issue_type: IssueType::Feature,
            priority: 3,
            description: Some("  expose endpoint ".to_string()),
            labels: Some(vec![
                "backend".to_string(),
                "api".to_string(),
                "backend".to_string(),
                "".to_string(),
            ]),
            ai_review_enabled: Some(false),
            parent_id: Some(" epic-1 ".to_string()),
        },
    )?;

    assert_eq!(task.id, "task-1");
    assert!(!task.ai_review_enabled);

    let calls = runner.take_calls();
    assert_eq!(calls.len(), 3);
    assert_eq!(calls[0].program, "bd");
    assert_eq!(
        calls[0].args,
        vec![
            "create",
            "Build API",
            "--type",
            "feature",
            "--priority",
            "3",
            "--description",
            "expose endpoint",
            "--labels",
            "api,backend",
            "--parent",
            "epic-1",
            "--json",
        ]
        .into_iter()
        .map(str::to_string)
        .collect::<Vec<_>>()
    );
    let metadata_root = metadata_from_call(&calls[1]);
    assert_eq!(
        metadata_root["openducktor"]["qaRequired"],
        Value::Bool(false)
    );
    assert_eq!(calls[1].args[0], "update");
    assert!(calls[1].args.iter().any(|arg| arg == "--"));
    assert!(calls[1].args.windows(2).any(|pair| {
        pair.first().map(String::as_str) == Some("--json")
            && pair.get(1).map(String::as_str) == Some("--")
    }));
    assert_eq!(calls[1].args.last().map(String::as_str), Some("task-1"));
    Ok(())
}

#[test]
fn update_task_updates_cli_fields_and_qa_metadata() -> Result<()> {
    let repo = RepoFixture::new("update-task");
    let current = issue_value(
        "task-1",
        "open",
        "task",
        None,
        json!([]),
        Some(json!({"openducktor": {}})),
    );
    let updated = issue_value(
        "task-1",
        "blocked",
        "feature",
        Some("parent-1"),
        json!([]),
        Some(json!({"openducktor": {"qaRequired": false}})),
    );
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::WithEnv(Ok("{}".to_string())),
        MockStep::WithEnv(Ok(json!([current]).to_string())),
        MockStep::WithEnv(Ok("{}".to_string())),
        MockStep::WithEnv(Ok(json!([updated]).to_string())),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let task = store.update_task(
        repo.path(),
        "task-1",
        UpdateTaskPatch {
            title: Some("Renamed".to_string()),
            description: Some("Updated description".to_string()),
            notes: Some("Updated notes".to_string()),
            status: Some(TaskStatus::Blocked),
            priority: Some(1),
            issue_type: Some(IssueType::Feature),
            ai_review_enabled: Some(false),
            labels: Some(vec![
                "backend".to_string(),
                "api".to_string(),
                "backend".to_string(),
            ]),
            assignee: Some("alice".to_string()),
            parent_id: Some(" parent-1 ".to_string()),
        },
    )?;

    assert_eq!(task.status, TaskStatus::Blocked);
    assert_eq!(task.parent_id.as_deref(), Some("parent-1"));

    let calls = runner.take_calls();
    assert_eq!(calls.len(), 4);
    assert_eq!(
        calls[0].args,
        vec![
            "update",
            "--title",
            "Renamed",
            "--description",
            "Updated description",
            "--notes",
            "Updated notes",
            "--status",
            "blocked",
            "--priority",
            "1",
            "--type",
            "feature",
            "--assignee",
            "alice",
            "--parent",
            "parent-1",
            "--set-labels",
            "api,backend",
            "--json",
            "--",
            "task-1",
        ]
        .into_iter()
        .map(str::to_string)
        .collect::<Vec<_>>()
    );
    let metadata_root = metadata_from_call(&calls[2]);
    assert_eq!(
        metadata_root["openducktor"]["qaRequired"],
        Value::Bool(false)
    );
    Ok(())
}

#[test]
fn update_task_can_update_only_ai_review_metadata() -> Result<()> {
    let repo = RepoFixture::new("update-task-metadata");
    let current = issue_value(
        "task-1",
        "open",
        "task",
        None,
        json!([]),
        Some(json!({"openducktor": {"qaRequired": false}})),
    );
    let updated = issue_value(
        "task-1",
        "open",
        "task",
        None,
        json!([]),
        Some(json!({"openducktor": {"qaRequired": true}})),
    );
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::WithEnv(Ok(json!([current]).to_string())),
        MockStep::WithEnv(Ok("{}".to_string())),
        MockStep::WithEnv(Ok(json!([updated]).to_string())),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let task = store.update_task(
        repo.path(),
        "task-1",
        UpdateTaskPatch {
            title: None,
            description: None,
            notes: None,
            status: None,
            priority: None,
            issue_type: None,
            ai_review_enabled: Some(true),
            labels: None,
            assignee: None,
            parent_id: None,
        },
    )?;
    assert!(task.ai_review_enabled);

    let calls = runner.take_calls();
    assert_eq!(calls.len(), 3);
    assert_eq!(calls[0].args[0], "show");
    assert_eq!(calls[1].args[0], "update");
    let metadata_root = metadata_from_call(&calls[1]);
    assert_eq!(
        metadata_root["openducktor"]["qaRequired"],
        Value::Bool(true)
    );
    Ok(())
}

#[test]
fn delete_task_forwards_cascade_flag() -> Result<()> {
    let repo = RepoFixture::new("delete-task");
    let runner = MockCommandRunner::with_steps(vec![MockStep::WithEnv(Ok("done".to_string()))]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    assert!(store.delete_task(repo.path(), "task-1", true)?);
    let calls = runner.take_calls();
    assert_eq!(calls.len(), 1);
    assert!(!calls[0].args.iter().any(|entry| entry == "--reason"));
    assert!(calls[0].args.iter().any(|entry| entry == "--cascade"));
    assert!(calls[0].args.iter().any(|entry| entry == "--"));
    assert_eq!(calls[0].args.last().map(String::as_str), Some("task-1"));
    Ok(())
}

#[test]
fn get_spec_reads_latest_entry_and_falls_back_to_empty() -> Result<()> {
    let repo = RepoFixture::new("get-spec");
    let with_entries = issue_value(
        "task-1",
        "open",
        "task",
        None,
        json!([]),
        Some(json!({
            "openducktor": {
                "documents": {
                    "spec": [
                        {
                            "markdown": "# Spec v1",
                            "updatedAt": "2026-02-20T11:00:00Z",
                            "updatedBy": "planner-agent",
                            "sourceTool": "set_spec",
                            "revision": 1
                        },
                        {
                            "markdown": "# Spec v2",
                            "updatedAt": "2026-02-20T12:00:00Z",
                            "updatedBy": "planner-agent",
                            "sourceTool": "set_spec",
                            "revision": 2
                        }
                    ]
                }
            }
        })),
    );
    let empty = issue_value("task-1", "open", "task", None, json!([]), None);
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::WithEnv(Ok(json!([with_entries]).to_string())),
        MockStep::WithEnv(Ok(json!([empty]).to_string())),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner);

    let latest = store.get_spec(repo.path(), "task-1")?;
    assert_eq!(latest.markdown, "# Spec v2");
    assert_eq!(latest.updated_at.as_deref(), Some("2026-02-20T12:00:00Z"));

    let missing = store.get_spec(repo.path(), "task-1")?;
    assert!(missing.markdown.is_empty());
    assert!(missing.updated_at.is_none());
    Ok(())
}

#[test]
fn set_spec_trims_markdown_and_increments_revision() -> Result<()> {
    let repo = RepoFixture::new("set-spec");
    let current = issue_value(
        "task-1",
        "open",
        "task",
        None,
        json!([]),
        Some(json!({
            "openducktor": {
                "documents": {
                    "spec": [
                        {
                            "markdown": "# Spec v2",
                            "updatedAt": "2026-02-20T12:00:00Z",
                            "updatedBy": "planner-agent",
                            "sourceTool": "set_spec",
                            "revision": 2
                        }
                    ]
                }
            }
        })),
    );
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::WithEnv(Ok(json!([current]).to_string())),
        MockStep::WithEnv(Ok("{}".to_string())),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let spec = store.set_spec(repo.path(), "task-1", "  ## Updated Spec  ")?;
    assert_eq!(spec.markdown, "## Updated Spec");
    assert!(spec.updated_at.as_deref().is_some());

    let calls = runner.take_calls();
    assert_eq!(calls.len(), 2);
    let metadata_root = metadata_from_call(&calls[1]);
    let entry = &metadata_root["openducktor"]["documents"]["spec"][0];
    assert_eq!(
        entry["markdown"],
        Value::String("## Updated Spec".to_string())
    );
    assert_eq!(entry["revision"], Value::Number(3.into()));
    assert_eq!(entry["sourceTool"], Value::String("set_spec".to_string()));
    assert!(entry["updatedAt"].as_str().is_some());
    Ok(())
}

#[test]
fn get_and_set_plan_use_implementation_plan_metadata() -> Result<()> {
    let repo = RepoFixture::new("plan-docs");
    let current_with_plan = issue_value(
        "task-1",
        "open",
        "task",
        None,
        json!([]),
        Some(json!({
            "openducktor": {
                "documents": {
                    "implementationPlan": [
                        {
                            "markdown": "# Plan v4",
                            "updatedAt": "2026-02-20T12:30:00Z",
                            "updatedBy": "planner-agent",
                            "sourceTool": "set_plan",
                            "revision": 4
                        }
                    ]
                }
            }
        })),
    );
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::WithEnv(Ok(json!([current_with_plan.clone()]).to_string())),
        MockStep::WithEnv(Ok(json!([current_with_plan]).to_string())),
        MockStep::WithEnv(Ok("{}".to_string())),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let plan = store.get_plan(repo.path(), "task-1")?;
    assert_eq!(plan.markdown, "# Plan v4");

    let updated = store.set_plan(repo.path(), "task-1", "  # Plan v5 ")?;
    assert_eq!(updated.markdown, "# Plan v5");

    let calls = runner.take_calls();
    let metadata_root = metadata_from_call(&calls[2]);
    let entry = &metadata_root["openducktor"]["documents"]["implementationPlan"][0];
    assert_eq!(entry["markdown"], Value::String("# Plan v5".to_string()));
    assert_eq!(entry["revision"], Value::Number(5.into()));
    assert_eq!(entry["sourceTool"], Value::String("set_plan".to_string()));
    Ok(())
}

#[test]
fn qa_reports_store_latest_entry_and_preserve_next_revision() -> Result<()> {
    let repo = RepoFixture::new("qa-docs");
    let empty = issue_value("task-1", "open", "task", None, json!([]), None);
    let with_reports = issue_value(
        "task-1",
        "open",
        "task",
        None,
        json!([]),
        Some(json!({
            "openducktor": {
                "documents": {
                    "qaReports": [
                        {
                            "markdown": "Initial QA",
                            "verdict": "approved",
                            "updatedAt": "2026-02-20T10:00:00Z",
                            "updatedBy": "qa-agent",
                            "sourceTool": "odt_qa_approved",
                            "revision": 1
                        }
                    ]
                }
            }
        })),
    );
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::WithEnv(Ok(json!([empty]).to_string())),
        MockStep::WithEnv(Ok(json!([with_reports]).to_string())),
        MockStep::WithEnv(Ok("{}".to_string())),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let missing = store.get_latest_qa_report(repo.path(), "task-1")?;
    assert!(missing.is_none());

    let appended = store.append_qa_report(
        repo.path(),
        "task-1",
        "  Needs fixes  ",
        QaVerdict::Rejected,
    )?;
    assert_eq!(appended.markdown, "Needs fixes");
    assert_eq!(appended.verdict, QaVerdict::Rejected);
    assert_eq!(appended.revision, 2);

    let calls = runner.take_calls();
    let metadata_root = metadata_from_call(&calls[2]);
    let reports = metadata_root["openducktor"]["documents"]["qaReports"]
        .as_array()
        .expect("qaReports should be an array");
    assert_eq!(reports.len(), 1);
    let newest = reports.first().expect("latest report missing");
    assert_eq!(newest["revision"], Value::Number(2.into()));
    assert_eq!(
        newest["sourceTool"],
        Value::String("odt_qa_rejected".to_string())
    );
    Ok(())
}

#[test]
fn append_qa_report_rejects_malformed_existing_metadata() {
    let repo = RepoFixture::new("qa-docs-invalid");
    let malformed = issue_value(
        "task-1",
        "open",
        "task",
        None,
        json!([]),
        Some(json!({
            "openducktor": {
                "documents": {
                    "qaReports": {
                        "unexpected": true
                    }
                }
            }
        })),
    );
    let runner =
        MockCommandRunner::with_steps(vec![MockStep::WithEnv(Ok(json!([malformed]).to_string()))]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let error = store
        .append_qa_report(repo.path(), "task-1", "Needs fixes", QaVerdict::Rejected)
        .expect_err("malformed qaReports metadata should fail");
    assert!(error
        .to_string()
        .contains("Invalid existing qaReports metadata: expected an array"));

    let calls = runner.take_calls();
    assert_eq!(calls.len(), 1);
}

#[test]
fn record_qa_outcome_updates_status_and_metadata_in_one_update_call() -> Result<()> {
    let repo = RepoFixture::new("qa-outcome");
    let current = issue_value(
        "task-1",
        "ai_review",
        "task",
        None,
        json!([]),
        Some(json!({
            "openducktor": {
                "documents": {
                    "qaReports": [
                        {
                            "markdown": "Initial QA",
                            "verdict": "rejected",
                            "updatedAt": "2026-02-20T10:00:00Z",
                            "updatedBy": "qa-agent",
                            "sourceTool": "odt_qa_rejected",
                            "revision": 1
                        }
                    ]
                }
            }
        })),
    );
    let updated = issue_value(
        "task-1",
        "human_review",
        "task",
        None,
        json!([]),
        Some(json!({
            "openducktor": {
                "documents": {
                    "qaReports": [
                        {
                            "markdown": "Looks good",
                            "verdict": "approved",
                            "updatedAt": "2026-02-20T12:00:00Z",
                            "updatedBy": "qa-agent",
                            "sourceTool": "odt_qa_approved",
                            "revision": 2
                        }
                    ]
                }
            }
        })),
    );
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::WithEnv(Ok("ok".to_string())),
        MockStep::WithEnv(Ok(json!([current]).to_string())),
        MockStep::WithEnv(Ok(updated.to_string())),
        MockStep::WithEnv(Ok(json!([updated]).to_string())),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let task = store.record_qa_outcome(
        repo.path(),
        "task-1",
        TaskStatus::HumanReview,
        "  Looks good  ",
        QaVerdict::Approved,
    )?;
    assert_eq!(task.status, TaskStatus::HumanReview);

    let calls = runner.take_calls();
    assert_eq!(calls.len(), 4);
    assert_eq!(
        calls[0].args,
        vec!["config", "set", "status.custom", CUSTOM_STATUS_VALUES]
            .into_iter()
            .map(str::to_string)
            .collect::<Vec<_>>()
    );
    let update_call = &calls[2];
    assert!(update_call.args.iter().any(|entry| entry == "--status"));
    assert!(update_call.args.iter().any(|entry| entry == "human_review"));

    let metadata_root = metadata_from_call(update_call);
    let reports = metadata_root["openducktor"]["documents"]["qaReports"]
        .as_array()
        .expect("qaReports should be an array");
    assert_eq!(reports.len(), 1);
    let newest = reports.first().expect("latest report missing");
    assert_eq!(newest["markdown"], Value::String("Looks good".to_string()));
    assert_eq!(newest["verdict"], Value::String("approved".to_string()));
    assert_eq!(newest["revision"], Value::Number(2.into()));
    assert_eq!(
        newest["sourceTool"],
        Value::String("odt_qa_approved".to_string())
    );
    Ok(())
}

#[test]
fn get_latest_qa_report_returns_latest_entry_when_present() -> Result<()> {
    let repo = RepoFixture::new("qa-latest");
    let with_reports = issue_value(
        "task-1",
        "open",
        "task",
        None,
        json!([]),
        Some(json!({
            "openducktor": {
                "documents": {
                    "qaReports": [
                        {
                            "markdown": "First report",
                            "verdict": "rejected",
                            "updatedAt": "2026-02-20T10:00:00Z",
                            "updatedBy": "qa-agent",
                            "sourceTool": "odt_qa_rejected",
                            "revision": 1
                        },
                        {
                            "markdown": "Second report",
                            "verdict": "approved",
                            "updatedAt": "2026-02-20T11:00:00Z",
                            "updatedBy": "qa-agent",
                            "sourceTool": "odt_qa_approved",
                            "revision": 2
                        }
                    ]
                }
            }
        })),
    );
    let runner = MockCommandRunner::with_steps(vec![MockStep::WithEnv(Ok(
        json!([with_reports]).to_string()
    ))]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner);

    let latest = store
        .get_latest_qa_report(repo.path(), "task-1")?
        .expect("latest report should exist");
    assert_eq!(latest.markdown, "Second report");
    assert_eq!(latest.verdict, QaVerdict::Approved);
    assert_eq!(latest.updated_at, "2026-02-20T11:00:00Z");
    assert_eq!(latest.revision, 2);
    Ok(())
}

#[test]
fn list_tasks_parses_agent_sessions_for_multiple_tasks_in_single_list_call() -> Result<()> {
    let repo = RepoFixture::new("list-task-sessions");
    let task_one = issue_value(
        "task-1",
        "open",
        "task",
        None,
        json!([]),
        Some(json!({
            "openducktor": {
                "agentSessions": [
                    serde_json::to_value(make_session("session-old", "2026-02-20T09:00:00Z"))?,
                    serde_json::to_value(make_session("session-new", "2026-02-20T11:00:00Z"))?
                ]
            }
        })),
    );
    let task_two = issue_value(
        "task-2",
        "open",
        "task",
        None,
        json!([]),
        Some(json!({
            "openducktor": {
                "agentSessions": []
            }
        })),
    );
    let runner =
        MockCommandRunner::with_steps(vec![MockStep::WithEnv(Ok(
            json!([task_one, task_two]).to_string()
        ))]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let tasks = store.list_tasks(repo.path())?;

    assert_eq!(tasks.len(), 2);
    assert_eq!(
        tasks[0]
            .agent_sessions
            .iter()
            .map(|session| session.session_id.as_str())
            .collect::<Vec<_>>(),
        vec!["session-new", "session-old"]
    );
    assert!(tasks[1].agent_sessions.is_empty());

    let calls = runner.take_calls();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].program, "bd");
    assert_eq!(calls[0].args[0], "list");
    Ok(())
}

#[test]
fn list_agent_sessions_is_sorted_descending_by_started_at() -> Result<()> {
    let repo = RepoFixture::new("list-sessions");
    let payload = issue_value(
        "task-1",
        "open",
        "task",
        None,
        json!([]),
        Some(json!({
            "openducktor": {
                "agentSessions": [
                    serde_json::to_value(make_session("session-old", "2026-02-20T09:00:00Z"))?,
                    serde_json::to_value(make_session("session-new", "2026-02-20T11:00:00Z"))?
                ]
            }
        })),
    );
    let runner =
        MockCommandRunner::with_steps(vec![MockStep::WithEnv(Ok(json!([payload]).to_string()))]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner);

    let sessions = store.list_agent_sessions(repo.path(), "task-1")?;
    assert_eq!(sessions.len(), 2);
    assert_eq!(sessions[0].session_id, "session-new");
    assert_eq!(sessions[1].session_id, "session-old");
    Ok(())
}

#[test]
fn upsert_agent_session_updates_existing_session_without_duplication() -> Result<()> {
    let repo = RepoFixture::new("upsert-session");
    let payload = issue_value(
        "task-1",
        "open",
        "task",
        None,
        json!([]),
        Some(json!({
            "openducktor": {
                "agentSessions": [
                    serde_json::to_value(make_session("session-1", "2026-02-20T10:00:00Z"))?,
                    serde_json::to_value(make_session("session-2", "2026-02-20T09:00:00Z"))?
                ]
            }
        })),
    );
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::WithEnv(Ok(json!([payload]).to_string())),
        MockStep::WithEnv(Ok("{}".to_string())),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let updated = make_session("session-1", "2026-02-20T12:00:00Z");
    store.upsert_agent_session(repo.path(), "task-1", updated)?;

    let calls = runner.take_calls();
    let metadata_root = metadata_from_call(&calls[1]);
    let sessions = metadata_root["openducktor"]["agentSessions"]
        .as_array()
        .expect("agentSessions should be an array");
    assert_eq!(sessions.len(), 2);
    let session_1 = sessions
        .iter()
        .find(|entry| entry["sessionId"] == Value::String("session-1".to_string()))
        .expect("session-1 missing");
    assert!(session_1.get("status").is_none());
    assert_eq!(
        session_1.get("externalSessionId").and_then(Value::as_str),
        Some("external-session-1")
    );
    assert_eq!(
        session_1.get("scenario").and_then(Value::as_str),
        Some("build_default")
    );
    assert!(session_1.get("baseUrl").is_none());
    Ok(())
}

#[test]
fn upsert_agent_session_truncates_to_latest_100_entries() -> Result<()> {
    let repo = RepoFixture::new("upsert-session-truncate");
    let existing = (0..100)
        .map(|index| {
            let started_at = format!("2026-02-20T{:02}:00:00Z", index % 24);
            serde_json::to_value(make_session(
                &format!("session-{index:03}"),
                started_at.as_str(),
            ))
            .expect("session should serialize")
        })
        .collect::<Vec<_>>();
    let payload = issue_value(
        "task-1",
        "open",
        "task",
        None,
        json!([]),
        Some(json!({
            "openducktor": {
                "agentSessions": existing
            }
        })),
    );
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::WithEnv(Ok(json!([payload]).to_string())),
        MockStep::WithEnv(Ok("{}".to_string())),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let newest = make_session("session-newest", "2026-02-21T00:00:00Z");
    store.upsert_agent_session(repo.path(), "task-1", newest)?;

    let calls = runner.take_calls();
    let metadata_root = metadata_from_call(&calls[1]);
    let sessions = metadata_root["openducktor"]["agentSessions"]
        .as_array()
        .expect("agentSessions should be an array");
    assert_eq!(sessions.len(), 100);
    assert!(sessions
        .iter()
        .any(|entry| entry["sessionId"] == Value::String("session-newest".to_string())));
    Ok(())
}

#[test]
fn get_task_metadata_fetches_all_fields_in_single_call() -> Result<()> {
    let repo = RepoFixture::new("get-task-metadata");
    let issue = issue_value(
        "task-1",
        "open",
        "task",
        None,
        json!([]),
        Some(json!({
            "openducktor": {
                "documents": {
                    "spec": [
                        {
                            "markdown": "# Spec content",
                            "updatedAt": "2026-02-20T10:00:00Z",
                            "updatedBy": "planner-agent",
                            "sourceTool": "set_spec",
                            "revision": 1
                        }
                    ],
                    "implementationPlan": [
                        {
                            "markdown": "# Plan content",
                            "updatedAt": "2026-02-20T11:00:00Z",
                            "updatedBy": "planner-agent",
                            "sourceTool": "set_plan",
                            "revision": 1
                        }
                    ],
                    "qaReports": [
                        {
                            "markdown": "# QA Report",
                            "verdict": "approved",
                            "updatedAt": "2026-02-20T12:00:00Z",
                            "updatedBy": "qa-agent",
            "sourceTool": "odt_qa_approved",
                            "revision": 1
                        }
                    ]
                },
                "agentSessions": [
                    {
                        "sessionId": "session-1",
                        "externalSessionId": "ext-1",
                        "taskId": "task-1",
                        "role": "build",
                        "scenario": "default",
                        "status": "completed",
                        "startedAt": "2026-02-20T09:00:00Z",
                        "updatedAt": "2026-02-20T10:00:00Z",
                        "endedAt": "2026-02-20T10:00:00Z",
                        "runtimeId": "runtime-1",
                        "runId": "run-1",
                        "baseUrl": "http://localhost:8080",
                        "workingDirectory": "/tmp/work",
                        "selectedModel": null
                    }
                ]
            }
        })),
    );

    let runner =
        MockCommandRunner::with_steps(vec![MockStep::WithEnv(Ok(json!([issue]).to_string()))]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let metadata = store.get_task_metadata(repo.path(), "task-1")?;

    // Verify spec
    assert_eq!(metadata.spec.markdown, "# Spec content");
    assert_eq!(
        metadata.spec.updated_at.as_deref(),
        Some("2026-02-20T10:00:00Z")
    );

    // Verify plan
    assert_eq!(metadata.plan.markdown, "# Plan content");
    assert_eq!(
        metadata.plan.updated_at.as_deref(),
        Some("2026-02-20T11:00:00Z")
    );

    // Verify QA report
    let qa = metadata.qa_report.expect("qa_report should be present");
    assert_eq!(qa.markdown, "# QA Report");
    assert_eq!(qa.verdict, QaVerdict::Approved);
    assert_eq!(qa.revision, 1);

    // Verify agent sessions
    assert_eq!(metadata.agent_sessions.len(), 1);
    assert_eq!(metadata.agent_sessions[0].session_id, "session-1");
    assert_eq!(metadata.agent_sessions[0].role, "build");

    // Verify only one CLI call was made
    let calls = runner.take_calls();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].program, "bd");
    assert!(calls[0].args.contains(&"show".to_string()));

    Ok(())
}

#[test]
fn get_task_metadata_handles_empty_metadata() -> Result<()> {
    let repo = RepoFixture::new("get-task-metadata-empty");
    let issue = issue_value("task-1", "open", "task", None, json!([]), None);

    let runner =
        MockCommandRunner::with_steps(vec![MockStep::WithEnv(Ok(json!([issue]).to_string()))]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner);

    let metadata = store.get_task_metadata(repo.path(), "task-1")?;

    // All fields should be empty/default
    assert!(metadata.spec.markdown.is_empty());
    assert!(metadata.spec.updated_at.is_none());
    assert!(metadata.plan.markdown.is_empty());
    assert!(metadata.plan.updated_at.is_none());
    assert!(metadata.qa_report.is_none());
    assert!(metadata.agent_sessions.is_empty());

    Ok(())
}
