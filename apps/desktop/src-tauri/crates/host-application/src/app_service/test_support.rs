#![allow(unused_imports)]

use super::build_orchestrator::{BuildResponseAction, CleanupMode};
use super::{
    allows_transition, build_opencode_config_content, build_opencode_startup_event_payload,
    can_set_plan, can_set_spec_from_status, default_mcp_workspace_root, derive_available_actions,
    is_orphaned_opencode_server_process, normalize_required_markdown,
    normalize_subtask_plan_inputs, parse_mcp_command_json, read_opencode_process_registry,
    read_opencode_version, resolve_mcp_command, resolve_opencode_binary_path,
    terminate_child_process, terminate_process_by_pid, validate_parent_relationships_for_create,
    validate_parent_relationships_for_update, validate_plan_subtask_rules, validate_transition,
    wait_for_local_server, wait_for_local_server_with_process,
    with_locked_opencode_process_registry, AgentRuntimeProcess, AppService,
    OpencodeProcessRegistryInstance, OpencodeStartupMetricsSnapshot,
    OpencodeStartupReadinessPolicy, OpencodeStartupWaitReport, RunProcess,
    TrackedOpencodeProcessGuard, OPENCODE_PROCESS_REGISTRY_RELATIVE_PATH,
};
use anyhow::{anyhow, Context, Result};
use host_domain::{
    AgentSessionDocument, AgentWorkflows, CreateTaskInput, DirectMergeRecord, GitAheadBehind,
    GitBranch, GitCommitAllRequest, GitCommitAllResult, GitConflictAbortRequest,
    GitConflictAbortResult, GitConflictOperation, GitCurrentBranch, GitDiffScope, GitFileDiff,
    GitFileStatus, GitFileStatusCounts, GitMergeBranchRequest, GitMergeBranchResult,
    GitMergeMethod, GitPort, GitPullRequest, GitPullResult, GitPushResult, GitRebaseAbortRequest,
    GitRebaseAbortResult, GitRebaseBranchRequest, GitRebaseBranchResult, GitUpstreamAheadBehind,
    GitWorktreeStatusData, GitWorktreeStatusSummaryData, IssueType, PlanSubtaskInput,
    PullRequestRecord, QaReportDocument, QaVerdict, QaWorkflowVerdict, RunEvent, RunState,
    RunSummary, RuntimeInstanceSummary, SpecDocument, TaskAction, TaskCard, TaskDocumentSummary,
    TaskMetadata, TaskStatus, TaskStore, UpdateTaskPatch,
};
use host_infra_system::{
    AppConfigStore, GlobalConfig, HookSet, OpencodeStartupReadinessConfig, RepoConfig,
};
pub(crate) use host_test_support::{lock_env, EnvVarGuard};
use serde_json::Value;
use std::collections::HashMap;
use std::ffi::OsString;
use std::fs;
#[cfg(unix)]
use std::fs::Permissions;
use std::io::Write;
use std::net::{TcpListener, TcpStream};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub(crate) fn make_task(id: &str, issue_type: &str, status: TaskStatus) -> TaskCard {
    TaskCard {
        id: id.to_string(),
        title: format!("Task {id}"),
        description: String::new(),
        notes: String::new(),
        status,
        priority: 2,
        issue_type: IssueType::from_cli_value(issue_type).unwrap_or(IssueType::Task),
        ai_review_enabled: true,
        available_actions: Vec::new(),
        labels: Vec::new(),
        assignee: None,
        parent_id: None,
        subtask_ids: Vec::new(),
        pull_request: None,
        document_summary: TaskDocumentSummary::default(),
        agent_workflows: AgentWorkflows::default(),
        updated_at: "2026-01-01T00:00:00Z".to_string(),
        created_at: "2026-01-01T00:00:00Z".to_string(),
    }
}

pub(crate) fn write_private_file(path: &Path, contents: &str) -> Result<()> {
    fs::write(path, contents)?;
    #[cfg(unix)]
    fs::set_permissions(path, Permissions::from_mode(0o600))?;
    Ok(())
}

#[derive(Debug, Default)]
pub(crate) struct TaskStoreState {
    pub(crate) ensure_calls: Vec<String>,
    pub(crate) ensure_error: Option<String>,
    pub(crate) tasks: Vec<TaskCard>,
    pub(crate) list_error: Option<String>,
    pub(crate) delete_calls: Vec<(String, bool)>,
    pub(crate) created_inputs: Vec<CreateTaskInput>,
    pub(crate) updated_patches: Vec<(String, UpdateTaskPatch)>,
    pub(crate) spec_get_calls: Vec<String>,
    pub(crate) spec_set_calls: Vec<(String, String)>,
    pub(crate) plan_get_calls: Vec<String>,
    pub(crate) plan_set_calls: Vec<(String, String)>,
    pub(crate) metadata_get_calls: Vec<String>,
    pub(crate) qa_append_calls: Vec<(String, String, QaVerdict)>,
    pub(crate) qa_outcome_calls: Vec<(String, TaskStatus, String, QaVerdict)>,
    pub(crate) latest_qa_report: Option<QaReportDocument>,
    pub(crate) agent_sessions: Vec<AgentSessionDocument>,
    pub(crate) upserted_sessions: Vec<(String, AgentSessionDocument)>,
    pub(crate) cleared_session_roles: Vec<(String, Vec<String>)>,
    pub(crate) clear_agent_sessions_error: Option<String>,
    pub(crate) cleared_qa_reports: Vec<String>,
    pub(crate) pull_requests: HashMap<String, PullRequestRecord>,
    pub(crate) direct_merge_records: HashMap<String, DirectMergeRecord>,
}

#[derive(Clone)]
pub(crate) struct FakeTaskStore {
    pub(crate) state: Arc<Mutex<TaskStoreState>>,
}

