use anyhow::{anyhow, Context, Result};
use host_domain::{
    now_rfc3339, BeadsCheck, CreateTaskInput, RunEvent, RunState, RunSummary, RuntimeCheck,
    SpecDocument, SystemCheck, TaskCard, TaskPhase, TaskStatus, TaskStore, UpdateTaskPatch,
    WorkspaceRecord,
};
use host_infra_system::{
    build_branch_name, command_exists, pick_free_port, remove_worktree, resolve_central_beads_dir,
    run_command, run_command_allow_failure, version_command, AppConfigStore, RepoConfig,
};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use uuid::Uuid;

pub type RunEmitter = Arc<dyn Fn(RunEvent) + Send + Sync + 'static>;

#[derive(Clone)]
pub struct AppService {
    task_store: Arc<dyn TaskStore>,
    config_store: AppConfigStore,
    runs: Arc<Mutex<HashMap<String, RunProcess>>>,
    initialized_repos: Arc<Mutex<HashSet<String>>>,
}

struct RunProcess {
    summary: RunSummary,
    child: Child,
    repo_path: String,
    task_id: String,
    worktree_path: String,
    repo_config: RepoConfig,
}

impl AppService {
    pub fn new(task_store: Arc<dyn TaskStore>, config_store: AppConfigStore) -> Self {
        Self {
            task_store,
            config_store,
            runs: Arc::new(Mutex::new(HashMap::new())),
            initialized_repos: Arc::new(Mutex::new(HashSet::new())),
        }
    }

    fn repo_key(repo_path: &str) -> String {
        fs::canonicalize(repo_path)
            .unwrap_or_else(|_| Path::new(repo_path).to_path_buf())
            .to_string_lossy()
            .to_string()
    }

    fn ensure_repo_initialized(&self, repo_path: &str) -> Result<()> {
        let repo_key = Self::repo_key(repo_path);
        {
            let cache = self
                .initialized_repos
                .lock()
                .map_err(|_| anyhow!("Initialized repo cache lock poisoned"))?;
            if cache.contains(&repo_key) {
                return Ok(());
            }
        }

        self.task_store
            .ensure_repo_initialized(Path::new(repo_path))
            .with_context(|| format!("Failed to initialize task store for {repo_path}"))?;

        let mut cache = self
            .initialized_repos
            .lock()
            .map_err(|_| anyhow!("Initialized repo cache lock poisoned"))?;
        cache.insert(repo_key);

        Ok(())
    }

    pub fn runtime_check(&self) -> Result<RuntimeCheck> {
        let git_ok = command_exists("git");
        let opencode_ok = command_exists("opencode");

        let mut errors = Vec::new();
        if !git_ok {
            errors.push("git not found in PATH".to_string());
        }
        if !opencode_ok {
            errors.push("opencode not found in PATH".to_string());
        }

        Ok(RuntimeCheck {
            git_ok,
            git_version: version_command("git", &["--version"]),
            opencode_ok,
            opencode_version: version_command("opencode", &["--version"]),
            errors,
        })
    }

    pub fn beads_check(&self, repo_path: &str) -> Result<BeadsCheck> {
        if !command_exists("bd") {
            return Ok(BeadsCheck {
                beads_ok: false,
                beads_path: None,
                beads_error: Some("bd not found in PATH".to_string()),
            });
        }

        let repo = Path::new(repo_path);
        match resolve_central_beads_dir(repo) {
            Ok(path) => {
                let path_string = path.to_string_lossy().to_string();
                match self.ensure_repo_initialized(repo_path) {
                    Ok(()) => Ok(BeadsCheck {
                        beads_ok: true,
                        beads_path: Some(path_string),
                        beads_error: None,
                    }),
                    Err(error) => Ok(BeadsCheck {
                        beads_ok: false,
                        beads_path: Some(path_string),
                        beads_error: Some(error.to_string()),
                    }),
                }
            }
            Err(error) => Ok(BeadsCheck {
                beads_ok: false,
                beads_path: None,
                beads_error: Some(error.to_string()),
            }),
        }
    }

