use super::super::AppService;
use crate::app_service::service_core::{RuntimeEnsureFlight, RuntimeEnsureFlightState};
use anyhow::{anyhow, Result};
use host_domain::{AgentRuntimeKind, RuntimeInstanceSummary};
use std::sync::Arc;

pub(super) struct RuntimeEnsureFlightGuard<'a> {
    service: &'a AppService,
    runtime_kind: AgentRuntimeKind,
    repo_key: String,
    flight: Arc<RuntimeEnsureFlight>,
    completed: bool,
}

impl<'a> RuntimeEnsureFlightGuard<'a> {
    pub(super) fn new(
        service: &'a AppService,
        runtime_kind: AgentRuntimeKind,
        repo_key: &str,
        flight: Arc<RuntimeEnsureFlight>,
    ) -> Self {
        Self {
            service,
            runtime_kind,
            repo_key: repo_key.to_string(),
            flight,
            completed: false,
        }
    }

    pub(super) fn complete(&mut self, result: &Result<RuntimeInstanceSummary>) -> Result<()> {
        self.completed = true;
        self.service.complete_runtime_ensure_flight(
            self.runtime_kind.clone(),
            self.repo_key.as_str(),
            &self.flight,
            result,
        )
    }
}

impl Drop for RuntimeEnsureFlightGuard<'_> {
    fn drop(&mut self) {
        if self.completed {
            return;
        }

        let aborted = Err(anyhow!("Runtime ensure aborted unexpectedly"));
        if let Err(error) = self.service.complete_runtime_ensure_flight(
            self.runtime_kind.clone(),
            self.repo_key.as_str(),
            &self.flight,
            &aborted,
        ) {
            eprintln!(
                "OpenDucktor warning: failed completing runtime ensure flight after abort: {error:#}"
            );
        }
    }
}

impl AppService {
    pub(in crate::app_service::runtime_orchestrator) fn acquire_runtime_ensure_flight(
        &self,
        runtime_kind: AgentRuntimeKind,
        repo_key: &str,
    ) -> Result<(Arc<RuntimeEnsureFlight>, bool)> {
        let key = Self::runtime_ensure_flight_key(&runtime_kind, repo_key);
        let mut flights = self
            .runtime_ensure_flights
            .lock()
            .map_err(|_| anyhow!("Runtime ensure coordination state lock poisoned"))?;
        if let Some(existing) = flights.get(key.as_str()) {
            return Ok((existing.clone(), false));
        }

        let flight = Arc::new(RuntimeEnsureFlight::new());
        flights.insert(key, flight.clone());
        Ok((flight, true))
    }

    pub(in crate::app_service::runtime_orchestrator) fn complete_runtime_ensure_flight(
        &self,
        runtime_kind: AgentRuntimeKind,
        repo_key: &str,
        flight: &Arc<RuntimeEnsureFlight>,
        result: &Result<RuntimeInstanceSummary>,
    ) -> Result<()> {
        let stored_result = match result {
            Ok(summary) => Ok(summary.clone()),
            Err(error) => Err(format!("{error:#}")),
        };
        let mut poisoned = false;

        {
            let mut state = match flight.state.lock() {
                Ok(state) => state,
                Err(poisoned_state) => {
                    poisoned = true;
                    poisoned_state.into_inner()
                }
            };
            *state = RuntimeEnsureFlightState::Finished(Box::new(stored_result));
            flight.condvar.notify_all();
        }

        {
            let mut flights = match self.runtime_ensure_flights.lock() {
                Ok(flights) => flights,
                Err(poisoned_flights) => {
                    poisoned = true;
                    poisoned_flights.into_inner()
                }
            };
            let key = Self::runtime_ensure_flight_key(&runtime_kind, repo_key);
            flights.remove(key.as_str());
        }

        if poisoned {
            return Err(anyhow!("Runtime ensure coordination state lock poisoned"));
        }

        Ok(())
    }

    pub(in crate::app_service::runtime_orchestrator) fn wait_for_runtime_ensure_flight(
        flight: &Arc<RuntimeEnsureFlight>,
    ) -> Result<RuntimeInstanceSummary> {
        let mut state = flight
            .state
            .lock()
            .map_err(|_| anyhow!("Runtime ensure coordination state lock poisoned"))?;
        loop {
            match &*state {
                RuntimeEnsureFlightState::Starting => {
                    state = flight
                        .condvar
                        .wait(state)
                        .map_err(|_| anyhow!("Runtime ensure coordination state lock poisoned"))?;
                }
                RuntimeEnsureFlightState::Finished(result) => {
                    return result.as_ref().clone().map_err(|message| anyhow!(message));
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::RuntimeEnsureFlightGuard;
    use crate::app_service::test_support::build_service_with_state;
    use anyhow::{anyhow, Result};
    use host_domain::AgentRuntimeKind;
    use std::thread;

    #[test]
    fn runtime_ensure_flight_guard_finishes_waiters_when_dropped_uncompleted() -> Result<()> {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let repo_key = "/tmp/runtime-flight-guard";
        let (flight, is_leader) =
            service.acquire_runtime_ensure_flight(AgentRuntimeKind::opencode(), repo_key)?;
        assert!(is_leader);

        {
            let _guard = RuntimeEnsureFlightGuard::new(
                &service,
                AgentRuntimeKind::opencode(),
                repo_key,
                flight.clone(),
            );
        }

        let error = crate::app_service::AppService::wait_for_runtime_ensure_flight(&flight)
            .expect_err("dropped leader should finish waiters with an error");
        assert!(error
            .to_string()
            .contains("Runtime ensure aborted unexpectedly"));

        Ok(())
    }

    #[test]
    fn complete_runtime_ensure_flight_recovers_poisoned_state_and_removes_entry() -> Result<()> {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let repo_key = "/tmp/runtime-flight-poison";
        let (flight, is_leader) =
            service.acquire_runtime_ensure_flight(AgentRuntimeKind::opencode(), repo_key)?;
        assert!(is_leader);

        let poison_handle = thread::spawn({
            let flight = flight.clone();
            move || {
                let _lock = flight
                    .state
                    .lock()
                    .expect("flight state should be available for poisoning");
                panic!("poison runtime ensure flight state");
            }
        });
        assert!(poison_handle.join().is_err());

        let error = service
            .complete_runtime_ensure_flight(
                AgentRuntimeKind::opencode(),
                repo_key,
                &flight,
                &Err(anyhow!("simulated startup failure")),
            )
            .expect_err("poisoned completion should surface an error");
        assert!(error
            .to_string()
            .contains("Runtime ensure coordination state lock poisoned"));

        let flights = service
            .runtime_ensure_flights
            .lock()
            .expect("runtime ensure flights lock should remain available");
        assert!(flights.is_empty());

        Ok(())
    }
}
