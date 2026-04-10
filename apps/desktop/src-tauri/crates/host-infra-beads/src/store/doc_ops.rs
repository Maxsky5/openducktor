use super::*;

fn write_latest_qa_report(
    documents_map: &mut serde_json::Map<String, Value>,
    markdown: &str,
    verdict: QaVerdict,
    qa_reports_path: &str,
) -> Result<QaEntry> {
    let next_revision = crate::document_storage::next_document_revision(
        documents_map.get("qaReports"),
        qa_reports_path,
    )?;
    let encoded_markdown = crate::document_storage::encode_markdown_for_storage(markdown.trim())?;

    let source_tool = match verdict {
        QaVerdict::Approved => ODT_QA_APPROVED_SOURCE_TOOL,
        QaVerdict::Rejected => ODT_QA_REJECTED_SOURCE_TOOL,
    };
    let entry = QaEntry {
        markdown: encoded_markdown,
        encoding: Some(crate::document_storage::DOCUMENT_ENCODING_GZIP_BASE64_V1.to_string()),
        verdict,
        updated_at: now_rfc3339(),
        updated_by: "qa-agent".to_string(),
        source_tool: source_tool.to_string(),
        revision: next_revision,
    };

    documents_map.insert(
        "qaReports".to_string(),
        Value::Array(vec![serde_json::to_value(&entry)?]),
    );

    Ok(entry)
}

impl BeadsTaskStore {
    pub(super) fn get_spec_impl(&self, repo_path: &Path, task_id: &str) -> Result<SpecDocument> {
        let issue = self.show_raw_issue(repo_path, task_id)?;
        let metadata_root = parse_metadata_root(issue.metadata);
        let namespace_key = self.current_metadata_namespace();
        let spec_path = format!("{namespace_key}.documents.spec");
        Ok(crate::document_storage::read_latest_markdown_document(
            metadata_namespace(&metadata_root, &namespace_key)
                .and_then(|ns| ns.get("documents"))
                .and_then(|docs| docs.get("spec")),
            &spec_path,
        ))
    }

    pub(super) fn set_spec_impl(
        &self,
        repo_path: &Path,
        task_id: &str,
        markdown: &str,
    ) -> Result<SpecDocument> {
        let (mut root, namespace_key, mut namespace_map) =
            self.load_namespace(repo_path, task_id)?;
        let spec_path = format!("{namespace_key}.documents.spec");
        let mut documents_map = namespace_map
            .get("documents")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();

        let next_revision =
            crate::document_storage::next_document_revision(documents_map.get("spec"), &spec_path)?;

        let timestamp = now_rfc3339();
        let encoded_markdown =
            crate::document_storage::encode_markdown_for_storage(markdown.trim())?;
        let entry = MarkdownEntry {
            markdown: encoded_markdown,
            encoding: Some(crate::document_storage::DOCUMENT_ENCODING_GZIP_BASE64_V1.to_string()),
            updated_at: timestamp.clone(),
            updated_by: "planner-agent".to_string(),
            source_tool: ODT_SET_SPEC_SOURCE_TOOL.to_string(),
            revision: next_revision,
        };

        documents_map.insert(
            "spec".to_string(),
            Value::Array(vec![serde_json::to_value(&entry)?]),
        );
        namespace_map.insert("documents".to_string(), Value::Object(documents_map));

        self.persist_namespace(repo_path, task_id, &namespace_key, &mut root, namespace_map)?;

        Ok(SpecDocument {
            markdown: markdown.trim().to_string(),
            updated_at: Some(timestamp),
            revision: Some(entry.revision),
            error: None,
        })
    }

    pub(super) fn get_plan_impl(&self, repo_path: &Path, task_id: &str) -> Result<SpecDocument> {
        let issue = self.show_raw_issue(repo_path, task_id)?;
        let metadata_root = parse_metadata_root(issue.metadata);
        let namespace_key = self.current_metadata_namespace();
        let plan_path = format!("{namespace_key}.documents.implementationPlan");
        Ok(crate::document_storage::read_latest_markdown_document(
            metadata_namespace(&metadata_root, &namespace_key)
                .and_then(|ns| ns.get("documents"))
                .and_then(|docs| docs.get("implementationPlan")),
            &plan_path,
        ))
    }

