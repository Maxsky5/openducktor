use super::super::AppService;
use anyhow::{anyhow, Result};
use host_domain::{RunState, RunSummary};
use std::collections::{HashMap, HashSet};

#[derive(Clone)]
struct RunExposureCandidate {
    summary: RunSummary,
    repo_path: String,
    task_id: String,
    worktree_path: String,
}

impl RunExposureCandidate {
    fn from_run(run: &super::super::RunProcess) -> Self {
        Self {
            summary: run.summary.clone(),
            repo_path: run.repo_path.clone(),
            task_id: run.task_id.clone(),
            worktree_path: run.worktree_path.clone(),
        }
    }

    fn requires_live_session_check(&self) -> bool {
        matches!(
            self.summary.state,
            RunState::Starting
                | RunState::Running
                | RunState::Blocked
                | RunState::AwaitingDoneConfirmation
        )
    }
}

struct RunExposurePlan {
    summary: RunSummary,
    external_session_ids: Vec<String>,
    probe_target_resolution: Option<super::super::RuntimeSessionStatusProbeTargetResolution>,
}

impl RunExposurePlan {
    fn without_probe(summary: RunSummary) -> Self {
        Self {
            summary,
            external_session_ids: Vec::new(),
            probe_target_resolution: None,
        }
    }

    fn with_probe(
        summary: RunSummary,
        external_session_ids: Vec<String>,
        probe_target_resolution: super::super::RuntimeSessionStatusProbeTargetResolution,
    ) -> Self {
        Self {
            summary,
            external_session_ids,
            probe_target_resolution: Some(probe_target_resolution),
        }
    }

    fn is_visible(
        &self,
        statuses_by_target: &HashMap<
            super::super::RuntimeSessionStatusProbeTarget,
            super::super::RuntimeSessionStatusProbeOutcome,
        >,
    ) -> Result<bool> {
        let Some(probe_target_resolution) = self.probe_target_resolution.as_ref() else {
            return Ok(true);
        };

        let super::super::RuntimeSessionStatusProbeTargetResolution::Target(probe_target) =
            probe_target_resolution
        else {
            return Ok(true);
        };

        let probe_outcome = statuses_by_target.get(probe_target).ok_or_else(|| {
            anyhow!(
                "Missing cached runtime session status outcome for run {}",
                self.summary.run_id
            )
        })?;

        match probe_outcome {
            super::super::RuntimeSessionStatusProbeOutcome::Snapshot(snapshot) => {
                if snapshot.has_no_live_sessions() {
                    return Ok(false);
                }

                Ok(self
                    .external_session_ids
                    .iter()
                    .any(|external_session_id| snapshot.has_live_session(external_session_id)))
            }
            super::super::RuntimeSessionStatusProbeOutcome::Unsupported => Ok(true),
            super::super::RuntimeSessionStatusProbeOutcome::ActionableError(_) => Ok(false),
        }
    }
}

impl AppService {
    pub fn runs_list(&self, repo_path: Option<&str>) -> Result<Vec<RunSummary>> {
        let repo_key_filter = repo_path
            .map(|path| self.resolve_authorized_repo_path(path))
            .transpose()?;
        let allowlisted_repo_keys: Option<HashSet<String>> =
            if repo_key_filter.is_none() && self.enforce_repo_allowlist {
                Some(
                    self.config_store
                        .list_workspaces()?
                        .into_iter()
                        .map(|workspace| Self::repo_key(workspace.repo_path.as_str()))
                        .collect::<HashSet<_>>(),
                )
            } else {
                None
            };
        let runs = self
            .runs
            .lock()
            .map_err(|_| anyhow!("Run state lock poisoned"))?;
        let run_candidates = runs
            .values()
            .filter(|run| {
                if let Some(path_key) = repo_key_filter.as_deref() {
                    Self::repo_key(run.repo_path.as_str()) == path_key
                } else if let Some(allowlist) = allowlisted_repo_keys.as_ref() {
                    let run_repo_key = Self::repo_key(run.repo_path.as_str());
                    allowlist.contains(&run_repo_key)
                } else {
                    true
                }
            })
            .map(RunExposureCandidate::from_run)
            .collect::<Vec<_>>();
        drop(runs);

        let (exposure_plans, probe_targets) = self.build_run_exposure_plans(run_candidates)?;
        let statuses_by_target =
            self.load_cached_runtime_session_statuses_for_targets(&probe_targets)?;
        let mut list = self.visible_run_summaries(exposure_plans, &statuses_by_target)?;

        list.sort_by(|a, b| b.started_at.cmp(&a.started_at));
        Ok(list)
    }

