use super::AppService;
use anyhow::{Context, Result};
use host_domain::AgentSessionDocument;
use std::path::Path;

impl AppService {
    pub fn agent_sessions_list(
        &self,
        repo_path: &str,
        task_id: &str,
    ) -> Result<Vec<AgentSessionDocument>> {
        Ok(self.task_metadata_get(repo_path, task_id)?.agent_sessions)
    }

    pub fn agent_session_upsert(
        &self,
        repo_path: &str,
        task_id: &str,
        mut session: AgentSessionDocument,
    ) -> Result<bool> {
        let repo_path = self.resolve_task_repo_path(repo_path)?;
        if session.task_id.as_deref() != Some(task_id) {
            session.task_id = Some(task_id.to_string());
        }
        self.task_store
            .upsert_agent_session(Path::new(&repo_path), task_id, session)
            .with_context(|| format!("Failed to persist agent session for {task_id}"))?;
        Ok(true)
    }
}
