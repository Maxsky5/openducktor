use super::super::{emit_event, AppService, RunEmitter};
use anyhow::{anyhow, Result};
use host_domain::{
    now_rfc3339, AgentRuntimeKind, AgentSessionDocument, AgentSessionStopRequest, RunEvent,
    RunState, RuntimeRoute,
};
use std::path::{Component, PathBuf};

struct BuildRunStopContext {
    runtime_kind: AgentRuntimeKind,
    runtime_route: RuntimeRoute,
    repo_path: String,
    task_id: String,
    worktree_path: String,
}

struct SessionStopResolution {
    session: AgentSessionDocument,
    runtime_route: RuntimeRoute,
    associated_build_run_id: Option<String>,
}

struct LiveSessionStopRouteResolver<'a> {
    service: &'a AppService,
    repo_path: &'a str,
    request: &'a AgentSessionStopRequest,
}

impl AppService {
    pub fn build_stop(&self, run_id: &str, emitter: RunEmitter) -> Result<bool> {
        let stop_context = {
            let runs = self
                .runs
                .lock()
                .map_err(|_| anyhow!("Run state lock poisoned"))?;
            let run = runs
                .get(run_id)
                .ok_or_else(|| anyhow!("Run not found: {run_id}"))?;
            BuildRunStopContext {
                runtime_kind: run.summary.runtime_kind.clone(),
                runtime_route: run.summary.runtime_route.clone(),
                repo_path: run.repo_path.clone(),
                task_id: run.task_id.clone(),
                worktree_path: run.worktree_path.clone(),
            }
        };
        self.abort_build_session_for_stop(&stop_context)?;
        self.mark_run_stopped_after_session_stop(run_id, emitter)?;
        Ok(true)
    }

    pub fn agent_session_stop(
        &self,
        request: AgentSessionStopRequest,
        emitter: RunEmitter,
    ) -> Result<bool> {
        let repo_path = self.resolve_task_repo_path(&request.repo_path)?;
        let resolution = self.resolve_session_stop_resolution(repo_path.as_str(), &request)?;

        self.stop_persisted_session(
            &request.runtime_kind,
            &resolution.runtime_route,
            &resolution.session,
        )?;

        if let Some(run_id) = resolution.associated_build_run_id.as_deref() {
            self.mark_run_stopped_after_session_stop(run_id, emitter)?;
        }

        Ok(true)
    }

    fn mark_run_stopped_after_session_stop(&self, run_id: &str, emitter: RunEmitter) -> Result<()> {
        let mut runs = self
            .runs
            .lock()
            .map_err(|_| anyhow!("Run state lock poisoned"))?;
        let run = runs
            .get_mut(run_id)
            .ok_or_else(|| anyhow!("Run not found: {run_id}"))?;

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

        Ok(())
    }

    fn abort_build_session_for_stop(&self, context: &BuildRunStopContext) -> Result<()> {
        let Some(session) = self.find_abortable_build_session_for_stop(context)? else {
            return Ok(());
        };
        self.stop_persisted_session(&context.runtime_kind, &context.runtime_route, &session)?;
        Ok(())
    }