    fn build_run_exposure_plans(
        &self,
        run_candidates: Vec<RunExposureCandidate>,
    ) -> Result<(
        Vec<RunExposurePlan>,
        Vec<super::super::RuntimeSessionStatusProbeTarget>,
    )> {
        let mut sessions_by_repo_task = HashMap::new();
        let mut exposure_plans = Vec::with_capacity(run_candidates.len());
        let mut probe_targets = Vec::new();

        for run in run_candidates {
            if !run.requires_live_session_check() {
                exposure_plans.push(RunExposurePlan::without_probe(run.summary));
                continue;
            }

            let sessions = self.sessions_for_run_candidate(&run, &mut sessions_by_repo_task)?;
            let external_session_ids = collect_build_external_session_ids_for_run(&run, sessions);

            if external_session_ids.is_empty() {
                exposure_plans.push(RunExposurePlan::without_probe(run.summary));
                continue;
            }

            let probe_target_resolution = self
                .runtime_registry
                .runtime(&run.summary.runtime_kind)?
                .session_status_probe_target(
                    &run.summary.runtime_route,
                    run.worktree_path.as_str(),
                )?;
            if let super::super::RuntimeSessionStatusProbeTargetResolution::Target(probe_target) =
                &probe_target_resolution
            {
                probe_targets.push(probe_target.clone());
            }
            exposure_plans.push(RunExposurePlan::with_probe(
                run.summary,
                external_session_ids,
                probe_target_resolution,
            ));
        }

        Ok((exposure_plans, probe_targets))
    }

    fn sessions_for_run_candidate<'a>(
        &self,
        run: &RunExposureCandidate,
        sessions_by_repo_task: &'a mut HashMap<String, Vec<host_domain::AgentSessionDocument>>,
    ) -> Result<&'a [host_domain::AgentSessionDocument]> {
        let session_cache_key = format!("{}::{}", run.repo_path, run.task_id);
        if !sessions_by_repo_task.contains_key(session_cache_key.as_str()) {
            let sessions =
                self.agent_sessions_list(run.repo_path.as_str(), run.task_id.as_str())?;
            sessions_by_repo_task.insert(session_cache_key.clone(), sessions);
        }

        sessions_by_repo_task
            .get(session_cache_key.as_str())
            .map(Vec::as_slice)
            .ok_or_else(|| anyhow!("Missing cached agent sessions for {}", session_cache_key))
    }

    fn visible_run_summaries(
        &self,
        exposure_plans: Vec<RunExposurePlan>,
        statuses_by_target: &HashMap<
            super::super::RuntimeSessionStatusProbeTarget,
            super::super::RuntimeSessionStatusProbeOutcome,
        >,
    ) -> Result<Vec<RunSummary>> {
        let mut list = Vec::new();
        for plan in exposure_plans {
            if plan.is_visible(statuses_by_target)? {
                list.push(plan.summary);
            }
        }
        Ok(list)
    }
}