    pub fn system_check(&self, repo_path: &str) -> Result<SystemCheck> {
        let runtime = self.runtime_check()?;
        let beads = self.beads_check(repo_path)?;
        let mut errors = runtime.errors;
        if let Some(beads_error) = beads.beads_error.as_deref() {
            errors.push(format!("beads: {beads_error}"));
        }

        Ok(SystemCheck {
            git_ok: runtime.git_ok,
            git_version: runtime.git_version,
            opencode_ok: runtime.opencode_ok,
            opencode_version: runtime.opencode_version,
            beads_ok: beads.beads_ok,
            beads_path: beads.beads_path,
            beads_error: beads.beads_error,
            errors,
        })
    }

    pub fn workspace_list(&self) -> Result<Vec<WorkspaceRecord>> {
        self.config_store.list_workspaces()
    }

    pub fn workspace_add(&self, repo_path: &str) -> Result<WorkspaceRecord> {
        let workspace = self.config_store.add_workspace(repo_path)?;
        self.ensure_repo_initialized(repo_path)?;
        Ok(workspace)
    }

    pub fn workspace_select(&self, repo_path: &str) -> Result<WorkspaceRecord> {
        let workspace = self.config_store.select_workspace(repo_path)?;
        self.ensure_repo_initialized(repo_path)?;
        Ok(workspace)
    }

    pub fn workspace_update_repo_config(
        &self,
        repo_path: &str,
        config: RepoConfig,
    ) -> Result<WorkspaceRecord> {
        self.config_store.update_repo_config(repo_path, config)
    }

    pub fn workspace_set_trusted_hooks(
        &self,
        repo_path: &str,
        trusted: bool,
    ) -> Result<WorkspaceRecord> {
        self.config_store.set_repo_trust_hooks(repo_path, trusted)
    }

    pub fn tasks_list(&self, repo_path: &str) -> Result<Vec<TaskCard>> {
        self.task_store.list_tasks(Path::new(repo_path))
    }

    pub fn task_create(&self, repo_path: &str, input: CreateTaskInput) -> Result<TaskCard> {
        self.task_store.create_task(Path::new(repo_path), input)
    }

    pub fn task_update(
        &self,
        repo_path: &str,
        task_id: &str,
        patch: UpdateTaskPatch,
    ) -> Result<TaskCard> {
        self.task_store
            .update_task(Path::new(repo_path), task_id, patch)
    }

    pub fn task_set_phase(
        &self,
        repo_path: &str,
        task_id: &str,
        phase: TaskPhase,
        reason: Option<&str>,
    ) -> Result<TaskCard> {
        self.task_store
            .set_phase(Path::new(repo_path), task_id, phase, reason)
    }

    pub fn spec_get(&self, repo_path: &str, task_id: &str) -> Result<SpecDocument> {
        self.task_store
            .get_spec_markdown(Path::new(repo_path), task_id)
    }

    pub fn spec_set_markdown(
        &self,
        repo_path: &str,
        task_id: &str,
        markdown: &str,
    ) -> Result<SpecDocument> {
        self.task_store
            .set_spec_markdown(Path::new(repo_path), task_id, markdown)
    }

    pub fn runs_list(&self, repo_path: Option<&str>) -> Result<Vec<RunSummary>> {
        let runs = self
            .runs
            .lock()
            .map_err(|_| anyhow!("Run state lock poisoned"))?;

        let mut list = runs
            .values()
            .filter(|run| {
                if let Some(path) = repo_path {
                    run.repo_path == path
                } else {
                    true
                }
            })
            .map(|run| run.summary.clone())
            .collect::<Vec<_>>();

        list.sort_by(|a, b| b.started_at.cmp(&a.started_at));
        Ok(list)
    }

