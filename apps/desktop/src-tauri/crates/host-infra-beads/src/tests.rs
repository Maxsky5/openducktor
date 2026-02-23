use super::{
    default_ai_review_enabled, metadata_bool_qa_required, metadata_namespace, normalize_issue_type,
    normalize_labels, normalize_text_option, parse_agent_sessions, parse_markdown_entries,
    parse_metadata_root, parse_qa_entries, BeadsTaskStore, CommandRunner, ProcessCommandRunner,
    CUSTOM_STATUS_VALUES,
};
use anyhow::{anyhow, Result};
use host_domain::{
    AgentSessionDocument, CreateTaskInput, QaVerdict, TaskStatus, TaskStore, UpdateTaskPatch,
};
use host_infra_system::{compute_repo_slug, resolve_central_beads_dir};
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

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
    cwd: Option<PathBuf>,
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
        cwd: Option<&Path>,
        env: &[(&str, &str)],
    ) {
        self.calls
            .lock()
            .expect("calls lock poisoned")
            .push(RecordedCall {
                kind,
                program: program.to_string(),
                args: args.iter().map(|entry| (*entry).to_string()).collect(),
                cwd: cwd.map(Path::to_path_buf),
                env: env
                    .iter()
                    .map(|(key, value)| ((*key).to_string(), (*value).to_string()))
                    .collect(),
            });
    }
}