impl TaskStore for FakeTaskStore {
    fn ensure_repo_initialized(&self, repo_path: &Path) -> Result<()> {
        let mut state = self.state.lock().expect("task store lock poisoned");
        if let Some(message) = state.ensure_error.as_ref() {
            return Err(anyhow!(message.clone()));
        }
        state
            .ensure_calls
            .push(repo_path.to_string_lossy().to_string());
        Ok(())
    }

    fn list_tasks(&self, _repo_path: &Path) -> Result<Vec<TaskCard>> {
        let state = self.state.lock().expect("task store lock poisoned");
        if let Some(message) = state.list_error.as_ref() {
            return Err(anyhow!(message.clone()));
        }
        Ok(state.tasks.clone())
    }

    fn create_task(&self, _repo_path: &Path, input: CreateTaskInput) -> Result<TaskCard> {
        let mut state = self.state.lock().expect("task store lock poisoned");
        state.created_inputs.push(input.clone());
        let task = TaskCard {
            id: format!("generated-{}", state.tasks.len() + 1),
            title: input.title,
            description: input.description.unwrap_or_default(),
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
            pull_request: None,
            document_summary: TaskDocumentSummary::default(),
            agent_workflows: AgentWorkflows::default(),
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

    fn delete_task(&self, _repo_path: &Path, task_id: &str, delete_subtasks: bool) -> Result<bool> {
        let mut state = self.state.lock().expect("task store lock poisoned");
        state
            .delete_calls
            .push((task_id.to_string(), delete_subtasks));
        Ok(true)
    }

    fn get_spec(&self, _repo_path: &Path, _task_id: &str) -> Result<SpecDocument> {
        let mut state = self.state.lock().expect("task store lock poisoned");
        state.spec_get_calls.push(_task_id.to_string());
        Ok(SpecDocument {
            markdown: String::new(),
            updated_at: None,
        })
    }

    fn set_spec(&self, _repo_path: &Path, _task_id: &str, markdown: &str) -> Result<SpecDocument> {
        let mut state = self.state.lock().expect("task store lock poisoned");
        state
            .spec_set_calls
            .push((_task_id.to_string(), markdown.to_string()));
        Ok(SpecDocument {
            markdown: markdown.to_string(),
            updated_at: Some("2026-01-01T00:00:00Z".to_string()),
        })
    }

    fn get_plan(&self, _repo_path: &Path, _task_id: &str) -> Result<SpecDocument> {
        let mut state = self.state.lock().expect("task store lock poisoned");
        state.plan_get_calls.push(_task_id.to_string());
        Ok(SpecDocument {
            markdown: String::new(),
            updated_at: None,
        })
    }

    fn set_plan(&self, _repo_path: &Path, _task_id: &str, markdown: &str) -> Result<SpecDocument> {
        let mut state = self.state.lock().expect("task store lock poisoned");
        state
            .plan_set_calls
            .push((_task_id.to_string(), markdown.to_string()));
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
        let state = self.state.lock().expect("task store lock poisoned");
        Ok(state.latest_qa_report.clone())
    }

    fn append_qa_report(
        &self,
        _repo_path: &Path,
        _task_id: &str,
        markdown: &str,
        verdict: QaVerdict,
    ) -> Result<QaReportDocument> {
        let mut state = self.state.lock().expect("task store lock poisoned");
        state
            .qa_append_calls
            .push((_task_id.to_string(), markdown.to_string(), verdict.clone()));
        Ok(QaReportDocument {
            markdown: markdown.to_string(),
            verdict,
            updated_at: "2026-01-01T00:00:00Z".to_string(),
            revision: 1,
        })
    }

    fn record_qa_outcome(
        &self,
        _repo_path: &Path,
        _task_id: &str,
        target_status: TaskStatus,
        markdown: &str,
        verdict: QaVerdict,
    ) -> Result<TaskCard> {
        let mut state = self.state.lock().expect("task store lock poisoned");
        state.qa_outcome_calls.push((
            _task_id.to_string(),
            target_status.clone(),
            markdown.to_string(),
            verdict.clone(),
        ));
        state.latest_qa_report = Some(QaReportDocument {
            markdown: markdown.to_string(),
            verdict: verdict.clone(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
            revision: 1,
        });

        let index = state
            .tasks
            .iter()
            .position(|task| task.id == _task_id)
            .ok_or_else(|| anyhow!("task not found: {_task_id}"))?;
        let mut updated = state.tasks[index].clone();
        updated.status = target_status;
        updated.document_summary.qa_report.has = true;
        updated.document_summary.qa_report.updated_at = Some("2026-01-01T00:00:00Z".to_string());
        updated.document_summary.qa_report.verdict = match verdict {
            QaVerdict::Approved => QaWorkflowVerdict::Approved,
            QaVerdict::Rejected => QaWorkflowVerdict::Rejected,
        };
        state.tasks[index] = updated.clone();
        Ok(updated)
    }

    fn list_agent_sessions(
        &self,
        _repo_path: &Path,
        _task_id: &str,
    ) -> Result<Vec<AgentSessionDocument>> {
        let state = self.state.lock().expect("task store lock poisoned");
        Ok(state
            .agent_sessions
            .iter()
            .filter(|session| session.task_id.as_deref() == Some(_task_id))
            .cloned()
            .collect())
    }

    fn upsert_agent_session(
        &self,
        _repo_path: &Path,
        _task_id: &str,
        session: AgentSessionDocument,
    ) -> Result<()> {
        let mut state = self.state.lock().expect("task store lock poisoned");
        state
            .upserted_sessions
            .push((_task_id.to_string(), session.clone()));
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

    fn clear_agent_sessions_by_roles(
        &self,
        _repo_path: &Path,
        task_id: &str,
        roles: &[&str],
    ) -> Result<()> {
        let mut state = self.state.lock().expect("task store lock poisoned");
        if let Some(message) = state.clear_agent_sessions_error.as_ref() {
            return Err(anyhow!(message.clone()));
        }
        state.cleared_session_roles.push((
            task_id.to_string(),
            roles.iter().map(|role| (*role).to_string()).collect(),
        ));
        state.agent_sessions.retain(|session| {
            session.task_id.as_deref() != Some(task_id)
                || !roles.iter().any(|role| session.role == *role)
        });
        Ok(())
    }

    fn clear_qa_reports(&self, _repo_path: &Path, task_id: &str) -> Result<()> {
        let mut state = self.state.lock().expect("task store lock poisoned");
        state.cleared_qa_reports.push(task_id.to_string());
        state.latest_qa_report = None;
        if let Some(task) = state.tasks.iter_mut().find(|task| task.id == task_id) {
            task.document_summary.qa_report = TaskDocumentSummary::default().qa_report;
        }
        Ok(())
    }

    fn set_pull_request(
        &self,
        _repo_path: &Path,
        task_id: &str,
        pull_request: Option<PullRequestRecord>,
    ) -> Result<()> {
        let mut state = self.state.lock().expect("task store lock poisoned");
        match pull_request.clone() {
            Some(pull_request) => {
                state
                    .pull_requests
                    .insert(task_id.to_string(), pull_request);
            }
            None => {
                state.pull_requests.remove(task_id);
            }
        }
        if let Some(task) = state.tasks.iter_mut().find(|task| task.id == task_id) {
            task.pull_request = pull_request;
        }
        Ok(())
    }

    fn set_direct_merge_record(
        &self,
        _repo_path: &Path,
        task_id: &str,
        direct_merge: Option<DirectMergeRecord>,
    ) -> Result<()> {
        let mut state = self.state.lock().expect("task store lock poisoned");
        match direct_merge {
            Some(direct_merge) => {
                state
                    .direct_merge_records
                    .insert(task_id.to_string(), direct_merge);
            }
            None => {
                state.direct_merge_records.remove(task_id);
            }
        }
        Ok(())
    }

    fn get_task_metadata(&self, _repo_path: &Path, _task_id: &str) -> Result<TaskMetadata> {
        let mut state = self.state.lock().expect("task store lock poisoned");
        state.metadata_get_calls.push(_task_id.to_string());
        let qa_report = state.latest_qa_report.clone();
        let agent_sessions = state
            .agent_sessions
            .iter()
            .filter(|session| session.task_id.as_deref() == Some(_task_id))
            .cloned()
            .collect();
        Ok(TaskMetadata {
            spec: SpecDocument {
                markdown: String::new(),
                updated_at: None,
            },
            plan: SpecDocument {
                markdown: String::new(),
                updated_at: None,
            },
            qa_report,
            pull_request: state.pull_requests.get(_task_id).cloned(),
            direct_merge: state.direct_merge_records.get(_task_id).cloned(),
            agent_sessions,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum GitCall {
    GetBranches {
        repo_path: String,
    },
    GetCurrentBranch {
        repo_path: String,
    },
    SwitchBranch {
        repo_path: String,
        branch: String,
        create: bool,
    },
    CreateWorktree {
        repo_path: String,
        worktree_path: String,
        branch: String,
        create_branch: bool,
    },
    RemoveWorktree {
        repo_path: String,
        worktree_path: String,
        force: bool,
    },
    DeleteLocalBranch {
        repo_path: String,
        branch: String,
        force: bool,
    },
    PushBranch {
        repo_path: String,
        remote: String,
        branch: String,
        set_upstream: bool,
        force_with_lease: bool,
    },
    PullBranch {
        repo_path: String,
        working_dir: Option<String>,
    },
    CommitAll {
        repo_path: String,
        working_dir: Option<String>,
        message: String,
    },
    RebaseBranch {
        repo_path: String,
        working_dir: Option<String>,
        target_branch: String,
    },
    RebaseAbort {
        repo_path: String,
        working_dir: Option<String>,
    },
    AbortConflict {
        repo_path: String,
        operation: GitConflictOperation,
        working_dir: Option<String>,
    },
    MergeBranch {
        repo_path: String,
        source_branch: String,
        target_branch: String,
        method: GitMergeMethod,
        squash_commit_message: Option<String>,
    },
    SuggestedSquashCommitMessage {
        repo_path: String,
        source_branch: String,
        target_branch: String,
    },
    IsAncestor {
        repo_path: String,
        ancestor_ref: String,
        descendant_ref: String,
    },
    GetWorktreeStatus {
        repo_path: String,
        target_branch: String,
        diff_scope: GitDiffScope,
    },
    GetWorktreeStatusSummary {
        repo_path: String,
        target_branch: String,
        diff_scope: GitDiffScope,
    },
    CommitsAheadBehind {
        repo_path: String,
        target_branch: String,
    },
}

#[derive(Debug)]
pub(crate) struct GitState {
    pub(crate) calls: Vec<GitCall>,
    pub(crate) branches: Vec<GitBranch>,
    pub(crate) current_branch: GitCurrentBranch,
    pub(crate) current_branches_by_path: HashMap<String, GitCurrentBranch>,
    pub(crate) remove_worktree_error: Option<String>,
    pub(crate) delete_local_branch_error: Option<String>,
    pub(crate) worktree_status_data: Option<GitWorktreeStatusData>,
    pub(crate) last_push_remote: Option<String>,
    pub(crate) push_branch_result: GitPushResult,
    pub(crate) pull_branch_result: GitPullResult,
    pub(crate) commit_all_result: GitCommitAllResult,
    pub(crate) rebase_branch_result: GitRebaseBranchResult,
    pub(crate) rebase_abort_result: GitRebaseAbortResult,
    pub(crate) conflict_abort_result: GitConflictAbortResult,
    pub(crate) merge_branch_result: GitMergeBranchResult,
    pub(crate) suggested_squash_commit_message_result: Option<String>,
    pub(crate) is_ancestor_result: bool,
    pub(crate) commits_ahead_behind_result: GitAheadBehind,
}

#[derive(Clone)]
pub(crate) struct FakeGitPort {
    pub(crate) state: Arc<Mutex<GitState>>,
}

impl GitPort for FakeGitPort {
    fn get_branches(&self, repo_path: &Path) -> Result<Vec<GitBranch>> {
        let mut state = self.state.lock().expect("git state lock poisoned");
        state.calls.push(GitCall::GetBranches {
            repo_path: repo_path.to_string_lossy().to_string(),
        });
        Ok(state.branches.clone())
    }

    fn get_current_branch(&self, repo_path: &Path) -> Result<GitCurrentBranch> {
        let mut state = self.state.lock().expect("git state lock poisoned");
        let repo_path = repo_path.to_string_lossy().to_string();
        state.calls.push(GitCall::GetCurrentBranch {
            repo_path: repo_path.clone(),
        });
        Ok(state
            .current_branches_by_path
            .get(repo_path.as_str())
            .cloned()
            .unwrap_or_else(|| state.current_branch.clone()))
    }

    fn switch_branch(
        &self,
        repo_path: &Path,
        branch: &str,
        create: bool,
    ) -> Result<GitCurrentBranch> {
        let mut state = self.state.lock().expect("git state lock poisoned");
        state.calls.push(GitCall::SwitchBranch {
            repo_path: repo_path.to_string_lossy().to_string(),
            branch: branch.to_string(),
            create,
        });
        state.current_branch = GitCurrentBranch {
            name: Some(branch.to_string()),
            detached: false,
            revision: None,
        };
        Ok(state.current_branch.clone())
    }

    fn create_worktree(
        &self,
        repo_path: &Path,
        worktree_path: &Path,
        branch: &str,
        create_branch: bool,
    ) -> Result<()> {
        let mut state = self.state.lock().expect("git state lock poisoned");
        state.calls.push(GitCall::CreateWorktree {
            repo_path: repo_path.to_string_lossy().to_string(),
            worktree_path: worktree_path.to_string_lossy().to_string(),
            branch: branch.to_string(),
            create_branch,
        });
        Ok(())
    }

    fn remove_worktree(&self, repo_path: &Path, worktree_path: &Path, force: bool) -> Result<()> {
        let mut state = self.state.lock().expect("git state lock poisoned");
        state.calls.push(GitCall::RemoveWorktree {
            repo_path: repo_path.to_string_lossy().to_string(),
            worktree_path: worktree_path.to_string_lossy().to_string(),
            force,
        });
        if let Some(message) = state.remove_worktree_error.clone() {
            return Err(anyhow!(message));
        }
        Ok(())
    }

    fn delete_local_branch(&self, repo_path: &Path, branch: &str, force: bool) -> Result<()> {
        let mut state = self.state.lock().expect("git state lock poisoned");
        state.calls.push(GitCall::DeleteLocalBranch {
            repo_path: repo_path.to_string_lossy().to_string(),
            branch: branch.to_string(),
            force,
        });
        if let Some(message) = state.delete_local_branch_error.clone() {
            return Err(anyhow!(message));
        }
        Ok(())
    }

    fn push_branch(
        &self,
        repo_path: &Path,
        remote: &str,
        branch: &str,
        set_upstream: bool,
        force_with_lease: bool,
    ) -> Result<GitPushResult> {
        let mut state = self.state.lock().expect("git state lock poisoned");
        state.calls.push(GitCall::PushBranch {
            repo_path: repo_path.to_string_lossy().to_string(),
            remote: remote.to_string(),
            branch: branch.to_string(),
            set_upstream,
            force_with_lease,
        });
        state.last_push_remote = Some(remote.to_string());
        Ok(state.push_branch_result.clone())
    }

    fn pull_branch(&self, repo_path: &Path, request: GitPullRequest) -> Result<GitPullResult> {
        let mut state = self.state.lock().expect("git state lock poisoned");
        state.calls.push(GitCall::PullBranch {
            repo_path: repo_path.to_string_lossy().to_string(),
            working_dir: request.working_dir,
        });
        Ok(state.pull_branch_result.clone())
    }

    fn commit_all(
        &self,
        repo_path: &Path,
        request: GitCommitAllRequest,
    ) -> Result<GitCommitAllResult> {
        let mut state = self.state.lock().expect("git state lock poisoned");
        state.calls.push(GitCall::CommitAll {
            repo_path: repo_path.to_string_lossy().to_string(),
            working_dir: request.working_dir,
            message: request.message,
        });
        Ok(state.commit_all_result.clone())
    }

    fn rebase_branch(
        &self,
        repo_path: &Path,
        request: GitRebaseBranchRequest,
    ) -> Result<GitRebaseBranchResult> {
        let mut state = self.state.lock().expect("git state lock poisoned");
        state.calls.push(GitCall::RebaseBranch {
            repo_path: repo_path.to_string_lossy().to_string(),
            working_dir: request.working_dir,
            target_branch: request.target_branch,
        });
        Ok(state.rebase_branch_result.clone())
    }

    fn rebase_abort(
        &self,
        repo_path: &Path,
        request: GitRebaseAbortRequest,
    ) -> Result<GitRebaseAbortResult> {
        let mut state = self.state.lock().expect("git state lock poisoned");
        state.calls.push(GitCall::RebaseAbort {
            repo_path: repo_path.to_string_lossy().to_string(),
            working_dir: request.working_dir,
        });
        Ok(state.rebase_abort_result.clone())
    }

    fn abort_conflict(
        &self,
        repo_path: &Path,
        request: GitConflictAbortRequest,
    ) -> Result<GitConflictAbortResult> {
        let mut state = self.state.lock().expect("git state lock poisoned");
        let GitConflictAbortRequest {
            operation,
            working_dir,
        } = request;
        state.calls.push(GitCall::AbortConflict {
            repo_path: repo_path.to_string_lossy().to_string(),
            operation,
            working_dir,
        });
        Ok(state.conflict_abort_result.clone())
    }

    fn merge_branch(
        &self,
        repo_path: &Path,
        request: GitMergeBranchRequest,
    ) -> Result<GitMergeBranchResult> {
        let mut state = self.state.lock().expect("git state lock poisoned");
        state.calls.push(GitCall::MergeBranch {
            repo_path: repo_path.to_string_lossy().to_string(),
            source_branch: request.source_branch,
            target_branch: request.target_branch,
            method: request.method,
            squash_commit_message: request.squash_commit_message,
        });
        Ok(state.merge_branch_result.clone())
    }

    fn suggested_squash_commit_message(
        &self,
        repo_path: &Path,
        source_branch: &str,
        target_branch: &str,
    ) -> Result<Option<String>> {
        let mut state = self.state.lock().expect("git state lock poisoned");
        state.calls.push(GitCall::SuggestedSquashCommitMessage {
            repo_path: repo_path.to_string_lossy().to_string(),
            source_branch: source_branch.to_string(),
            target_branch: target_branch.to_string(),
        });
        Ok(state.suggested_squash_commit_message_result.clone())
    }

    fn is_ancestor(
        &self,
        repo_path: &Path,
        ancestor_ref: &str,
        descendant_ref: &str,
    ) -> Result<bool> {
        let mut state = self.state.lock().expect("git state lock poisoned");
        state.calls.push(GitCall::IsAncestor {
            repo_path: repo_path.to_string_lossy().to_string(),
            ancestor_ref: ancestor_ref.to_string(),
            descendant_ref: descendant_ref.to_string(),
        });
        Ok(state.is_ancestor_result)
    }

    fn get_status(&self, _repo_path: &Path) -> Result<Vec<GitFileStatus>> {
        Ok(Vec::new())
    }

    fn get_diff(
        &self,
        _repo_path: &Path,
        _target_branch: Option<&str>,
    ) -> Result<Vec<GitFileDiff>> {
        Ok(Vec::new())
    }

    fn get_worktree_status(
        &self,
        repo_path: &Path,
        target_branch: &str,
        diff_scope: GitDiffScope,
    ) -> Result<GitWorktreeStatusData> {
        let mut state = self.state.lock().expect("git state lock poisoned");
        state.calls.push(GitCall::GetWorktreeStatus {
            repo_path: repo_path.to_string_lossy().to_string(),
            target_branch: target_branch.to_string(),
            diff_scope,
        });
        if let Some(configured) = state.worktree_status_data.clone() {
            return Ok(configured);
        }

        let current_branch = state.current_branch.clone();
        let upstream_ahead_behind = if current_branch.name.is_some() {
            GitUpstreamAheadBehind::Tracking {
                ahead: 0,
                behind: 0,
            }
        } else {
            GitUpstreamAheadBehind::Untracked { ahead: 0 }
        };

        Ok(GitWorktreeStatusData {
            current_branch,
            file_statuses: Vec::new(),
            file_diffs: Vec::new(),
            target_ahead_behind: GitAheadBehind {
                ahead: 0,
                behind: 0,
            },
            upstream_ahead_behind,
        })
    }

    fn get_worktree_status_summary(
        &self,
        repo_path: &Path,
        target_branch: &str,
        diff_scope: GitDiffScope,
    ) -> Result<GitWorktreeStatusSummaryData> {
        let mut state = self.state.lock().expect("git state lock poisoned");
        state.calls.push(GitCall::GetWorktreeStatusSummary {
            repo_path: repo_path.to_string_lossy().to_string(),
            target_branch: target_branch.to_string(),
            diff_scope,
        });

        let status_data = if let Some(configured) = state.worktree_status_data.clone() {
            configured
        } else {
            let current_branch = state.current_branch.clone();
            let upstream_ahead_behind = if current_branch.name.is_some() {
                GitUpstreamAheadBehind::Tracking {
                    ahead: 0,
                    behind: 0,
                }
            } else {
                GitUpstreamAheadBehind::Untracked { ahead: 0 }
            };

            GitWorktreeStatusData {
                current_branch,
                file_statuses: Vec::new(),
                file_diffs: Vec::new(),
                target_ahead_behind: GitAheadBehind {
                    ahead: 0,
                    behind: 0,
                },
                upstream_ahead_behind,
            }
        };

        let total = u32::try_from(status_data.file_statuses.len()).map_err(|_| {
            anyhow!(
                "too many file statuses to summarize in FakeGitPort: {}",
                status_data.file_statuses.len()
            )
        })?;
        let staged = u32::try_from(
            status_data
                .file_statuses
                .iter()
                .filter(|status| status.staged)
                .count(),
        )
        .map_err(|_| anyhow!("staged file status count overflowed u32 in FakeGitPort"))?;
        let unstaged = total
            .checked_sub(staged)
            .ok_or_else(|| anyhow!("unstaged file status count underflowed in FakeGitPort"))?;

        Ok(GitWorktreeStatusSummaryData {
            current_branch: status_data.current_branch,
            file_statuses: status_data.file_statuses,
            file_status_counts: GitFileStatusCounts {
                total,
                staged,
                unstaged,
            },
            target_ahead_behind: status_data.target_ahead_behind,
            upstream_ahead_behind: status_data.upstream_ahead_behind,
        })
    }

    fn resolve_upstream_target(&self, _repo_path: &Path) -> Result<Option<String>> {
        let state = self.state.lock().expect("git state lock poisoned");
        Ok(state
            .current_branch
            .name
            .as_ref()
            .map(|name| format!("refs/remotes/origin/{name}")))
    }

    fn commits_ahead_behind(
        &self,
        repo_path: &Path,
        target_branch: &str,
    ) -> Result<GitAheadBehind> {
        let mut state = self.state.lock().expect("git state lock poisoned");
        state.calls.push(GitCall::CommitsAheadBehind {
            repo_path: repo_path.to_string_lossy().to_string(),
            target_branch: target_branch.to_string(),
        });
        Ok(state.commits_ahead_behind_result.clone())
    }
}

pub(crate) fn build_service_with_state(
    tasks: Vec<TaskCard>,
) -> (AppService, Arc<Mutex<TaskStoreState>>, Arc<Mutex<GitState>>) {
    build_service_with_git_state(
        tasks,
        Vec::new(),
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    )
}

pub(crate) fn build_service_with_git_state_enforced(
    tasks: Vec<TaskCard>,
    branches: Vec<GitBranch>,
    current_branch: GitCurrentBranch,
) -> (AppService, Arc<Mutex<TaskStoreState>>, Arc<Mutex<GitState>>) {
    let task_state = Arc::new(Mutex::new(TaskStoreState {
        ensure_calls: Vec::new(),
        ensure_error: None,
        tasks,
        list_error: None,
        delete_calls: Vec::new(),
        created_inputs: Vec::new(),
        updated_patches: Vec::new(),
        spec_get_calls: Vec::new(),
        spec_set_calls: Vec::new(),
        plan_get_calls: Vec::new(),
        plan_set_calls: Vec::new(),
        metadata_get_calls: Vec::new(),
        qa_append_calls: Vec::new(),
        qa_outcome_calls: Vec::new(),
        latest_qa_report: None,
        agent_sessions: Vec::new(),
        upserted_sessions: Vec::new(),
        cleared_session_roles: Vec::new(),
        clear_agent_sessions_error: None,
        cleared_qa_reports: Vec::new(),
        pull_requests: HashMap::new(),
        direct_merge_records: HashMap::new(),
    }));
    let git_state = Arc::new(Mutex::new(GitState {
        calls: Vec::new(),
        branches,
        current_branch,
        current_branches_by_path: HashMap::new(),
        remove_worktree_error: None,
        delete_local_branch_error: None,
        worktree_status_data: None,
        last_push_remote: None,
        push_branch_result: GitPushResult::Pushed {
            remote: "origin".to_string(),
            branch: "feature/x".to_string(),
            output: "ok".to_string(),
        },
        pull_branch_result: GitPullResult::UpToDate {
            output: "Already up to date.".to_string(),
        },
        commit_all_result: GitCommitAllResult::Committed {
            commit_hash: "deadbeef".to_string(),
            output: "ok".to_string(),
        },
        rebase_branch_result: GitRebaseBranchResult::Rebased {
            output: "rebase completed".to_string(),
        },
        rebase_abort_result: GitRebaseAbortResult::Aborted {
            output: "rebase aborted".to_string(),
        },
        conflict_abort_result: GitConflictAbortResult {
            output: "conflict aborted".to_string(),
        },
        merge_branch_result: GitMergeBranchResult::Merged {
            output: "merge completed".to_string(),
        },
        suggested_squash_commit_message_result: Some("feat: builder change".to_string()),
        is_ancestor_result: false,
        commits_ahead_behind_result: GitAheadBehind {
            ahead: 0,
            behind: 0,
        },
    }));
    let task_store: Arc<dyn TaskStore> = Arc::new(FakeTaskStore {
        state: task_state.clone(),
    });
    let git_port: Arc<dyn GitPort> = Arc::new(FakeGitPort {
        state: git_state.clone(),
    });
    let config_store = AppConfigStore::from_path(unique_temp_path("host-app-config-enforced"));
    let service = AppService::with_git_port(task_store, config_store, git_port);
    (service, task_state, git_state)
}

pub(crate) fn build_service_with_git_state(
    tasks: Vec<TaskCard>,
    branches: Vec<GitBranch>,
    current_branch: GitCurrentBranch,
) -> (AppService, Arc<Mutex<TaskStoreState>>, Arc<Mutex<GitState>>) {
    let task_state = Arc::new(Mutex::new(TaskStoreState {
        ensure_calls: Vec::new(),
        ensure_error: None,
        tasks,
        list_error: None,
        delete_calls: Vec::new(),
        created_inputs: Vec::new(),
        updated_patches: Vec::new(),
        spec_get_calls: Vec::new(),
        spec_set_calls: Vec::new(),
        plan_get_calls: Vec::new(),
        plan_set_calls: Vec::new(),
        metadata_get_calls: Vec::new(),
        qa_append_calls: Vec::new(),
        qa_outcome_calls: Vec::new(),
        latest_qa_report: None,
        agent_sessions: Vec::new(),
        upserted_sessions: Vec::new(),
        cleared_session_roles: Vec::new(),
        clear_agent_sessions_error: None,
        cleared_qa_reports: Vec::new(),
        pull_requests: HashMap::new(),
        direct_merge_records: HashMap::new(),
    }));
    let git_state = Arc::new(Mutex::new(GitState {
        calls: Vec::new(),
        branches,
        current_branch,
        current_branches_by_path: HashMap::new(),
        remove_worktree_error: None,
        delete_local_branch_error: None,
        worktree_status_data: None,
        last_push_remote: None,
        push_branch_result: GitPushResult::Pushed {
            remote: "origin".to_string(),
            branch: "feature/x".to_string(),
            output: "ok".to_string(),
        },
        pull_branch_result: GitPullResult::UpToDate {
            output: "Already up to date.".to_string(),
        },
        commit_all_result: GitCommitAllResult::Committed {
            commit_hash: "deadbeef".to_string(),
            output: "ok".to_string(),
        },
        rebase_branch_result: GitRebaseBranchResult::Rebased {
            output: "rebase completed".to_string(),
        },
        rebase_abort_result: GitRebaseAbortResult::Aborted {
            output: "rebase aborted".to_string(),
        },
        conflict_abort_result: GitConflictAbortResult {
            output: "conflict aborted".to_string(),
        },
        merge_branch_result: GitMergeBranchResult::Merged {
            output: "merge completed".to_string(),
        },
        suggested_squash_commit_message_result: Some("feat: builder change".to_string()),
        is_ancestor_result: false,
        commits_ahead_behind_result: GitAheadBehind {
            ahead: 0,
            behind: 0,
        },
    }));
    let task_store: Arc<dyn TaskStore> = Arc::new(FakeTaskStore {
        state: task_state.clone(),
    });
    let git_port: Arc<dyn GitPort> = Arc::new(FakeGitPort {
        state: git_state.clone(),
    });
    let config_store = AppConfigStore::from_path(unique_temp_path("host-app-config"));
    let service = AppService::with_git_port_unrestricted(task_store, config_store, git_port);
    (service, task_state, git_state)
}

pub(crate) fn make_session(task_id: &str, session_id: &str) -> AgentSessionDocument {
    AgentSessionDocument {
        session_id: session_id.to_string(),
        external_session_id: Some(format!("external-{session_id}")),
        task_id: Some(task_id.to_string()),
        role: "build".to_string(),
        scenario: Some("build_default".to_string()),
        status: Some("running".to_string()),
        started_at: "2026-02-20T12:00:00Z".to_string(),
        updated_at: Some("2026-02-20T12:00:10Z".to_string()),
        ended_at: None,
        runtime_kind: "opencode".to_string(),
        working_directory: "/tmp/repo".to_string(),
        selected_model: None,
    }
}

pub(crate) static UNIQUE_TEMP_PATH_COUNTER: AtomicU64 = AtomicU64::new(0);

pub(crate) fn unique_temp_path(name: &str) -> PathBuf {
    let nonce = UNIQUE_TEMP_PATH_COUNTER.fetch_add(1, Ordering::Relaxed);
    let pid = std::process::id();
    std::env::temp_dir().join(format!("openducktor-host-app-{name}-{pid}-{nonce}"))
}

pub(crate) fn write_executable_script(path: &Path, script: &str) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut file = fs::File::create(path)?;
    file.write_all(script.as_bytes())?;
    file.sync_all()?;
    drop(file);

    #[cfg(unix)]
    {
        fs::set_permissions(path, Permissions::from_mode(0o755))?;
    }

    #[cfg(not(unix))]
    {
        let status = Command::new("chmod")
            .arg("+x")
            .arg(path)
            .status()
            .map_err(|error| anyhow!("failed running chmod: {error}"))?;
        if !status.success() {
            return Err(anyhow!("chmod +x failed for {}", path.display()));
        }
    }
    Ok(())
}

pub(crate) fn init_git_repo(path: &Path) -> Result<()> {
    fs::create_dir_all(path)?;
    Command::new("git")
        .arg("init")
        .arg(path)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()?;
    Command::new("git")
        .arg("-C")
        .arg(path)
        .arg("config")
        .arg("user.email")
        .arg("odt-test@example.com")
        .status()?;
    Command::new("git")
        .arg("-C")
        .arg(path)
        .arg("config")
        .arg("user.name")
        .arg("OpenDucktor Test")
        .status()?;
    fs::write(path.join("README.md"), "# test\n")?;
    Command::new("git")
        .arg("-C")
        .arg(path)
        .arg("add")
        .arg(".")
        .status()?;
    Command::new("git")
        .arg("-C")
        .arg(path)
        .arg("commit")
        .arg("-m")
        .arg("initial")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()?;
    Command::new("git")
        .arg("-C")
        .arg(path)
        .arg("branch")
        .arg("-M")
        .arg("main")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()?;
    let _ = Command::new("git")
        .arg("-C")
        .arg(path)
        .arg("remote")
        .arg("remove")
        .arg("origin")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    Ok(())
}

pub(crate) fn create_fake_opencode(path: &Path) -> Result<()> {
    let script = r#"#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "opencode-fake 0.0.1"
  exit 0
fi

if [ "$1" = "serve" ]; then
  HOST="127.0.0.1"
  PORT="0"
  while [ $# -gt 0 ]; do
    case "$1" in
      --hostname)
        HOST="$2"
        shift 2
        ;;
      --port)
        PORT="$2"
        shift 2
        ;;
      *)
        shift
        ;;
    esac
  done
  echo "permission requested: git push"
  echo "tool execution heartbeat" >&2
  exec python3 - "$HOST" "$PORT" <<'PY'
import os
import signal
import socket
import sys
import time

host = sys.argv[1]
port = int(sys.argv[2])
delay_ms = int(os.environ.get("OPENDUCKTOR_TEST_STARTUP_DELAY_MS", "0") or "0")
pid_file = os.environ.get("OPENDUCKTOR_TEST_PID_FILE", "")
termination_file = os.environ.get("OPENDUCKTOR_TEST_TERM_FILE", "")

if pid_file:
    try:
        with open(pid_file, "w", encoding="utf-8") as file:
            file.write(str(os.getpid()))
    except Exception:
        pass

if delay_ms > 0:
    time.sleep(delay_ms / 1000.0)

server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
server.bind((host, port))
server.listen(16)

def _stop(*_):
    try:
        if termination_file:
            try:
                with open(termination_file, "w", encoding="utf-8") as file:
                    file.write("terminated")
            except Exception:
                pass
        server.close()
    finally:
        raise SystemExit(0)

signal.signal(signal.SIGTERM, _stop)
signal.signal(signal.SIGINT, _stop)

while True:
    conn, _ = server.accept()
    try:
        conn.recv(1024)
    except Exception:
        pass
    finally:
        conn.close()
PY
fi

echo "unsupported opencode invocation" >&2
exit 1
"#;
    write_executable_script(path, script)
}

pub(crate) fn create_failing_opencode(path: &Path) -> Result<()> {
    let script = r#"#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "opencode-fake 0.0.1"
  exit 0
fi

if [ "$1" = "serve" ]; then
  echo "simulated startup failure" >&2
  exit 42
fi

echo "unsupported opencode invocation" >&2
exit 1
"#;
    write_executable_script(path, script)
}

pub(crate) fn create_orphanable_opencode(path: &Path) -> Result<()> {
    let script = r#"#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "opencode-fake 0.0.1"
  exit 0
fi

if [ "$1" = "serve" ]; then
  while true; do
    sleep 1
  done
fi

echo "unsupported opencode invocation" >&2
exit 1
"#;
    write_executable_script(path, script)
}

pub(crate) fn create_fake_bd(path: &Path) -> Result<()> {
    let script = r#"#!/bin/sh
echo "bd-fake"
"#;
    write_executable_script(path, script)
}

pub(crate) fn set_env_var(key: &str, value: &str) -> EnvVarGuard {
    EnvVarGuard::set(key, value)
}

pub(crate) fn remove_env_var(key: &str) -> EnvVarGuard {
    EnvVarGuard::remove(key)
}

pub(crate) fn prepend_path(path_prefix: &Path) -> EnvVarGuard {
    EnvVarGuard::prepend_path(path_prefix)
}

pub(crate) fn wait_for_path_exists(path: &Path, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if path.exists() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    path.exists()
}

pub(crate) fn process_is_alive(pid: i32) -> bool {
    let output = Command::new("ps")
        .arg("-o")
        .arg("stat=")
        .arg("-p")
        .arg(pid.to_string())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output();

    let Ok(output) = output else {
        return false;
    };
    if !output.status.success() {
        return false;
    }

    let stat = String::from_utf8_lossy(&output.stdout);
    let stat = stat.trim();
    !stat.is_empty() && !stat.starts_with('Z')
}

pub(crate) fn wait_for_process_exit(pid: i32, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if !process_is_alive(pid) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    !process_is_alive(pid)
}

pub(crate) fn wait_for_orphaned_opencode_process(pid: u32, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if is_orphaned_opencode_server_process(pid) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    is_orphaned_opencode_server_process(pid)
}

pub(crate) fn build_service_with_store(
    tasks: Vec<TaskCard>,
    branches: Vec<GitBranch>,
    current_branch: GitCurrentBranch,
    config_store: AppConfigStore,
) -> (AppService, Arc<Mutex<TaskStoreState>>, Arc<Mutex<GitState>>) {
    let task_state = Arc::new(Mutex::new(TaskStoreState {
        ensure_calls: Vec::new(),
        ensure_error: None,
        tasks,
        list_error: None,
        delete_calls: Vec::new(),
        created_inputs: Vec::new(),
        updated_patches: Vec::new(),
        spec_get_calls: Vec::new(),
        spec_set_calls: Vec::new(),
        plan_get_calls: Vec::new(),
        plan_set_calls: Vec::new(),
        metadata_get_calls: Vec::new(),
        qa_append_calls: Vec::new(),
        qa_outcome_calls: Vec::new(),
        latest_qa_report: None,
        agent_sessions: Vec::new(),
        upserted_sessions: Vec::new(),
        cleared_session_roles: Vec::new(),
        clear_agent_sessions_error: None,
        cleared_qa_reports: Vec::new(),
        pull_requests: HashMap::new(),
        direct_merge_records: HashMap::new(),
    }));
    let git_state = Arc::new(Mutex::new(GitState {
        calls: Vec::new(),
        branches,
        current_branch,
        current_branches_by_path: HashMap::new(),
        remove_worktree_error: None,
        delete_local_branch_error: None,
        worktree_status_data: None,
        last_push_remote: None,
        push_branch_result: GitPushResult::Pushed {
            remote: "origin".to_string(),
            branch: "feature/x".to_string(),
            output: "ok".to_string(),
        },
        pull_branch_result: GitPullResult::UpToDate {
            output: "Already up to date.".to_string(),
        },
        commit_all_result: GitCommitAllResult::Committed {
            commit_hash: "deadbeef".to_string(),
            output: "ok".to_string(),
        },
        rebase_branch_result: GitRebaseBranchResult::Rebased {
            output: "rebase completed".to_string(),
        },
        rebase_abort_result: GitRebaseAbortResult::Aborted {
            output: "rebase aborted".to_string(),
        },
        conflict_abort_result: GitConflictAbortResult {
            output: "conflict aborted".to_string(),
        },
        merge_branch_result: GitMergeBranchResult::Merged {
            output: "merge completed".to_string(),
        },
        suggested_squash_commit_message_result: Some("feat: builder change".to_string()),
        is_ancestor_result: false,
        commits_ahead_behind_result: GitAheadBehind {
            ahead: 0,
            behind: 0,
        },
    }));
    let task_store: Arc<dyn TaskStore> = Arc::new(FakeTaskStore {
        state: task_state.clone(),
    });
    let git_port: Arc<dyn GitPort> = Arc::new(FakeGitPort {
        state: git_state.clone(),
    });
    let service = AppService::with_git_port_unrestricted(task_store, config_store, git_port);
    (service, task_state, git_state)
}

pub(crate) fn make_emitter(
    events: Arc<Mutex<Vec<RunEvent>>>,
) -> Arc<dyn Fn(RunEvent) + Send + Sync> {
    Arc::new(move |event| {
        events.lock().expect("events lock poisoned").push(event);
    })
}

pub(crate) fn spawn_sleep_process(seconds: u64) -> std::process::Child {
    Command::new("/bin/sh")
        .arg("-lc")
        .arg(format!("sleep {seconds}"))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn sleep process")
}

pub(crate) fn empty_patch() -> UpdateTaskPatch {
    UpdateTaskPatch {
        title: None,
        description: None,
        notes: None,
        status: None,
        priority: None,
        issue_type: None,
        ai_review_enabled: None,
        labels: None,
        assignee: None,
        parent_id: None,
    }
}