    pub fn delegate_start(
        &self,
        repo_path: &str,
        task_id: &str,
        emitter: RunEmitter,
    ) -> Result<RunSummary> {
        let repo_config = self.config_store.repo_config(repo_path)?;

        let worktree_base = repo_config.worktree_base_path.clone().ok_or_else(|| {
            anyhow!(
                "Delegation blocked: configure repos.{repo_path}.worktreeBasePath in {}",
                self.config_store.path().display()
            )
        })?;

        if (!repo_config.hooks.pre_start.is_empty() || !repo_config.hooks.post_complete.is_empty())
            && !repo_config.trusted_hooks
        {
            return Err(anyhow!(
                "Hooks are configured but not trusted for {repo_path}. Confirm trust first."
            ));
        }

        let task = self
            .task_store
            .list_tasks(Path::new(repo_path))?
            .into_iter()
            .find(|entry| entry.id == task_id)
            .ok_or_else(|| anyhow!("Task not found: {task_id}"))?;

        let branch = build_branch_name(&repo_config.branch_prefix, task_id, &task.title);

        let worktree_dir = Path::new(&worktree_base).join(task_id);
        fs::create_dir_all(Path::new(&worktree_base)).with_context(|| {
            format!(
                "Failed creating worktree base directory {}",
                Path::new(&worktree_base).display()
            )
        })?;

        if worktree_dir.exists() {
            return Err(anyhow!(
                "Worktree path already exists for task {}: {}",
                task_id,
                worktree_dir.display()
            ));
        }

        let repo_path_ref = Path::new(repo_path);
        run_command(
            "git",
            &[
                "worktree",
                "add",
                worktree_dir
                    .to_str()
                    .ok_or_else(|| anyhow!("Invalid worktree path"))?,
                "-b",
                &branch,
            ],
            Some(repo_path_ref),
        )?;

        for hook in &repo_config.hooks.pre_start {
            let (ok, _stdout, stderr) =
                run_command_allow_failure("sh", &["-lc", hook], Some(worktree_dir.as_path()))?;
            if !ok {
                let _ = self.task_store.update_task(
                    repo_path_ref,
                    task_id,
                    UpdateTaskPatch {
                        title: None,
                        description: None,
                        status: Some(TaskStatus::Blocked),
                    },
                );
                let _ = self.task_store.set_phase(
                    repo_path_ref,
                    task_id,
                    TaskPhase::BlockedNeedsInput,
                    Some("Pre-start hook failed"),
                );
                return Err(anyhow!("Pre-start hook failed: {hook}\n{stderr}"));
            }
        }

        let port = pick_free_port()?;

        let mut child = Command::new("opencode")
            .arg("serve")
            .arg("--port")
            .arg(port.to_string())
            .current_dir(worktree_dir.as_path())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .context("Failed to spawn opencode serve")?;

        self.task_store.update_task(
            repo_path_ref,
            task_id,
            UpdateTaskPatch {
                title: None,
                description: None,
                status: Some(TaskStatus::InProgress),
            },
        )?;
        self.task_store.set_phase(
            repo_path_ref,
            task_id,
            TaskPhase::InProgress,
            Some("Builder delegated"),
        )?;

        let run_id = format!("run-{}", Uuid::new_v4().simple());

        let summary = RunSummary {
            run_id: run_id.clone(),
            repo_path: repo_path.to_string(),
            task_id: task_id.to_string(),
            branch,
            worktree_path: worktree_dir
                .to_str()
                .ok_or_else(|| anyhow!("Invalid worktree path"))?
                .to_string(),
            port,
            state: RunState::Running,
            last_message: Some("Opencode server running".to_string()),
            started_at: now_rfc3339(),
        };

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        let process = RunProcess {
            summary: summary.clone(),
            child,
            repo_path: repo_path.to_string(),
            task_id: task_id.to_string(),
            worktree_path: worktree_dir
                .to_str()
                .ok_or_else(|| anyhow!("Invalid worktree path"))?
                .to_string(),
            repo_config,
        };

        self.runs
            .lock()
            .map_err(|_| anyhow!("Run state lock poisoned"))?
            .insert(run_id.clone(), process);

        emit_event(
            &emitter,
            RunEvent::RunStarted {
                run_id: run_id.clone(),
                message: format!("Delegated task {} on branch {}", task_id, summary.branch),
                timestamp: now_rfc3339(),
            },
        );

        if let Some(stdout) = stdout {
            spawn_output_forwarder(run_id.clone(), "stdout", stdout, emitter.clone());
        }
        if let Some(stderr) = stderr {
            spawn_output_forwarder(run_id.clone(), "stderr", stderr, emitter.clone());
        }

        Ok(summary)
    }

