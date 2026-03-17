use super::*;

impl BeadsTaskStore {
    pub(super) fn get_spec_impl(&self, repo_path: &Path, task_id: &str) -> Result<SpecDocument> {
        let issue = self.show_raw_issue(repo_path, task_id)?;
        let metadata_root = parse_metadata_root(issue.metadata);
        let namespace_key = self.current_metadata_namespace();
        let entries = metadata_namespace(&metadata_root, &namespace_key)
            .and_then(|ns| ns.get("documents"))
            .and_then(|docs| docs.get("spec"))
            .and_then(parse_markdown_entries);
        let latest = entries.as_ref().and_then(|list| list.last());

        Ok(SpecDocument {
            markdown: latest
                .map(|entry| entry.markdown.clone())
                .unwrap_or_default(),
            updated_at: latest.map(|entry| entry.updated_at.clone()),
        })
    }

    pub(super) fn set_spec_impl(
        &self,
        repo_path: &Path,
        task_id: &str,
        markdown: &str,
    ) -> Result<SpecDocument> {
        let (mut root, namespace_key, mut namespace_map) =
            self.load_namespace(repo_path, task_id)?;
        let mut documents_map = namespace_map
            .get("documents")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();

        let next_revision = documents_map
            .get("spec")
            .and_then(parse_markdown_entries)
            .and_then(|entries| entries.last().map(|entry| entry.revision + 1))
            .unwrap_or(1);

        let timestamp = now_rfc3339();
        let entry = MarkdownEntry {
            markdown: markdown.trim().to_string(),
            updated_at: timestamp.clone(),
            updated_by: "planner-agent".to_string(),
            source_tool: "set_spec".to_string(),
            revision: next_revision,
        };

        documents_map.insert(
            "spec".to_string(),
            Value::Array(vec![serde_json::to_value(&entry)?]),
        );
        namespace_map.insert("documents".to_string(), Value::Object(documents_map));

        self.persist_namespace(repo_path, task_id, &namespace_key, &mut root, namespace_map)?;

        Ok(SpecDocument {
            markdown: entry.markdown,
            updated_at: Some(timestamp),
        })
    }

    pub(super) fn get_plan_impl(&self, repo_path: &Path, task_id: &str) -> Result<SpecDocument> {
        let issue = self.show_raw_issue(repo_path, task_id)?;
        let metadata_root = parse_metadata_root(issue.metadata);
        let namespace_key = self.current_metadata_namespace();
        let entries = metadata_namespace(&metadata_root, &namespace_key)
            .and_then(|ns| ns.get("documents"))
            .and_then(|docs| docs.get("implementationPlan"))
            .and_then(parse_markdown_entries);
        let latest = entries.as_ref().and_then(|list| list.last());

        Ok(SpecDocument {
            markdown: latest
                .map(|entry| entry.markdown.clone())
                .unwrap_or_default(),
            updated_at: latest.map(|entry| entry.updated_at.clone()),
        })
    }

    pub(super) fn set_plan_impl(
        &self,
        repo_path: &Path,
        task_id: &str,
        markdown: &str,
    ) -> Result<SpecDocument> {
        let (mut root, namespace_key, mut namespace_map) =
            self.load_namespace(repo_path, task_id)?;
        let mut documents_map = namespace_map
            .get("documents")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();

        let next_revision = documents_map
            .get("implementationPlan")
            .and_then(parse_markdown_entries)
            .and_then(|entries| entries.last().map(|entry| entry.revision + 1))
            .unwrap_or(1);

        let timestamp = now_rfc3339();
        let entry = MarkdownEntry {
            markdown: markdown.trim().to_string(),
            updated_at: timestamp.clone(),
            updated_by: "planner-agent".to_string(),
            source_tool: "set_plan".to_string(),
            revision: next_revision,
        };

        documents_map.insert(
            "implementationPlan".to_string(),
            Value::Array(vec![serde_json::to_value(&entry)?]),
        );
        namespace_map.insert("documents".to_string(), Value::Object(documents_map));

        self.persist_namespace(repo_path, task_id, &namespace_key, &mut root, namespace_map)?;

        Ok(SpecDocument {
            markdown: entry.markdown,
            updated_at: Some(timestamp),
        })
    }