impl CommandRunner for MockCommandRunner {
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
        if let Ok(beads_dir) = resolve_central_beads_dir(&self.path) {
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
}

fn make_session(session_id: &str, started_at: &str, status: &str) -> AgentSessionDocument {
    AgentSessionDocument {
        session_id: session_id.to_string(),
        external_session_id: format!("external-{session_id}"),
        task_id: "task-1".to_string(),
        role: "build".to_string(),
        scenario: "build_default".to_string(),
        status: status.to_string(),
        started_at: started_at.to_string(),
        updated_at: started_at.to_string(),
        ended_at: None,
        runtime_id: Some("runtime-1".to_string()),
        run_id: None,
        base_url: "http://127.0.0.1:4173".to_string(),
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
    let runner = MockCommandRunner::with_steps(vec![MockStep::AllowFailureWithEnv(Ok((
        true,
        format!("invalid-json-{sensitive}"),
        String::new(),
    )))]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner);
    let beads_dir = resolve_central_beads_dir(repo.path())?;

    let error = store
        .verify_repo_initialized(repo.path(), &beads_dir)
        .expect_err("invalid where payload should fail");
    let message = error.to_string();
    assert!(message.contains("Failed to parse `bd where --json` output"));
    assert!(!message.contains(sensitive));
    Ok(())
}

#[test]
fn show_task_uses_id_flag_when_loading_issue() -> Result<()> {
    let repo = RepoFixture::new("show-with-id-flag");
    let issue = issue_value("task-1", "open", "task", None, json!([]), None);
    let runner =
        MockCommandRunner::with_steps(vec![MockStep::WithEnv(Ok(json!([issue]).to_string()))]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let task = store.show_task(repo.path(), "task-1")?;
    assert_eq!(task.id, "task-1");

    let calls = runner.take_calls();
    assert_eq!(calls.len(), 1);
    assert_eq!(
        calls[0].args,
        vec!["--no-daemon", "show", "--id", "task-1", "--json"]
            .into_iter()
            .map(str::to_string)
            .collect::<Vec<_>>()
    );
    Ok(())
}

#[test]
fn issue_type_and_ai_review_defaults_are_normalized() {
    assert_eq!(normalize_issue_type("feature"), "feature");
    assert_eq!(normalize_issue_type("unknown-type"), "task");
    assert!(default_ai_review_enabled("epic"));
    assert!(default_ai_review_enabled("unknown-type"));
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
            "sourceTool": "qa_approved",
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
            "taskId": "task-1",
            "role": "spec",
            "scenario": "spec_initial",
            "status": "idle",
            "startedAt": "2026-02-18T17:20:00Z",
            "updatedAt": "2026-02-18T17:21:00Z",
            "endedAt": null,
            "runtimeId": "runtime-1",
            "runId": null,
            "baseUrl": "http://127.0.0.1:4173",
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
    assert_eq!(sessions[0].external_session_id, "session-opencode-1");
}

#[test]
fn ensure_repo_initialized_skips_init_when_store_is_ready() -> Result<()> {
    let repo = RepoFixture::new("init-ready");
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::AllowFailureWithEnv(Ok((
            true,
            r#"{"path":"/tmp/central/.beads"}"#.to_string(),
            String::new(),
        ))),
        MockStep::WithEnv(Ok("ok".to_string())),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    store.ensure_repo_initialized(repo.path())?;
    assert_eq!(runner.remaining_steps(), 0);

    let calls = runner.take_calls();
    assert_eq!(calls.len(), 2);
    assert_eq!(calls[0].kind, CallKind::AllowFailureWithEnv);
    assert_eq!(
        calls[0].args,
        vec!["--no-daemon", "where", "--json"]
            .into_iter()
            .map(str::to_string)
            .collect::<Vec<_>>()
    );
    assert_eq!(calls[1].kind, CallKind::WithEnv);
    assert_eq!(
        calls[1].args,
        vec![
            "--no-daemon",
            "config",
            "set",
            "status.custom",
            CUSTOM_STATUS_VALUES
        ]
        .into_iter()
        .map(str::to_string)
        .collect::<Vec<_>>()
    );
    assert_eq!(calls[0].program, "bd");
    assert_eq!(calls[0].cwd.as_deref(), Some(repo.path()));
    assert_beads_env(&calls[0]);
    assert_beads_env(&calls[1]);
    Ok(())
}

#[test]
fn ensure_repo_initialized_runs_init_then_uses_cache_when_database_exists() -> Result<()> {
    let repo = RepoFixture::new("init-path");
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::AllowFailureWithEnv(Ok((false, String::new(), "not initialized".to_string()))),
        MockStep::AllowFailureWithEnv(Ok((true, String::new(), String::new()))),
        MockStep::AllowFailureWithEnv(Ok((
            true,
            r#"{"path":"/tmp/central/.beads"}"#.to_string(),
            String::new(),
        ))),
        MockStep::WithEnv(Ok("ok".to_string())),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    store.ensure_repo_initialized(repo.path())?;

    let beads_dir = resolve_central_beads_dir(repo.path())?;
    fs::create_dir_all(&beads_dir)?;
    fs::write(beads_dir.join("beads.db"), "cached").expect("beads.db should be writable");

    store.ensure_repo_initialized(repo.path())?;
    assert_eq!(runner.remaining_steps(), 0);

    let calls = runner.take_calls();
    assert_eq!(calls.len(), 4);
    let expected_slug = compute_repo_slug(repo.path());
    assert_eq!(
        calls[1].args,
        vec![
            "--no-daemon",
            "init",
            "--quiet",
            "--skip-hooks",
            "--skip-merge-driver",
            "--prefix",
            expected_slug.as_str(),
        ]
        .into_iter()
        .map(str::to_string)
        .collect::<Vec<_>>()
    );
    assert_beads_env(&calls[1]);
    Ok(())
}

#[test]
fn ensure_repo_initialized_returns_error_when_init_fails() {
    let repo = RepoFixture::new("init-fails");
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::AllowFailureWithEnv(Ok((false, String::new(), "where failed".to_string()))),
        MockStep::AllowFailureWithEnv(Ok((false, String::new(), "permission denied".to_string()))),
    ]);
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
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::AllowFailureWithEnv(Ok((false, String::new(), "missing".to_string()))),
        MockStep::AllowFailureWithEnv(Ok((true, String::new(), String::new()))),
        MockStep::AllowFailureWithEnv(Ok((true, "{}".to_string(), String::new()))),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner);