    fn stop_persisted_session(
        &self,
        runtime_kind: &AgentRuntimeKind,
        runtime_route: &RuntimeRoute,
        session: &AgentSessionDocument,
    ) -> Result<()> {
        let external_session_id = session
            .external_session_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                anyhow!(
                    "Session {} is missing an external runtime session id",
                    session.session_id
                )
            })?;

        self.runtime_registry.runtime(runtime_kind)?.stop_session(
            runtime_route,
            external_session_id,
            session.working_directory.as_str(),
        )?;

        Ok(())
    }

    fn resolve_session_stop_resolution(
        &self,
        repo_path: &str,
        request: &AgentSessionStopRequest,
    ) -> Result<SessionStopResolution> {
        let session = self.load_target_session_for_stop(repo_path, request)?;
        let runtime_route = LiveSessionStopRouteResolver {
            service: self,
            repo_path,
            request,
        }
        .resolve()?;
        let associated_build_run_id = if session.role.trim() == "build" {
            Some(self.resolve_build_run_id_for_session_stop(repo_path, request, &runtime_route)?)
        } else {
            None
        };

        Ok(SessionStopResolution {
            session,
            runtime_route,
            associated_build_run_id,
        })
    }

    fn load_target_session_for_stop(
        &self,
        repo_path: &str,
        request: &AgentSessionStopRequest,
    ) -> Result<AgentSessionDocument> {
        let session = self
            .agent_sessions_list(repo_path, request.task_id.as_str())?
            .into_iter()
            .find(|session| session.session_id == request.session_id)
            .ok_or_else(|| {
                anyhow!(
                    "Agent session {} was not found for task {}",
                    request.session_id,
                    request.task_id
                )
            })?;

        self.validate_session_stop_request(request, &session)?;
        Ok(session)
    }

    fn validate_session_stop_request(
        &self,
        request: &AgentSessionStopRequest,
        session: &AgentSessionDocument,
    ) -> Result<()> {
        if session.runtime_kind.trim() != request.runtime_kind.as_str() {
            return Err(anyhow!(
                "Agent session {} runtime kind mismatch: expected {}, found {}",
                request.session_id,
                request.runtime_kind.as_str(),
                session.runtime_kind.trim()
            ));
        }

        if normalize_path_for_comparison(session.working_directory.as_str())
            != normalize_path_for_comparison(request.working_directory.as_str())
        {
            return Err(anyhow!(
                "Agent session {} working directory mismatch: expected {}, found {}",
                request.session_id,
                request.working_directory,
                session.working_directory
            ));
        }

        let requested_external_session_id = request
            .external_session_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let persisted_external_session_id = session
            .external_session_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        if let Some(requested_external_session_id) = requested_external_session_id {
            if persisted_external_session_id != Some(requested_external_session_id) {
                return Err(anyhow!(
                    "Agent session {} external session id mismatch",
                    request.session_id
                ));
            }
        }

        Ok(())
    }

    fn resolve_build_run_id_for_session_stop(
        &self,
        repo_path: &str,
        request: &AgentSessionStopRequest,
        runtime_route: &RuntimeRoute,
    ) -> Result<String> {
        let normalized_repo_path = normalize_path_for_comparison(repo_path);
        let normalized_working_directory =
            normalize_path_for_comparison(request.working_directory.as_str());
        let runs = self
            .runs
            .lock()
            .map_err(|_| anyhow!("Run state lock poisoned"))?;
        let matching_run_ids = runs
            .iter()
            .filter(|(_, run)| is_live_stoppable_run_state(&run.summary.state))
            .filter(|(_, run)| run.task_id == request.task_id)
            .filter(|(_, run)| run.summary.runtime_kind == request.runtime_kind)
            .filter(|(_, run)| run.summary.runtime_route == *runtime_route)
            .filter(|(_, run)| {
                normalize_path_for_comparison(run.repo_path.as_str()) == normalized_repo_path
            })
            .filter(|(_, run)| {
                normalize_path_for_comparison(run.worktree_path.as_str())
                    == normalized_working_directory
            })
            .map(|(run_id, _)| run_id.clone())
            .collect::<Vec<_>>();

        match matching_run_ids.as_slice() {
            [run_id] => Ok(run_id.clone()),
            [] => Err(anyhow!(
                "No active build run matched session {}",
                request.session_id
            )),
            _ => Err(anyhow!(
                "Multiple active build runs matched session {}",
                request.session_id
            )),
        }
    }

    fn find_abortable_build_session_for_stop(
        &self,
        context: &BuildRunStopContext,
    ) -> Result<Option<AgentSessionDocument>> {
        let normalized_worktree = normalize_path_for_comparison(context.worktree_path.as_str());
        Ok(self
            .agent_sessions_list(context.repo_path.as_str(), context.task_id.as_str())?
            .into_iter()
            .filter(|session| session.role.trim() == "build")
            .filter(|session| session.runtime_kind.trim() == context.runtime_kind.as_str())
            .filter(is_active_build_session)
            .filter(|session| {
                normalize_path_for_comparison(session.working_directory.as_str())
                    == normalized_worktree
            })
            .max_by(|left, right| {
                build_session_sort_key(left)
                    .cmp(&build_session_sort_key(right))
                    .then_with(|| left.session_id.cmp(&right.session_id))
            }))
    }
}