    pub(super) fn get_latest_qa_report_impl(
        &self,
        repo_path: &Path,
        task_id: &str,
    ) -> Result<Option<QaReportDocument>> {
        let issue = self.show_raw_issue(repo_path, task_id)?;
        let metadata_root = parse_metadata_root(issue.metadata);
        let namespace_key = self.current_metadata_namespace();
        let namespace = metadata_namespace(&metadata_root, &namespace_key);
        let Some(entries) = namespace
            .and_then(|ns| ns.get("documents"))
            .and_then(|docs| docs.get("qaReports"))
            .and_then(parse_qa_entries)
        else {
            return Ok(None);
        };

        Ok(entries.last().map(|entry| QaReportDocument {
            markdown: entry.markdown.clone(),
            verdict: entry.verdict.clone(),
            updated_at: entry.updated_at.clone(),
            revision: entry.revision,
        }))
    }

    pub(super) fn append_qa_report_impl(
        &self,
        repo_path: &Path,
        task_id: &str,
        markdown: &str,
        verdict: QaVerdict,
    ) -> Result<QaReportDocument> {
        let (mut root, namespace_key, mut namespace_map) =
            self.load_namespace(repo_path, task_id)?;
        let mut documents_map = namespace_map
            .get("documents")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();

        let mut entries = documents_map
            .get("qaReports")
            .and_then(parse_qa_entries)
            .unwrap_or_default();
        let next_revision = entries.last().map(|entry| entry.revision + 1).unwrap_or(1);

        let timestamp = now_rfc3339();
        let entry = QaEntry {
            markdown: markdown.trim().to_string(),
            verdict: verdict.clone(),
            updated_at: timestamp.clone(),
            updated_by: "qa-agent".to_string(),
            source_tool: match verdict {
                QaVerdict::Approved => "qa_approved".to_string(),
                QaVerdict::Rejected => "qa_rejected".to_string(),
            },
            revision: next_revision,
        };

        entries.push(entry.clone());
        documents_map.insert(
            "qaReports".to_string(),
            Value::Array(
                entries
                    .iter()
                    .map(serde_json::to_value)
                    .collect::<std::result::Result<Vec<_>, _>>()?,
            ),
        );
        namespace_map.insert("documents".to_string(), Value::Object(documents_map));

        self.persist_namespace(repo_path, task_id, &namespace_key, &mut root, namespace_map)?;
        Ok(QaReportDocument {
            markdown: entry.markdown,
            verdict: entry.verdict,
            updated_at: timestamp,
            revision: entry.revision,
        })
    }

    pub(super) fn record_qa_outcome_impl(
        &self,
        repo_path: &Path,
        task_id: &str,
        target_status: TaskStatus,
        markdown: &str,
        verdict: QaVerdict,
    ) -> Result<TaskCard> {
        self.ensure_custom_statuses(repo_path)?;

        let (mut root, namespace_key, mut namespace_map) =
            self.load_namespace(repo_path, task_id)?;
        let mut documents_map = namespace_map
            .get("documents")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();

        let mut entries = documents_map
            .get("qaReports")
            .and_then(parse_qa_entries)
            .unwrap_or_default();
        let next_revision = entries.last().map(|entry| entry.revision + 1).unwrap_or(1);

        let timestamp = now_rfc3339();
        let entry = QaEntry {
            markdown: markdown.trim().to_string(),
            verdict: verdict.clone(),
            updated_at: timestamp,
            updated_by: "qa-agent".to_string(),
            source_tool: match verdict {
                QaVerdict::Approved => "qa_approved".to_string(),
                QaVerdict::Rejected => "qa_rejected".to_string(),
            },
            revision: next_revision,
        };

        entries.push(entry);
        documents_map.insert(
            "qaReports".to_string(),
            Value::Array(
                entries
                    .iter()
                    .map(serde_json::to_value)
                    .collect::<std::result::Result<Vec<_>, _>>()?,
            ),
        );
        namespace_map.insert("documents".to_string(), Value::Object(documents_map));
        root.insert(namespace_key, Value::Object(namespace_map));

        let metadata_payload = serde_json::to_string(&Value::Object(root))?;
        let status_value = target_status.as_cli_value().to_string();
        self.run_bd_json(
            repo_path,
            &[
                "update",
                "--status",
                status_value.as_str(),
                "--metadata",
                metadata_payload.as_str(),
                "--",
                task_id,
            ],
        )?;
        self.invalidate_task_list_cache(repo_path)?;

        self.show_task(repo_path, task_id)
    }
}