    pub fn delegate_respond(
        &self,
        run_id: &str,
        action: &str,
        payload: Option<&str>,
        emitter: RunEmitter,
    ) -> Result<bool> {
        let mut runs = self
            .runs
            .lock()
            .map_err(|_| anyhow!("Run state lock poisoned"))?;
        let run = runs
            .get_mut(run_id)
            .ok_or_else(|| anyhow!("Run not found: {run_id}"))?;

        match action {
            "approve" => {
                if payload
                    .map(|entry| entry.contains("git push"))
                    .unwrap_or(false)
                {
                    run.summary.last_message =
                        Some("Approved sensitive command: git push".to_string());
                } else {
                    run.summary.last_message = Some("Approval received".to_string());
                }
                run.summary.state = RunState::Running;
            }
            "deny" => {
                run.summary.last_message = Some("Command denied by user".to_string());
                run.summary.state = RunState::Blocked;
                let repo_path = Path::new(&run.repo_path);
                let _ = self.task_store.update_task(
                    repo_path,
                    &run.task_id,
                    UpdateTaskPatch {
                        title: None,
                        description: None,
                        status: Some(TaskStatus::Blocked),
                    },
                );
                let _ = self.task_store.set_phase(
                    repo_path,
                    &run.task_id,
                    TaskPhase::BlockedNeedsInput,
                    Some("User denied command"),
                );
            }
            "message" => {
                run.summary.last_message = payload.map(|entry| entry.to_string());
            }
            other => return Err(anyhow!("Unknown delegate response action: {other}")),
        }

        emit_event(
            &emitter,
            RunEvent::AgentThought {
                run_id: run_id.to_string(),
                message: run
                    .summary
                    .last_message
                    .clone()
                    .unwrap_or_else(|| "User response applied".to_string()),
                timestamp: now_rfc3339(),
            },
        );

        Ok(true)
    }

    pub fn delegate_stop(&self, run_id: &str, emitter: RunEmitter) -> Result<bool> {
        let mut runs = self
            .runs
            .lock()
            .map_err(|_| anyhow!("Run state lock poisoned"))?;
        let run = runs
            .get_mut(run_id)
            .ok_or_else(|| anyhow!("Run not found: {run_id}"))?;

        let _ = run.child.kill();
        run.summary.state = RunState::Stopped;
        run.summary.last_message = Some("Run stopped by user".to_string());

        emit_event(
            &emitter,
            RunEvent::RunFinished {
                run_id: run_id.to_string(),
                message: "Run stopped".to_string(),
                timestamp: now_rfc3339(),
                success: false,
            },
        );

        Ok(true)
    }