impl LiveSessionStopRouteResolver<'_> {
    fn resolve(&self) -> Result<RuntimeRoute> {
        let routes = self.collect_unique_routes()?;
        match routes.as_slice() {
            [runtime_route] => Ok(runtime_route.clone()),
            [] => Err(anyhow!(
                "No live runtime route found for session {}",
                self.request.session_id
            )),
            _ => Err(anyhow!(
                "Multiple live runtime routes matched session {}",
                self.request.session_id
            )),
        }
    }

    fn collect_unique_routes(&self) -> Result<Vec<RuntimeRoute>> {
        let normalized_repo_path = normalize_path_for_comparison(self.repo_path);
        let normalized_working_directory =
            normalize_path_for_comparison(self.request.working_directory.as_str());
        let mut routes = Vec::new();

        {
            let runs = self
                .service
                .runs
                .lock()
                .map_err(|_| anyhow!("Run state lock poisoned"))?;
            for run in runs.values() {
                if !is_live_stoppable_run_state(&run.summary.state)
                    || run.task_id != self.request.task_id
                    || run.summary.runtime_kind != self.request.runtime_kind
                    || normalize_path_for_comparison(run.repo_path.as_str()) != normalized_repo_path
                    || normalize_path_for_comparison(run.worktree_path.as_str())
                        != normalized_working_directory
                {
                    continue;
                }

                push_unique_runtime_route(&mut routes, run.summary.runtime_route.clone());
            }
        }

        {
            let runtimes = self
                .service
                .agent_runtimes
                .lock()
                .map_err(|_| anyhow!("Agent runtime state lock poisoned"))?;
            for runtime in runtimes.values() {
                if runtime.summary.kind != self.request.runtime_kind
                    || normalize_path_for_comparison(runtime.summary.repo_path.as_str())
                        != normalized_repo_path
                    || normalize_path_for_comparison(runtime.summary.working_directory.as_str())
                        != normalized_working_directory
                {
                    continue;
                }

                push_unique_runtime_route(&mut routes, runtime.summary.runtime_route.clone());
            }
        }

        Ok(routes)
    }
}

fn build_session_sort_key(session: &AgentSessionDocument) -> (&str, &str) {
    (session.started_at.as_str(), session.session_id.as_str())
}

fn is_active_build_session(session: &AgentSessionDocument) -> bool {
    session
        .external_session_id
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
}

fn is_live_stoppable_run_state(state: &RunState) -> bool {
    matches!(
        state,
        RunState::Starting
            | RunState::Running
            | RunState::Blocked
            | RunState::AwaitingDoneConfirmation
    )
}

fn push_unique_runtime_route(routes: &mut Vec<RuntimeRoute>, runtime_route: RuntimeRoute) {
    if !routes.contains(&runtime_route) {
        routes.push(runtime_route);
    }
}

fn normalize_path_for_comparison(path: &str) -> PathBuf {
    let path = path.trim();
    let mut normalized = PathBuf::new();
    for component in PathBuf::from(path).components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            other => normalized.push(other.as_os_str()),
        }
    }

    if normalized.as_os_str().is_empty() {
        PathBuf::from(path)
    } else {
        normalized
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app_service::test_support::build_service_with_state;

    #[test]
    fn stop_opencode_session_rejects_stdio_routes() {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let error = service
            .runtime_registry
            .runtime(&AgentRuntimeKind::opencode())
            .expect("opencode runtime should be registered")
            .stop_session(
                &RuntimeRoute::Stdio,
                "external-session-1",
                "/tmp/repo/worktree",
            )
            .expect_err("stdio abort should fail fast");

        assert!(error
            .to_string()
            .contains("local_http runtime route with a port"));
    }
}
