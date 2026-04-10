use super::*;
use std::collections::VecDeque;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum CallKind {
    WithEnv,
    AllowFailureWithEnv,
}

#[derive(Debug, Clone)]
pub(super) enum MockStep {
    WithEnv(std::result::Result<String, String>),
    AllowFailureWithEnv(std::result::Result<(bool, String, String), String>),
}

#[derive(Debug, Clone)]
pub(super) struct RecordedCall {
    pub(super) kind: CallKind,
    pub(super) program: String,
    pub(super) args: Vec<String>,
    pub(super) cwd: Option<String>,
    pub(super) env: Vec<(String, String)>,
}

#[derive(Debug, Default)]
pub(super) struct MockCommandRunner {
    steps: Mutex<VecDeque<MockStep>>,
    calls: Mutex<Vec<RecordedCall>>,
}

impl MockCommandRunner {
    pub(super) fn with_steps(steps: Vec<MockStep>) -> Arc<Self> {
        Arc::new(Self {
            steps: Mutex::new(VecDeque::from(steps)),
            calls: Mutex::new(Vec::new()),
        })
    }

    pub(super) fn take_calls(&self) -> Vec<RecordedCall> {
        self.calls
            .lock()
            .expect("calls lock poisoned")
            .drain(..)
            .collect()
    }

    pub(super) fn remaining_steps(&self) -> usize {
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
                cwd: cwd.map(|path| path.display().to_string()),
                env: env
                    .iter()
                    .map(|(key, value)| ((*key).to_string(), (*value).to_string()))
                    .collect(),
            });
    }
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
            MockStep::AllowFailureWithEnv(_) => unreachable!("call kind already checked"),
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

pub(super) struct RepoFixture {
    path: PathBuf,
}

impl RepoFixture {
    pub(super) fn new(label: &str) -> Self {
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

    pub(super) fn path(&self) -> &Path {
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

pub(super) fn issue_value(
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

pub(super) fn metadata_from_call(call: &RecordedCall) -> Value {
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

pub(super) fn assert_attachment_root_cwd(call: &RecordedCall, repo_path: &Path) {
    let expected = resolve_repo_beads_attachment_root(repo_path)
        .expect("expected attachment root")
        .display()
        .to_string();
    assert_eq!(call.cwd.as_deref(), Some(expected.as_str()));
}

pub(super) fn assert_beads_env(call: &RecordedCall) {
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

pub(super) fn assert_init_args(call: &RecordedCall, repo_path: &Path, beads_dir: &Path) {
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

pub(super) fn assert_dolt_backup_restore_args(
    call: &RecordedCall,
    repo_path: &Path,
    beads_dir: &Path,
) {
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

pub(super) fn write_attachment_metadata(beads_dir: &Path, repo_path: &Path, port: u16) {
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

pub(super) fn make_session(session_id: &str, started_at: &str) -> AgentSessionDocument {
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