    pub fn delegate_cleanup(&self, run_id: &str, mode: &str, emitter: RunEmitter) -> Result<bool> {
        let mut runs = self
            .runs
            .lock()
            .map_err(|_| anyhow!("Run state lock poisoned"))?;
        let mut run = runs
            .remove(run_id)
            .ok_or_else(|| anyhow!("Run not found: {run_id}"))?;

        let _ = run.child.kill();

        match mode {
            "failure" => {
                self.task_store.update_task(
                    Path::new(&run.repo_path),
                    &run.task_id,
                    UpdateTaskPatch {
                        title: None,
                        description: None,
                        status: Some(TaskStatus::Blocked),
                    },
                )?;
                self.task_store.set_phase(
                    Path::new(&run.repo_path),
                    &run.task_id,
                    TaskPhase::BlockedNeedsInput,
                    Some("Run failed; worktree retained"),
                )?;

                run.summary.state = RunState::Failed;
                emit_event(
                    &emitter,
                    RunEvent::RunFinished {
                        run_id: run_id.to_string(),
                        message: "Run marked as failed; worktree retained".to_string(),
                        timestamp: now_rfc3339(),
                        success: false,
                    },
                );
                return Ok(true);
            }
            "success" => {}
            other => return Err(anyhow!("Unknown cleanup mode: {other}")),
        }

        for hook in &run.repo_config.hooks.post_complete {
            emit_event(
                &emitter,
                RunEvent::PostHookStarted {
                    run_id: run_id.to_string(),
                    message: format!("Running post-complete hook: {hook}"),
                    timestamp: now_rfc3339(),
                },
            );

            let (ok, _stdout, stderr) = run_command_allow_failure(
                "sh",
                &["-lc", hook],
                Some(Path::new(&run.worktree_path)),
            )?;

            if !ok {
                self.task_store.update_task(
                    Path::new(&run.repo_path),
                    &run.task_id,
                    UpdateTaskPatch {
                        title: None,
                        description: None,
                        status: Some(TaskStatus::Blocked),
                    },
                )?;
                self.task_store.set_phase(
                    Path::new(&run.repo_path),
                    &run.task_id,
                    TaskPhase::BlockedNeedsInput,
                    Some("Post-complete hook failed"),
                )?;

                emit_event(
                    &emitter,
                    RunEvent::PostHookFailed {
                        run_id: run_id.to_string(),
                        message: format!("Post-complete hook failed: {hook}\n{stderr}"),
                        timestamp: now_rfc3339(),
                    },
                );

                return Ok(false);
            }
        }

        emit_event(
            &emitter,
            RunEvent::ReadyForManualDoneConfirmation {
                run_id: run_id.to_string(),
                message: "Post-complete hooks passed. Finalizing task as Done.".to_string(),
                timestamp: now_rfc3339(),
            },
        );

        self.task_store.update_task(
            Path::new(&run.repo_path),
            &run.task_id,
            UpdateTaskPatch {
                title: None,
                description: None,
                status: Some(TaskStatus::Closed),
            },
        )?;
        self.task_store.set_phase(
            Path::new(&run.repo_path),
            &run.task_id,
            TaskPhase::Done,
            Some("Manual done confirmation completed"),
        )?;

        remove_worktree(Path::new(&run.repo_path), Path::new(&run.worktree_path))?;

        emit_event(
            &emitter,
            RunEvent::RunFinished {
                run_id: run_id.to_string(),
                message: "Run completed; worktree removed".to_string(),
                timestamp: now_rfc3339(),
                success: true,
            },
        );

        Ok(true)
    }
}

fn emit_event(emitter: &RunEmitter, event: RunEvent) {
    (emitter)(event);
}

fn spawn_output_forwarder(
    run_id: String,
    source: &'static str,
    stream: impl std::io::Read + Send + 'static,
    emitter: RunEmitter,
) {
    std::thread::spawn(move || {
        let reader = BufReader::new(stream);
        for line in reader.lines() {
            let Ok(line) = line else {
                continue;
            };
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }

            if trimmed.contains("permission") || trimmed.contains("git push") {
                emit_event(
                    &emitter,
                    RunEvent::PermissionRequired {
                        run_id: run_id.clone(),
                        message: format!("{}: {}", source, trimmed),
                        command: if trimmed.contains("git push") {
                            Some("git push".to_string())
                        } else {
                            None
                        },
                        timestamp: now_rfc3339(),
                    },
                );
            } else {
                emit_event(
                    &emitter,
                    RunEvent::ToolExecution {
                        run_id: run_id.clone(),
                        message: format!("{}: {}", source, trimmed),
                        timestamp: now_rfc3339(),
                    },
                );
            }
        }
    });
}
