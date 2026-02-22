use super::{AppService, RunEmitter};
use anyhow::{anyhow, Result};
use host_domain::{
    AgentSessionDocument, CreateTaskInput, GitBranch, GitCurrentBranch, GitPort, GitPushSummary,
    QaReportDocument, QaVerdict, RunEvent, SpecDocument, TaskCard, TaskDocumentSummary, TaskStatus,
    TaskStore, UpdateTaskPatch,
};
use host_infra_system::AppConfigStore;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Default)]
pub(crate) struct TaskStoreState {
    pub ensure_calls: Vec<String>,
    pub tasks: Vec<TaskCard>,
    pub updated_patches: Vec<(String, UpdateTaskPatch)>,
    pub agent_sessions: Vec<AgentSessionDocument>,
}

#[derive(Clone)]
pub(crate) struct FakeTaskStore {
    pub state: Arc<Mutex<TaskStoreState>>,
}

impl TaskStore for FakeTaskStore {
    fn ensure_repo_initialized(&self, repo_path: &Path) -> Result<()> {
        let mut state = self.state.lock().expect("task store lock poisoned");
        state
            .ensure_calls
            .push(repo_path.to_string_lossy().to_string());
        Ok(())
    }

    fn list_tasks(&self, _repo_path: &Path) -> Result<Vec<TaskCard>> {
        let state = self.state.lock().expect("task store lock poisoned");
        Ok(state.tasks.clone())
    }

    fn create_task(&self, _repo_path: &Path, input: CreateTaskInput) -> Result<TaskCard> {
        let mut state = self.state.lock().expect("task store lock poisoned");
        let task = TaskCard {
            id: format!("generated-{}", state.tasks.len() + 1),
            title: input.title,
            description: input.description.unwrap_or_default(),
            acceptance_criteria: input.acceptance_criteria.unwrap_or_default(),
            notes: String::new(),
            status: TaskStatus::Open,
            priority: input.priority,
            issue_type: input.issue_type,
            ai_review_enabled: input.ai_review_enabled.unwrap_or(true),
            available_actions: Vec::new(),
            labels: input.labels.unwrap_or_default(),
            assignee: None,
            parent_id: input.parent_id,
            subtask_ids: Vec::new(),
            document_summary: TaskDocumentSummary::default(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
            created_at: "2026-01-01T00:00:00Z".to_string(),
        };
        state.tasks.push(task.clone());
        Ok(task)
    }

    fn update_task(
        &self,
        _repo_path: &Path,
        task_id: &str,
        patch: UpdateTaskPatch,
    ) -> Result<TaskCard> {
        let mut state = self.state.lock().expect("task store lock poisoned");
        state
            .updated_patches
            .push((task_id.to_string(), patch.clone()));
        let index = state
            .tasks
            .iter()
            .position(|task| task.id == task_id)
            .ok_or_else(|| anyhow!("task not found: {task_id}"))?;

        let mut updated = state.tasks[index].clone();
        if let Some(title) = patch.title {
            updated.title = title;
        }
        if let Some(status) = patch.status {
            updated.status = status;
        }
        if let Some(issue_type) = patch.issue_type {
            updated.issue_type = issue_type;
        }
        if let Some(ai_review_enabled) = patch.ai_review_enabled {
            updated.ai_review_enabled = ai_review_enabled;
        }
        if let Some(parent_id) = patch.parent_id {
            updated.parent_id = Some(parent_id);
        }
        if let Some(labels) = patch.labels {
            updated.labels = labels;
        }

        state.tasks[index] = updated.clone();
        Ok(updated)
    }

    fn delete_task(
        &self,
        _repo_path: &Path,
        _task_id: &str,
        _delete_subtasks: bool,
    ) -> Result<bool> {
        Ok(true)
    }

    fn get_spec(&self, _repo_path: &Path, _task_id: &str) -> Result<SpecDocument> {
        Ok(SpecDocument {
            markdown: String::new(),
            updated_at: None,
        })
    }

    fn set_spec(&self, _repo_path: &Path, _task_id: &str, markdown: &str) -> Result<SpecDocument> {
        Ok(SpecDocument {
            markdown: markdown.to_string(),
            updated_at: Some("2026-01-01T00:00:00Z".to_string()),
        })
    }

    fn get_plan(&self, _repo_path: &Path, _task_id: &str) -> Result<SpecDocument> {
        Ok(SpecDocument {
            markdown: String::new(),
            updated_at: None,
        })
    }

    fn set_plan(&self, _repo_path: &Path, _task_id: &str, markdown: &str) -> Result<SpecDocument> {
        Ok(SpecDocument {
            markdown: markdown.to_string(),
            updated_at: Some("2026-01-01T00:00:00Z".to_string()),
        })
    }

    fn get_latest_qa_report(
        &self,
        _repo_path: &Path,
        _task_id: &str,
    ) -> Result<Option<QaReportDocument>> {
        Ok(None)
    }

    fn append_qa_report(
        &self,
        _repo_path: &Path,
        _task_id: &str,
        markdown: &str,
        verdict: QaVerdict,
    ) -> Result<QaReportDocument> {
        Ok(QaReportDocument {
            markdown: markdown.to_string(),
            verdict,
            updated_at: "2026-01-01T00:00:00Z".to_string(),
            revision: 1,
        })
    }

    fn list_agent_sessions(
        &self,
        _repo_path: &Path,
        _task_id: &str,
    ) -> Result<Vec<AgentSessionDocument>> {
        let state = self.state.lock().expect("task store lock poisoned");
        Ok(state.agent_sessions.clone())
    }

    fn upsert_agent_session(
        &self,
        _repo_path: &Path,
        _task_id: &str,
        session: AgentSessionDocument,
    ) -> Result<()> {
        let mut state = self.state.lock().expect("task store lock poisoned");
        if let Some(index) = state
            .agent_sessions
            .iter()
            .position(|entry| entry.session_id == session.session_id)
        {
            state.agent_sessions[index] = session;
        } else {
            state.agent_sessions.push(session);
        }
        Ok(())
    }
}

#[derive(Debug)]
pub(crate) struct GitState {
    pub last_push_remote: Option<String>,
    pub branches: Vec<GitBranch>,
    pub current_branch: GitCurrentBranch,
}

#[derive(Clone)]
pub(crate) struct FakeGitPort {
    pub state: Arc<Mutex<GitState>>,
}

impl GitPort for FakeGitPort {
    fn get_branches(&self, _repo_path: &Path) -> Result<Vec<GitBranch>> {
        let state = self.state.lock().expect("git state lock poisoned");
        Ok(state.branches.clone())
    }

