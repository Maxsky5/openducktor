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
    AllowFailureWithEnvAndWrites {
        result: std::result::Result<(bool, String, String), String>,
        writes: Vec<(PathBuf, String)>,
    },
}

#[derive(Debug, Clone)]
pub(super) struct RecordedCall {
    pub(super) program: String,
    pub(super) args: Vec<String>,
    pub(super) cwd: Option<PathBuf>,
}

#[derive(Debug, Default)]
pub(super) struct MockCommandRunner {
    steps: Mutex<VecDeque<MockStep>>,
    calls: Mutex<Vec<RecordedCall>>,
    uses_real_processes: bool,
}

impl MockCommandRunner {
    pub(super) fn with_steps(steps: Vec<MockStep>) -> Arc<Self> {
        Arc::new(Self {
            steps: Mutex::new(VecDeque::from(steps)),
            calls: Mutex::new(Vec::new()),
            uses_real_processes: false,
        })
    }

    pub(super) fn with_steps_using_real_processes(steps: Vec<MockStep>) -> Arc<Self> {
        Arc::new(Self {
            steps: Mutex::new(VecDeque::from(steps)),
            calls: Mutex::new(Vec::new()),
            uses_real_processes: true,
        })
    }

    pub(super) fn assert_no_remaining_steps(&self) {
        let remaining = self.steps.lock().expect("steps lock poisoned").len();
        assert_eq!(
            remaining, 0,
            "expected all mock command steps to be consumed"
        );
    }

    pub(super) fn take_calls(&self) -> Vec<RecordedCall> {
        self.assert_no_remaining_steps();
        self.calls
            .lock()
            .expect("calls lock poisoned")
            .drain(..)
            .collect()
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
            | (MockStep::AllowFailureWithEnv(_), CallKind::AllowFailureWithEnv)
            | (MockStep::AllowFailureWithEnvAndWrites { .. }, CallKind::AllowFailureWithEnv) => {
                step
            }
            _ => panic!(
                "unexpected command invocation kind, expected {:?}, got {:?}",
                expected_kind, step
            ),
        }
    }

    fn apply_writes(&self, writes: &[(PathBuf, String)]) {
        for (path, contents) in writes {
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).expect("mock write parent should be writable");
            }
            fs::write(path, contents).expect("mock write target should be writable");
        }
    }

    fn record_call(
        &self,
        _kind: CallKind,
        program: &str,
        args: &[&str],
        cwd: Option<&Path>,
        _env: &[(&str, &str)],
    ) {
        self.calls
            .lock()
            .expect("calls lock poisoned")
            .push(RecordedCall {
                program: program.to_string(),
                args: args.iter().map(|entry| (*entry).to_string()).collect(),
                cwd: cwd.map(Path::to_path_buf),
            });
    }
}

impl Drop for MockCommandRunner {
    fn drop(&mut self) {
        if std::thread::panicking() {
            return;
        }
        self.assert_no_remaining_steps();
    }
}

impl CommandRunner for MockCommandRunner {
    fn uses_real_processes(&self) -> bool {
        self.uses_real_processes
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
            MockStep::AllowFailureWithEnvAndWrites { .. } => {
                unreachable!("call kind already checked")
            }
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
            MockStep::AllowFailureWithEnvAndWrites { result, writes } => {
                self.apply_writes(&writes);
                result.map_err(|message| anyhow!(message))
            }
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

pub(super) fn write_attachment_metadata(beads_dir: &Path, repo_path: &Path, port: u16) {
    fs::create_dir_all(beads_dir).expect("beads dir should be writable");
    let database_name = compute_beads_database_name(repo_path).expect("expected database name");
    let effective_port = match read_shared_dolt_server_state() {
        Ok(Some(state)) => state.port,
        Ok(None) => port,
        Err(error) => panic!("failed reading shared Dolt server state: {error}"),
    };
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