fn collect_build_external_session_ids_for_run(
    run: &RunExposureCandidate,
    sessions: &[host_domain::AgentSessionDocument],
) -> Vec<String> {
    sessions
        .iter()
        .filter(|session| session.role.trim() == "build")
        .filter(|session| session.runtime_kind.trim() == run.summary.runtime_kind.as_str())
        .filter(|session| {
            super::super::task_workflow::normalize_path_for_comparison(
                session.working_directory.as_str(),
            ) == super::super::task_workflow::normalize_path_for_comparison(
                run.worktree_path.as_str(),
            )
        })
        .filter_map(|session| {
            session
                .external_session_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use crate::app_service::test_support::{build_service_with_state, make_task};
    use crate::app_service::RunProcess;
    use anyhow::Result;
    use host_domain::{
        AgentRuntimeKind, AgentSessionDocument, RunSummary, RuntimeRoute, TaskStatus,
    };
    use host_infra_system::RepoConfig;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::time::{Duration, Instant};

    fn spawn_opencode_session_status_server(
        response_body: &'static str,
    ) -> Result<(u16, std::thread::JoinHandle<()>)> {
        let listener = TcpListener::bind("127.0.0.1:0")?;
        let port = listener.local_addr()?.port();
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            response_body.len(),
            response_body
        );
        let handle = std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut request_buffer = [0_u8; 4096];
                let _ = stream.read(&mut request_buffer);
                let _ = stream.write_all(response.as_bytes());
                let _ = stream.flush();
            }
        });
        Ok((port, handle))
    }

    fn spawn_delayed_opencode_session_status_server(
        response_body: String,
        delay: Duration,
    ) -> Result<(u16, std::thread::JoinHandle<()>)> {
        let listener = TcpListener::bind("127.0.0.1:0")?;
        let port = listener.local_addr()?.port();
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            response_body.len(),
            response_body
        );
        let handle = std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut request_buffer = [0_u8; 4096];
                let _ = stream.read(&mut request_buffer);
                if !delay.is_zero() {
                    std::thread::sleep(delay);
                }
                let _ = stream.write_all(response.as_bytes());
                let _ = stream.flush();
            }
        });
        Ok((port, handle))
    }

    #[test]
    fn module_runs_list_is_empty_on_fresh_service() {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);

        let runs = service
            .runs_list(None)
            .expect("runs list should be available");

        assert!(runs.is_empty());
    }

    #[test]
    fn module_runs_list_filters_stale_build_runs_without_live_runtime_session() -> Result<()> {
        let (service, task_state, _git_state) =
            build_service_with_state(vec![make_task("task-1", "task", TaskStatus::InProgress)]);
        let (port, server_handle) =
            spawn_opencode_session_status_server(r#"{"external-build-session":{"type":"idle"}}"#)?;

        task_state
            .lock()
            .expect("task store lock poisoned")
            .agent_sessions = vec![AgentSessionDocument {
            session_id: "build-session".to_string(),
            external_session_id: Some("external-build-session".to_string()),
            role: "build".to_string(),
            scenario: "build_implementation_start".to_string(),
            started_at: "2026-03-17T11:00:00Z".to_string(),
            runtime_kind: "opencode".to_string(),
            working_directory: "/tmp/repo/worktree".to_string(),
            selected_model: None,
        }];

        service
            .runs
            .lock()
            .expect("run state lock poisoned")
            .insert(
                "run-1".to_string(),
                RunProcess {
                    summary: RunSummary {
                        run_id: "run-1".to_string(),
                        runtime_kind: AgentRuntimeKind::opencode(),
                        runtime_route: host_domain::RuntimeRoute::LocalHttp {
                            endpoint: format!("http://127.0.0.1:{port}"),
                        },
                        repo_path: "/tmp/repo".to_string(),
                        task_id: "task-1".to_string(),
                        branch: "odt/task-1".to_string(),
                        worktree_path: "/tmp/repo/worktree".to_string(),
                        port: Some(port),
                        state: host_domain::RunState::Running,
                        last_message: None,
                        started_at: "2026-03-17T11:00:00Z".to_string(),
                    },
                    child: None,
                    _runtime_process_guard: None,
                    repo_path: "/tmp/repo".to_string(),
                    task_id: "task-1".to_string(),
                    worktree_path: "/tmp/repo/worktree".to_string(),
                    repo_config: RepoConfig::default(),
                },
            );

        let runs = service.runs_list(Some("/tmp/repo"))?;
        server_handle
            .join()
            .expect("status server thread should finish");

        assert!(runs.is_empty());
        Ok(())
    }

    #[test]
    fn module_runs_list_keeps_stdio_build_runs_visible_without_http_probe() -> Result<()> {
        let (service, task_state, _git_state) =
            build_service_with_state(vec![make_task("task-1", "task", TaskStatus::InProgress)]);

        task_state
            .lock()
            .expect("task store lock poisoned")
            .agent_sessions = vec![AgentSessionDocument {
            session_id: "build-session".to_string(),
            external_session_id: Some("external-build-session".to_string()),
            role: "build".to_string(),
            scenario: "build_implementation_start".to_string(),
            started_at: "2026-03-17T11:00:00Z".to_string(),
            runtime_kind: "opencode".to_string(),
            working_directory: "/tmp/repo/worktree".to_string(),
            selected_model: None,
        }];

        service
            .runs
            .lock()
            .expect("run state lock poisoned")
            .insert(
                "run-1".to_string(),
                RunProcess {
                    summary: RunSummary {
                        run_id: "run-1".to_string(),
                        runtime_kind: AgentRuntimeKind::opencode(),
                        runtime_route: RuntimeRoute::Stdio,
                        repo_path: "/tmp/repo".to_string(),
                        task_id: "task-1".to_string(),
                        branch: "odt/task-1".to_string(),
                        worktree_path: "/tmp/repo/worktree".to_string(),
                        port: None,
                        state: host_domain::RunState::Running,
                        last_message: None,
                        started_at: "2026-03-17T11:00:00Z".to_string(),
                    },
                    child: None,
                    _runtime_process_guard: None,
                    repo_path: "/tmp/repo".to_string(),
                    task_id: "task-1".to_string(),
                    worktree_path: "/tmp/repo/worktree".to_string(),
                    repo_config: RepoConfig::default(),
                },
            );

        let runs = service.runs_list(Some("/tmp/repo"))?;

        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].run_id, "run-1");
        assert_eq!(runs[0].runtime_route, RuntimeRoute::Stdio);
        Ok(())
    }

    #[test]
    fn module_runs_list_treats_unreachable_status_endpoint_as_stale_run() -> Result<()> {
        let (service, task_state, _git_state) =
            build_service_with_state(vec![make_task("task-1", "task", TaskStatus::InProgress)]);
        let listener = TcpListener::bind("127.0.0.1:0")?;
        let port = listener.local_addr()?.port();
        drop(listener);

        task_state
            .lock()
            .expect("task store lock poisoned")
            .agent_sessions = vec![AgentSessionDocument {
            session_id: "build-session".to_string(),
            external_session_id: Some("external-build-session".to_string()),
            role: "build".to_string(),
            scenario: "build_implementation_start".to_string(),
            started_at: "2026-03-17T11:00:00Z".to_string(),
            runtime_kind: "opencode".to_string(),
            working_directory: "/tmp/repo/worktree".to_string(),
            selected_model: None,
        }];

        service
            .runs
            .lock()
            .expect("run state lock poisoned")
            .insert(
                "run-1".to_string(),
                RunProcess {
                    summary: RunSummary {
                        run_id: "run-1".to_string(),
                        runtime_kind: AgentRuntimeKind::opencode(),
                        runtime_route: host_domain::RuntimeRoute::LocalHttp {
                            endpoint: format!("http://127.0.0.1:{port}"),
                        },
                        repo_path: "/tmp/repo".to_string(),
                        task_id: "task-1".to_string(),
                        branch: "odt/task-1".to_string(),
                        worktree_path: "/tmp/repo/worktree".to_string(),
                        port: Some(port),
                        state: host_domain::RunState::Running,
                        last_message: None,
                        started_at: "2026-03-17T11:00:00Z".to_string(),
                    },
                    child: None,
                    _runtime_process_guard: None,
                    repo_path: "/tmp/repo".to_string(),
                    task_id: "task-1".to_string(),
                    worktree_path: "/tmp/repo/worktree".to_string(),
                    repo_config: RepoConfig::default(),
                },
            );

        let runs = service.runs_list(Some("/tmp/repo"))?;

        assert!(runs.is_empty());
        Ok(())
    }

    #[test]
    fn module_runs_list_batches_unique_slow_status_probes() -> Result<()> {
        let tasks = (0..6)
            .map(|index| {
                make_task(
                    format!("task-{index}").as_str(),
                    "task",
                    TaskStatus::InProgress,
                )
            })
            .collect::<Vec<_>>();
        let (service, task_state, _git_state) = build_service_with_state(tasks);
        let mut server_handles = Vec::new();
        let mut sessions = Vec::new();

        for index in 0..6 {
            let (port, server_handle) = spawn_delayed_opencode_session_status_server(
                format!(r#"{{"external-build-session-{index}":{{"type":"busy"}}}}"#),
                Duration::from_millis(300),
            )?;
            server_handles.push(server_handle);
            sessions.push(AgentSessionDocument {
                session_id: format!("build-session-{index}"),
                external_session_id: Some(format!("external-build-session-{index}")),
                role: "build".to_string(),
                scenario: "build_implementation_start".to_string(),
                started_at: "2026-03-17T11:00:00Z".to_string(),
                runtime_kind: "opencode".to_string(),
                working_directory: format!("/tmp/repo/worktree-{index}"),
                selected_model: None,
            });

            service
                .runs
                .lock()
                .expect("run state lock poisoned")
                .insert(
                    format!("run-{index}"),
                    RunProcess {
                        summary: RunSummary {
                            run_id: format!("run-{index}"),
                            runtime_kind: AgentRuntimeKind::opencode(),
                            runtime_route: host_domain::RuntimeRoute::LocalHttp {
                                endpoint: format!("http://127.0.0.1:{port}"),
                            },
                            repo_path: "/tmp/repo".to_string(),
                            task_id: format!("task-{index}"),
                            branch: format!("odt/task-{index}"),
                            worktree_path: format!("/tmp/repo/worktree-{index}"),
                            port: Some(port),
                            state: host_domain::RunState::Running,
                            last_message: None,
                            started_at: format!("2026-03-17T11:00:0{index}Z"),
                        },
                        child: None,
                        _runtime_process_guard: None,
                        repo_path: "/tmp/repo".to_string(),
                        task_id: format!("task-{index}"),
                        worktree_path: format!("/tmp/repo/worktree-{index}"),
                        repo_config: RepoConfig::default(),
                    },
                );
        }

        task_state
            .lock()
            .expect("task store lock poisoned")
            .agent_sessions = sessions;

        let started_at = Instant::now();
        let runs = service.runs_list(Some("/tmp/repo"))?;
        let elapsed = started_at.elapsed();

        for server_handle in server_handles {
            server_handle
                .join()
                .expect("status server thread should finish");
        }

        assert_eq!(runs.len(), 6);
        assert!(
            elapsed < Duration::from_millis(1200),
            "expected bounded parallel latency, observed {elapsed:?}"
        );
        Ok(())
    }
}