    pub(super) fn set_plan_impl(
        &self,
        repo_path: &Path,
        task_id: &str,
        markdown: &str,
    ) -> Result<SpecDocument> {
        let (mut root, namespace_key, mut namespace_map) =
            self.load_namespace(repo_path, task_id)?;
        let plan_path = format!("{namespace_key}.documents.implementationPlan");
        let mut documents_map = namespace_map
            .get("documents")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();

        let next_revision = crate::document_storage::next_document_revision(
            documents_map.get("implementationPlan"),
            &plan_path,
        )?;

        let timestamp = now_rfc3339();
        let encoded_markdown =
            crate::document_storage::encode_markdown_for_storage(markdown.trim())?;
        let entry = MarkdownEntry {
            markdown: encoded_markdown,
            encoding: Some(crate::document_storage::DOCUMENT_ENCODING_GZIP_BASE64_V1.to_string()),
            updated_at: timestamp.clone(),
            updated_by: "planner-agent".to_string(),
            source_tool: ODT_SET_PLAN_SOURCE_TOOL.to_string(),
            revision: next_revision,
        };

        documents_map.insert(
            "implementationPlan".to_string(),
            Value::Array(vec![serde_json::to_value(&entry)?]),
        );
        namespace_map.insert("documents".to_string(), Value::Object(documents_map));

        self.persist_namespace(repo_path, task_id, &namespace_key, &mut root, namespace_map)?;

        Ok(SpecDocument {
            markdown: markdown.trim().to_string(),
            updated_at: Some(timestamp),
            revision: Some(entry.revision),
            error: None,
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
        let qa_path = format!("{namespace_key}.documents.qaReports");
        let namespace = metadata_namespace(&metadata_root, &namespace_key);
        let report = crate::document_storage::read_latest_qa_document(
            namespace
                .and_then(|ns| ns.get("documents"))
                .and_then(|docs| docs.get("qaReports")),
            &qa_path,
        );

        Ok(report)
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
        let qa_path = format!("{namespace_key}.documents.qaReports");
        let mut documents_map = namespace_map
            .get("documents")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        let entry = write_latest_qa_report(&mut documents_map, markdown, verdict, &qa_path)?;
        namespace_map.insert("documents".to_string(), Value::Object(documents_map));

        self.persist_namespace(repo_path, task_id, &namespace_key, &mut root, namespace_map)?;
        Ok(QaReportDocument {
            markdown: markdown.trim().to_string(),
            verdict: match entry.verdict {
                QaVerdict::Approved => QaWorkflowVerdict::Approved,
                QaVerdict::Rejected => QaWorkflowVerdict::Rejected,
            },
            updated_at: Some(entry.updated_at),
            revision: Some(entry.revision),
            error: None,
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
        let (mut root, namespace_key, mut namespace_map) =
            self.load_namespace(repo_path, task_id)?;
        let qa_path = format!("{namespace_key}.documents.qaReports");
        let mut documents_map = namespace_map
            .get("documents")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        write_latest_qa_report(&mut documents_map, markdown, verdict, &qa_path)?;
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

    pub(super) fn clear_qa_reports_impl(&self, repo_path: &Path, task_id: &str) -> Result<()> {
        let (mut root, namespace_key, mut namespace_map) =
            self.load_namespace(repo_path, task_id)?;
        let Some(mut documents_map) = namespace_map
            .get("documents")
            .and_then(Value::as_object)
            .cloned()
        else {
            return Ok(());
        };

        documents_map.remove("qaReports");
        if documents_map.is_empty() {
            namespace_map.remove("documents");
        } else {
            namespace_map.insert("documents".to_string(), Value::Object(documents_map));
        }

        self.persist_namespace(repo_path, task_id, &namespace_key, &mut root, namespace_map)?;
        Ok(())
    }

    pub(super) fn clear_workflow_documents_impl(
        &self,
        repo_path: &Path,
        task_id: &str,
    ) -> Result<()> {
        let (mut root, namespace_key, mut namespace_map) =
            self.load_namespace(repo_path, task_id)?;
        let Some(mut documents_map) = namespace_map
            .get("documents")
            .and_then(Value::as_object)
            .cloned()
        else {
            return Ok(());
        };

        documents_map.remove("spec");
        documents_map.remove("implementationPlan");
        documents_map.remove("qaReports");

        if documents_map.is_empty() {
            namespace_map.remove("documents");
        } else {
            namespace_map.insert("documents".to_string(), Value::Object(documents_map));
        }

        self.persist_namespace(repo_path, task_id, &namespace_key, &mut root, namespace_map)?;
        Ok(())
    }
}
