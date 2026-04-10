use super::*;

fn parse_pull_request_record(value: &Value) -> Option<PullRequestRecord> {
    serde_json::from_value(value.clone()).ok()
}

fn parse_direct_merge_record(value: &Value) -> Option<DirectMergeRecord> {
    serde_json::from_value(value.clone()).ok()
}

impl BeadsTaskStore {
    pub(super) fn parse_task_metadata_from_issue(&self, issue: &RawIssue) -> TaskMetadata {
        let metadata_root = parse_metadata_root(issue.metadata.clone());
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
            revision: spec_latest.map(|entry| entry.revision),
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
            revision: plan_latest.map(|entry| entry.revision),
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

        let pull_request = namespace
            .and_then(|ns| ns.get("pullRequest"))
            .and_then(parse_pull_request_record)
            .or_else(|| {
                namespace
                    .and_then(|ns| ns.get("delivery"))
                    .and_then(Value::as_object)
                    .and_then(|delivery| delivery.get("linkedPullRequest"))
                    .and_then(parse_pull_request_record)
            });
        let direct_merge = namespace
            .and_then(|ns| ns.get("directMerge"))
            .and_then(parse_direct_merge_record)
            .or_else(|| {
                namespace
                    .and_then(|ns| ns.get("delivery"))
                    .and_then(Value::as_object)
                    .and_then(|delivery| delivery.get("directMerge"))
                    .and_then(parse_direct_merge_record)
            });

        TaskMetadata {
            spec,
            plan,
            qa_report,
            pull_request,
            direct_merge,
            agent_sessions,
        }
    }

    fn compact_agent_session_for_storage(
        &self,
        mut session: AgentSessionDocument,
    ) -> Result<AgentSessionDocument> {
        session.session_id = session.session_id.trim().to_string();
        if session.session_id.is_empty() {
            return Err(anyhow!("Agent session sessionId is required"));
        }

        session.role = session.role.trim().to_string();
        if session.role.is_empty() {
            return Err(anyhow!("Agent session role is required"));
        }

        let external_session_id = session
            .external_session_id
            .as_mut()
            .ok_or_else(|| anyhow!("Agent session externalSessionId is required"))?;
        *external_session_id = external_session_id.trim().to_string();
        if external_session_id.is_empty() {
            return Err(anyhow!("Agent session externalSessionId is required"));
        }

        session.scenario = session.scenario.trim().to_string();
        if session.scenario.is_empty() {
            return Err(anyhow!("Agent session scenario is required"));
        }

        session.started_at = session.started_at.trim().to_string();
        if session.started_at.is_empty() {
            return Err(anyhow!("Agent session startedAt is required"));
        }

        session.working_directory = session.working_directory.trim().to_string();
        if session.working_directory.is_empty() {
            return Err(anyhow!("Agent session workingDirectory is required"));
        }

        Ok(session)
    }

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
        let compact_session = self.compact_agent_session_for_storage(session)?;
        let (mut root, namespace_key, mut namespace_map) =
            self.load_namespace(repo_path, task_id)?;
        let mut sessions = namespace_map
            .get("agentSessions")
            .and_then(parse_agent_sessions)
            .unwrap_or_default();

        if let Some(existing_index) = sessions
            .iter()
            .position(|entry| entry.session_id == compact_session.session_id)
        {
            sessions[existing_index] = compact_session;
        } else {
            sessions.push(compact_session);
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

    pub(super) fn clear_agent_sessions_by_roles_impl(
        &self,
        repo_path: &Path,
        task_id: &str,
        roles: &[&str],
    ) -> Result<()> {
        let role_set = roles.iter().map(|role| role.trim()).collect::<HashSet<_>>();
        if role_set.is_empty() {
            return Ok(());
        }

        let (mut root, namespace_key, mut namespace_map) =
            self.load_namespace(repo_path, task_id)?;
        let sessions = namespace_map
            .get("agentSessions")
            .and_then(parse_agent_sessions)
            .unwrap_or_default();
        let filtered_sessions = sessions
            .into_iter()
            .filter(|session| !role_set.contains(session.role.trim()))
            .collect::<Vec<_>>();

        if filtered_sessions.is_empty() {
            namespace_map.remove("agentSessions");
        } else {
            namespace_map.insert(
                "agentSessions".to_string(),
                Value::Array(
                    filtered_sessions
                        .iter()
                        .map(serde_json::to_value)
                        .collect::<std::result::Result<Vec<_>, _>>()?,
                ),
            );
        }

        self.persist_namespace(repo_path, task_id, &namespace_key, &mut root, namespace_map)?;
        Ok(())
    }

    pub(super) fn set_pull_request_impl(
        &self,
        repo_path: &Path,
        task_id: &str,
        pull_request: Option<PullRequestRecord>,
    ) -> Result<()> {
        let (mut root, namespace_key, mut namespace_map) =
            self.load_namespace(repo_path, task_id)?;

        match pull_request {
            Some(value) => {
                namespace_map.insert("pullRequest".to_string(), serde_json::to_value(value)?);
            }
            None => {
                namespace_map.remove("pullRequest");
            }
        }

        namespace_map.remove("delivery");
        self.persist_namespace(repo_path, task_id, &namespace_key, &mut root, namespace_map)?;
        Ok(())
    }

    pub(super) fn set_delivery_metadata_impl(
        &self,
        repo_path: &Path,
        task_id: &str,
        pull_request: Option<PullRequestRecord>,
        direct_merge: Option<DirectMergeRecord>,
    ) -> Result<()> {
        let (mut root, namespace_key, mut namespace_map) =
            self.load_namespace(repo_path, task_id)?;

        match pull_request {
            Some(value) => {
                namespace_map.insert("pullRequest".to_string(), serde_json::to_value(value)?);
            }
            None => {
                namespace_map.remove("pullRequest");
            }
        }

        match direct_merge {
            Some(value) => {
                namespace_map.insert("directMerge".to_string(), serde_json::to_value(value)?);
            }
            None => {
                namespace_map.remove("directMerge");
            }
        }

        namespace_map.remove("delivery");
        self.persist_namespace(repo_path, task_id, &namespace_key, &mut root, namespace_map)?;
        Ok(())
    }

    pub(super) fn set_direct_merge_record_impl(
        &self,
        repo_path: &Path,
        task_id: &str,
        direct_merge: Option<DirectMergeRecord>,
    ) -> Result<()> {
        let (mut root, namespace_key, mut namespace_map) =
            self.load_namespace(repo_path, task_id)?;

        match direct_merge {
            Some(value) => {
                namespace_map.insert("directMerge".to_string(), serde_json::to_value(value)?);
            }
            None => {
                namespace_map.remove("directMerge");
            }
        }

        namespace_map.remove("delivery");
        self.persist_namespace(repo_path, task_id, &namespace_key, &mut root, namespace_map)?;
        Ok(())
    }

    pub(super) fn get_task_metadata_impl(
        &self,
        repo_path: &Path,
        task_id: &str,
    ) -> Result<TaskMetadata> {
        let issue = self.show_raw_issue(repo_path, task_id)?;
        Ok(self.parse_task_metadata_from_issue(&issue))
    }
}