    let error = store
        .ensure_repo_initialized(repo.path())
        .expect_err("init should fail when store remains unready");
    assert!(error.to_string().contains("store is not ready"));
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
                                "sourceTool": "qa_approved",
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
        vec!["--no-daemon", "list", "--all", "--limit", "0", "--json"]
            .into_iter()
            .map(str::to_string)
            .collect::<Vec<_>>()
    );
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
            issue_type: "feature".to_string(),
            priority: 3,
            description: Some("  expose endpoint ".to_string()),
            acceptance_criteria: Some("  green tests ".to_string()),
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
            "--no-daemon",
            "create",
            "Build API",
            "--type",
            "feature",
            "--priority",
            "3",
            "--description",
            "expose endpoint",
            "--acceptance",
            "green tests",
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
    assert_eq!(calls[1].args[1], "update");
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
            acceptance_criteria: Some("Updated acceptance".to_string()),
            notes: Some("Updated notes".to_string()),
            status: Some(TaskStatus::Blocked),
            priority: Some(1),
            issue_type: Some("feature".to_string()),
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
            "--no-daemon",
            "update",
            "--title",
            "Renamed",
            "--description",
            "Updated description",
            "--acceptance",
            "Updated acceptance",
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
            acceptance_criteria: None,
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
    assert_eq!(calls[0].args[1], "show");
    assert_eq!(calls[1].args[1], "update");
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
fn set_spec_switches_namespace_after_config_recovers() -> Result<()> {
    let repo = RepoFixture::new("set-spec-namespace-resync");
    let current = issue_value("task-1", "open", "task", None, json!([]), None);
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::WithEnv(Ok(json!([current.clone()]).to_string())),
        MockStep::WithEnv(Ok("{}".to_string())),
        MockStep::WithEnv(Ok(json!([current]).to_string())),
        MockStep::WithEnv(Ok("{}".to_string())),
    ]);

    let namespace_results = Arc::new(Mutex::new(VecDeque::from(vec![
        Err(anyhow!("config temporarily unreadable")),
        Ok("custom-ns".to_string()),
    ])));
    let namespace_results_for_resolver = Arc::clone(&namespace_results);
    let resolver: Arc<dyn Fn() -> Result<String> + Send + Sync> = Arc::new(move || {
        let mut guard = namespace_results_for_resolver
            .lock()
            .map_err(|_| anyhow!("namespace resolver lock poisoned"))?;
        guard
            .pop_front()
            .unwrap_or_else(|| Ok("custom-ns".to_string()))
    });

    let store = BeadsTaskStore::with_test_runner_and_namespace_resolver(
        "openducktor",
        runner.clone(),
        resolver,
    );

    store.set_spec(repo.path(), "task-1", "First write")?;
    store.set_spec(repo.path(), "task-1", "Second write")?;

    let calls = runner.take_calls();
    assert_eq!(calls.len(), 4);

    let first_metadata_root = metadata_from_call(&calls[1]);
    assert!(first_metadata_root.get("openducktor").is_some());
    assert!(first_metadata_root.get("custom-ns").is_none());

    let second_metadata_root = metadata_from_call(&calls[3]);
    assert!(second_metadata_root.get("custom-ns").is_some());
    assert!(second_metadata_root.get("openducktor").is_none());

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
fn qa_reports_support_latest_lookup_and_append_history() -> Result<()> {
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
                            "sourceTool": "qa_approved",
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
    assert_eq!(reports.len(), 2);
    let newest = reports.last().expect("newest report missing");
    assert_eq!(newest["revision"], Value::Number(2.into()));
    assert_eq!(
        newest["sourceTool"],
        Value::String("qa_rejected".to_string())
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
                            "sourceTool": "qa_rejected",
                            "revision": 1
                        },
                        {
                            "markdown": "Second report",
                            "verdict": "approved",
                            "updatedAt": "2026-02-20T11:00:00Z",
                            "updatedBy": "qa-agent",
                            "sourceTool": "qa_approved",
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
                    serde_json::to_value(make_session("session-old", "2026-02-20T09:00:00Z", "idle"))?,
                    serde_json::to_value(make_session("session-new", "2026-02-20T11:00:00Z", "running"))?
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
                    serde_json::to_value(make_session("session-1", "2026-02-20T10:00:00Z", "idle"))?,
                    serde_json::to_value(make_session("session-2", "2026-02-20T09:00:00Z", "idle"))?
                ]
            }
        })),
    );
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::WithEnv(Ok(json!([payload]).to_string())),
        MockStep::WithEnv(Ok("{}".to_string())),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let mut updated = make_session("session-1", "2026-02-20T12:00:00Z", "running");
    updated.updated_at = "2026-02-20T12:01:00Z".to_string();
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
    assert_eq!(session_1["status"], Value::String("running".to_string()));
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
                "idle",
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

    let newest = make_session("session-newest", "2026-02-21T00:00:00Z", "running");
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
