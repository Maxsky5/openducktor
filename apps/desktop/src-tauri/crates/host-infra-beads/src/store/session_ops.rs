use super::*;

impl BeadsTaskStore {
    pub(super) fn list_agent_sessions_impl(
        &self,
        repo_path: &Path,
        task_id: &str,
    ) -> Result<Vec<AgentSessionDocument>> {
        let issue = self.show_raw_issue(repo_path, task_id)?;
        let metadata_root = parse_metadata_root(issue.metadata);
        let namespace_key = self.current_metadata_namespace();
        let mut entries = metadata_namespace(&metadata_root, &namespace_key)
            .and_then(|ns| ns.get("agentSessions"))
            .and_then(parse_agent_sessions)
            .unwrap_or_default();

        entries.sort_by(|a, b| b.started_at.cmp(&a.started_at));
        Ok(entries)
    }

    pub(super) fn upsert_agent_session_impl(
        &self,
        repo_path: &Path,
        task_id: &str,
        session: AgentSessionDocument,
    ) -> Result<()> {
        let (mut root, namespace_key, mut namespace_map) =
            self.load_namespace(repo_path, task_id)?;
        let mut sessions = namespace_map
            .get("agentSessions")
            .and_then(parse_agent_sessions)
            .unwrap_or_default();

        if let Some(existing_index) = sessions
            .iter()
            .position(|entry| entry.session_id == session.session_id)
        {
            sessions[existing_index] = session;
        } else {
            sessions.push(session);
        }

        sessions.sort_by(|a, b| b.started_at.cmp(&a.started_at));
        sessions.truncate(100);

        namespace_map.insert(
            "agentSessions".to_string(),
            Value::Array(
                sessions
                    .iter()
                    .map(serde_json::to_value)
                    .collect::<std::result::Result<Vec<_>, _>>()?,
            ),
        );

        self.persist_namespace(repo_path, task_id, &namespace_key, &mut root, namespace_map)?;
        Ok(())
    }

    pub(super) fn get_task_metadata_impl(
        &self,
        repo_path: &Path,
        task_id: &str,
    ) -> Result<TaskMetadata> {
        let issue = self.show_raw_issue(repo_path, task_id)?;
        let metadata_root = parse_metadata_root(issue.metadata);
        let namespace_key = self.current_metadata_namespace();
        let namespace = metadata_namespace(&metadata_root, &namespace_key);

        let spec_entries = namespace
            .and_then(|ns| ns.get("documents"))
            .and_then(|docs| docs.get("spec"))
            .and_then(parse_markdown_entries);
        let spec_latest = spec_entries.as_ref().and_then(|list| list.last());
        let spec = SpecDocument {
            markdown: spec_latest
                .map(|entry| entry.markdown.clone())
                .unwrap_or_default(),
            updated_at: spec_latest.map(|entry| entry.updated_at.clone()),
        };

        let plan_entries = namespace
            .and_then(|ns| ns.get("documents"))
            .and_then(|docs| docs.get("implementationPlan"))
            .and_then(parse_markdown_entries);
        let plan_latest = plan_entries.as_ref().and_then(|list| list.last());
        let plan = SpecDocument {
            markdown: plan_latest
                .map(|entry| entry.markdown.clone())
                .unwrap_or_default(),
            updated_at: plan_latest.map(|entry| entry.updated_at.clone()),
        };

        let qa_entries = namespace
            .and_then(|ns| ns.get("documents"))
            .and_then(|docs| docs.get("qaReports"))
            .and_then(parse_qa_entries);
        let qa_report = qa_entries
            .as_ref()
            .and_then(|entries| entries.last())
            .map(|entry| QaReportDocument {
                markdown: entry.markdown.clone(),
                verdict: entry.verdict.clone(),
                updated_at: entry.updated_at.clone(),
                revision: entry.revision,
            });

        let mut agent_sessions = namespace
            .and_then(|ns| ns.get("agentSessions"))
            .and_then(parse_agent_sessions)
            .unwrap_or_default();
        agent_sessions.sort_by(|a, b| b.started_at.cmp(&a.started_at));

        Ok(TaskMetadata {
            spec,
            plan,
            qa_report,
            agent_sessions,
        })
    }
}