    fn get_current_branch(&self, _repo_path: &Path) -> Result<GitCurrentBranch> {
        let state = self.state.lock().expect("git state lock poisoned");
        Ok(state.current_branch.clone())
    }

    fn switch_branch(
        &self,
        _repo_path: &Path,
        branch: &str,
        _create: bool,
    ) -> Result<GitCurrentBranch> {
        let mut state = self.state.lock().expect("git state lock poisoned");
        state.current_branch = GitCurrentBranch {
            name: Some(branch.to_string()),
            detached: false,
        };
        Ok(state.current_branch.clone())
    }

    fn create_worktree(
        &self,
        _repo_path: &Path,
        _worktree_path: &Path,
        _branch: &str,
        _create_branch: bool,
    ) -> Result<()> {
        Ok(())
    }

    fn remove_worktree(
        &self,
        _repo_path: &Path,
        _worktree_path: &Path,
        _force: bool,
    ) -> Result<()> {
        Ok(())
    }

    fn push_branch(
        &self,
        _repo_path: &Path,
        remote: &str,
        branch: &str,
        _set_upstream: bool,
        _force_with_lease: bool,
    ) -> Result<GitPushSummary> {
        let mut state = self.state.lock().expect("git state lock poisoned");
        state.last_push_remote = Some(remote.to_string());
        Ok(GitPushSummary {
            remote: remote.to_string(),
            branch: branch.to_string(),
            output: "ok".to_string(),
        })
    }
}

pub(crate) fn build_service_with_state(
    tasks: Vec<TaskCard>,
) -> (AppService, Arc<Mutex<TaskStoreState>>, Arc<Mutex<GitState>>) {
    let task_state = Arc::new(Mutex::new(TaskStoreState {
        ensure_calls: Vec::new(),
        tasks,
        updated_patches: Vec::new(),
        agent_sessions: Vec::new(),
    }));
    let git_state = Arc::new(Mutex::new(GitState {
        last_push_remote: None,
        branches: Vec::new(),
        current_branch: GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
    }));
    let task_store: Arc<dyn TaskStore> = Arc::new(FakeTaskStore {
        state: task_state.clone(),
    });
    let git_port: Arc<dyn GitPort> = Arc::new(FakeGitPort {
        state: git_state.clone(),
    });

    let config_store = AppConfigStore::from_path(unique_temp_path("host-app-module-tests-config"));
    let service = AppService::with_git_port(task_store, config_store, git_port);
    (service, task_state, git_state)
}

pub(crate) fn make_task(id: &str, issue_type: &str, status: TaskStatus) -> TaskCard {
    TaskCard {
        id: id.to_string(),
        title: format!("Task {id}"),
        description: String::new(),
        acceptance_criteria: String::new(),
        notes: String::new(),
        status,
        priority: 2,
        issue_type: issue_type.to_string(),
        ai_review_enabled: true,
        available_actions: Vec::new(),
        labels: Vec::new(),
        assignee: None,
        parent_id: None,
        subtask_ids: Vec::new(),
        document_summary: TaskDocumentSummary::default(),
        updated_at: "2026-01-01T00:00:00Z".to_string(),
        created_at: "2026-01-01T00:00:00Z".to_string(),
    }
}

pub(crate) fn make_emitter(events: Arc<Mutex<Vec<RunEvent>>>) -> RunEmitter {
    Arc::new(move |event| {
        events.lock().expect("events lock poisoned").push(event);
    })
}

fn unique_temp_path(name: &str) -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time")
        .as_nanos();
    std::env::temp_dir().join(format!("openducktor-host-app-{name}-{nonce}"))
}
