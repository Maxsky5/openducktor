use super::*;

impl AppService {
    pub(in crate::app_service::runtime_orchestrator) fn acquire_repo_runtime_health_flight(
        &self,
        runtime_kind: AgentRuntimeKind,
        repo_key: &str,
    ) -> Result<(Arc<RepoRuntimeHealthFlight>, bool)> {
        let key = Self::runtime_ensure_flight_key(&runtime_kind, repo_key);
        let mut flights = self
            .repo_runtime_health_flights
            .lock()
            .map_err(|_| anyhow!("Repo runtime health coordination state lock poisoned"))?;
        if let Some(existing) = flights.get(key.as_str()) {
            return Ok((existing.clone(), false));
        }

        let flight = Arc::new(RepoRuntimeHealthFlight::new());
        flights.insert(key, flight.clone());
        Ok((flight, true))
    }

    pub(in crate::app_service::runtime_orchestrator) fn complete_repo_runtime_health_flight(
        &self,
        runtime_kind: AgentRuntimeKind,
        repo_key: &str,
        flight: &Arc<RepoRuntimeHealthFlight>,
        result: &Result<RepoRuntimeHealthCheck>,
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
            *state = RepoRuntimeHealthFlightState::Finished(Box::new(stored_result));
            flight.condvar.notify_all();
        }

        {
            let mut flights = match self.repo_runtime_health_flights.lock() {
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
            return Err(anyhow!(
                "Repo runtime health coordination state lock poisoned"
            ));
        }

        Ok(())
    }

    pub(in crate::app_service::runtime_orchestrator) fn wait_for_repo_runtime_health_flight(
        flight: &Arc<RepoRuntimeHealthFlight>,
    ) -> Result<RepoRuntimeHealthCheck> {
        let mut state = flight
            .state
            .lock()
            .map_err(|_| anyhow!("Repo runtime health coordination state lock poisoned"))?;
        loop {
            match &*state {
                RepoRuntimeHealthFlightState::Starting => {
                    state = flight.condvar.wait(state).map_err(|_| {
                        anyhow!("Repo runtime health coordination state lock poisoned")
                    })?;
                }
                RepoRuntimeHealthFlightState::Finished(result) => {
                    return result
                        .as_ref()
                        .clone()
                        .map_err(|message: String| anyhow!(message));
                }
            }
        }
    }
}
