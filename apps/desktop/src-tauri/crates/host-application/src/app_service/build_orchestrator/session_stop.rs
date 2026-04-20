use super::super::{
    AppService, RuntimeSessionStatusProbeOutcome, RuntimeSessionStatusProbeTargetResolution,
};
use anyhow::{anyhow, Result};
use host_domain::{AgentRuntimeKind, AgentSessionDocument, AgentSessionStopRequest, RuntimeRoute};
use std::path::{Component, PathBuf};

struct SessionStopResolution {
    session: AgentSessionDocument,
    runtime_route: RuntimeRoute,
}

struct LiveSessionStopRouteResolver<'a> {
    service: &'a AppService,
    repo_path: &'a str,
    request: &'a AgentSessionStopRequest,
    session: &'a AgentSessionDocument,
}

impl AppService {
    pub fn agent_session_stop(&self, request: AgentSessionStopRequest) -> Result<bool> {
        let repo_path = self.resolve_task_repo_path(&request.repo_path)?;
        let resolution = self.resolve_session_stop_resolution(repo_path.as_str(), &request)?;

        self.stop_persisted_session(
            &request.runtime_kind,
            &resolution.runtime_route,
            &resolution.session,
        )?;

        Ok(true)
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
            session: &session,
        }
        .resolve()?;

        Ok(SessionStopResolution {
            session,
            runtime_route,
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
}

impl LiveSessionStopRouteResolver<'_> {
    fn resolve(&self) -> Result<RuntimeRoute> {
        let exact_routes = self.collect_exact_routes()?;
        match exact_routes.as_slice() {
            [runtime_route] => return Ok(runtime_route.clone()),
            [] => {}
            _ => {
                return Err(anyhow!(
                    "Multiple live runtime routes matched session {}",
                    self.request.session_id
                ));
            }
        }

        let repo_routes = self.collect_repo_runtime_routes()?;
        if let [runtime_route] = repo_routes.as_slice() {
            return Ok(runtime_route.clone());
        }

        let probed_routes =
            self.probe_repo_runtime_routes_for_live_session(repo_routes.as_slice())?;
        match probed_routes.as_slice() {
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

    fn collect_exact_routes(&self) -> Result<Vec<RuntimeRoute>> {
        let normalized_working_directory =
            normalize_path_for_comparison(self.request.working_directory.as_str());
        let mut routes = Vec::new();
        let runtimes = self
            .service
            .runtime_list(self.request.runtime_kind.as_str(), Some(self.repo_path))?;
        for runtime in runtimes {
            if normalize_path_for_comparison(runtime.working_directory.as_str())
                != normalized_working_directory
            {
                continue;
            }

            push_unique_runtime_route(&mut routes, runtime.runtime_route);
        }

        Ok(routes)
    }

    fn collect_repo_runtime_routes(&self) -> Result<Vec<RuntimeRoute>> {
        let mut routes = Vec::new();
        let runtimes = self
            .service
            .runtime_list(self.request.runtime_kind.as_str(), Some(self.repo_path))?;
        for runtime in runtimes {
            push_unique_runtime_route(&mut routes, runtime.runtime_route);
        }

        Ok(routes)
    }

    fn probe_repo_runtime_routes_for_live_session(
        &self,
        candidate_routes: &[RuntimeRoute],
    ) -> Result<Vec<RuntimeRoute>> {
        let external_session_id = self
            .session
            .external_session_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let Some(external_session_id) = external_session_id else {
            return Ok(Vec::new());
        };

        let runtime = self
            .service
            .runtime_registry
            .runtime(&self.request.runtime_kind)?;
        let probe_targets = candidate_routes
            .iter()
            .filter_map(|runtime_route| {
                match runtime.session_status_probe_target(
                    runtime_route,
                    self.request.working_directory.as_str(),
                ) {
                    Ok(RuntimeSessionStatusProbeTargetResolution::Target(probe_target)) => {
                        Some(Ok((runtime_route.clone(), probe_target)))
                    }
                    Ok(RuntimeSessionStatusProbeTargetResolution::Unsupported) => None,
                    Err(error) => Some(Err(error)),
                }
            })
            .collect::<Result<Vec<_>>>()?;
        if probe_targets.is_empty() {
            return Ok(Vec::new());
        }

        let unique_probe_targets = probe_targets
            .iter()
            .map(|(_, probe_target)| probe_target.clone())
            .collect::<Vec<_>>();
        let statuses_by_target = self
            .service
            .load_cached_runtime_session_statuses_for_targets(unique_probe_targets.as_slice())?;
        let mut matching_routes = Vec::new();
        for (runtime_route, probe_target) in probe_targets {
            if statuses_by_target
                .get(&probe_target)
                .is_some_and(|outcome| {
                    matches!(
                        outcome,
                        RuntimeSessionStatusProbeOutcome::Snapshot(snapshot)
                            if snapshot.has_live_session(external_session_id)
                    )
                })
            {
                push_unique_runtime_route(&mut matching_routes, runtime_route);
            }
        }

        Ok(matching_routes)
    }
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
