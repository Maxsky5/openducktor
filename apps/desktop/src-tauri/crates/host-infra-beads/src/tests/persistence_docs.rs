use super::*;

#[test]
fn clear_workflow_documents_removes_all_workflow_docs_and_invalidates_task_list_cache() -> Result<()>
{
    let repo = RepoFixture::new("clear-workflow-documents");
    let initial_list = json!([issue_value(
        "task-1",
        "open",
        "task",
        None,
        json!([]),
        Some(json!({
            "openducktor": {"documents": {
                "spec": [{"markdown": "# Spec", "updatedAt": "2026-02-20T12:00:00Z", "updatedBy": "planner-agent", "sourceTool": "set_spec", "revision": 1}],
                "implementationPlan": [{"markdown": "## Plan", "updatedAt": "2026-02-20T12:05:00Z", "updatedBy": "planner-agent", "sourceTool": "set_plan", "revision": 1}],
                "qaReports": [{"markdown": "QA report", "verdict": "approved", "updatedAt": "2026-02-20T12:10:00Z", "updatedBy": "qa-agent", "sourceTool": "odt_qa_approved", "revision": 1}]
            }}
        })),
    )]);
    let current_issue = issue_value(
        "task-1",
        "open",
        "task",
        None,
        json!([]),
        Some(json!({
            "openducktor": {"documents": {
                "spec": [{"markdown": "# Spec", "updatedAt": "2026-02-20T12:00:00Z", "updatedBy": "planner-agent", "sourceTool": "set_spec", "revision": 1}],
                "implementationPlan": [{"markdown": "## Plan", "updatedAt": "2026-02-20T12:05:00Z", "updatedBy": "planner-agent", "sourceTool": "set_plan", "revision": 1}],
                "qaReports": [{"markdown": "QA report", "verdict": "approved", "updatedAt": "2026-02-20T12:10:00Z", "updatedBy": "qa-agent", "sourceTool": "odt_qa_approved", "revision": 1}]
            }}
        })),
    );
    let refreshed_list = json!([issue_value("task-1", "open", "task", None, json!([]), None)]);
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::WithEnv(Ok(initial_list.to_string())),
        MockStep::WithEnv(Ok(json!([current_issue]).to_string())),
        MockStep::WithEnv(Ok("{}".to_string())),
        MockStep::WithEnv(Ok(refreshed_list.to_string())),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let initial = store.list_tasks(repo.path())?;
    assert!(initial[0].document_summary.spec.has);
    assert!(initial[0].document_summary.plan.has);
    assert!(initial[0].document_summary.qa_report.has);
    store.clear_workflow_documents(repo.path(), "task-1")?;
    let refreshed = store.list_tasks(repo.path())?;
    assert!(!refreshed[0].document_summary.spec.has);
    assert!(!refreshed[0].document_summary.plan.has);
    assert!(!refreshed[0].document_summary.qa_report.has);

    let calls = runner.take_calls();
    let list_calls = calls
        .iter()
        .filter(|call| call.args.first().map(String::as_str) == Some("list"))
        .count();
    assert_eq!(list_calls, 2);
    Ok(())
}

#[test]
fn get_spec_reads_latest_entry_and_falls_back_to_empty() -> Result<()> {
    let repo = RepoFixture::new("get-spec");
    let with_entries = issue_value(
        "task-1",
        "open",
        "task",
        None,
        json!([]),
        Some(json!({"openducktor": {"documents": {"spec": [
            {"markdown": "# Spec v1", "updatedAt": "2026-02-20T11:00:00Z", "updatedBy": "planner-agent", "sourceTool": ODT_SET_SPEC_SOURCE_TOOL, "revision": 1},
            {"markdown": "# Spec v2", "updatedAt": "2026-02-20T12:00:00Z", "updatedBy": "planner-agent", "sourceTool": ODT_SET_SPEC_SOURCE_TOOL, "revision": 2}
        ]}}})),
    );
    let empty = issue_value("task-1", "open", "task", None, json!([]), None);
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::WithEnv(Ok(json!([with_entries]).to_string())),
        MockStep::WithEnv(Ok(json!([empty]).to_string())),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner);

    let latest = store.get_spec(repo.path(), "task-1")?;
    assert_eq!(latest.markdown, "# Spec v2");
    assert_eq!(latest.updated_at.as_deref(), Some("2026-02-20T12:00:00Z"));
    let missing = store.get_spec(repo.path(), "task-1")?;
    assert!(missing.markdown.is_empty());
    assert!(missing.updated_at.is_none());
    Ok(())
}

#[test]
fn set_spec_trims_markdown_and_increments_revision() -> Result<()> {
    let repo = RepoFixture::new("set-spec");
    let current = issue_value(
        "task-1",
        "open",
        "task",
        None,
        json!([]),
        Some(
            json!({"openducktor": {"documents": {"spec": [{"markdown": "# Spec v2", "updatedAt": "2026-02-20T12:00:00Z", "updatedBy": "planner-agent", "sourceTool": ODT_SET_SPEC_SOURCE_TOOL, "revision": 2}]}}}),
        ),
    );
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::WithEnv(Ok(json!([current]).to_string())),
        MockStep::WithEnv(Ok("{}".to_string())),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let spec = store.set_spec(repo.path(), "task-1", "  ## Updated Spec  ")?;
    assert_eq!(spec.markdown, "## Updated Spec");
    let calls = runner.take_calls();
    let metadata_root = metadata_from_call(&calls[1]);
    let entry = &metadata_root["openducktor"]["documents"]["spec"][0];
    assert_eq!(
        entry["markdown"],
        Value::String("## Updated Spec".to_string())
    );
    assert_eq!(entry["revision"], Value::Number(3.into()));
    Ok(())
}

#[test]
fn get_and_set_plan_use_implementation_plan_metadata() -> Result<()> {
    let repo = RepoFixture::new("plan-docs");
    let current_with_plan = issue_value(
        "task-1",
        "open",
        "task",
        None,
        json!([]),
        Some(
            json!({"openducktor": {"documents": {"implementationPlan": [{"markdown": "# Plan v4", "updatedAt": "2026-02-20T12:30:00Z", "updatedBy": "planner-agent", "sourceTool": ODT_SET_PLAN_SOURCE_TOOL, "revision": 4}]}}}),
        ),
    );
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::WithEnv(Ok(json!([current_with_plan.clone()]).to_string())),
        MockStep::WithEnv(Ok(json!([current_with_plan]).to_string())),
        MockStep::WithEnv(Ok("{}".to_string())),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let plan = store.get_plan(repo.path(), "task-1")?;
    assert_eq!(plan.markdown, "# Plan v4");
    let updated = store.set_plan(repo.path(), "task-1", "  # Plan v5 ")?;
    assert_eq!(updated.markdown, "# Plan v5");
    let calls = runner.take_calls();
    let metadata_root = metadata_from_call(&calls[2]);
    let entry = &metadata_root["openducktor"]["documents"]["implementationPlan"][0];
    assert_eq!(entry["markdown"], Value::String("# Plan v5".to_string()));
    assert_eq!(entry["revision"], Value::Number(5.into()));
    Ok(())
}

#[test]
fn qa_reports_store_latest_entry_and_preserve_next_revision() -> Result<()> {
    let repo = RepoFixture::new("qa-docs");
    let empty = issue_value("task-1", "open", "task", None, json!([]), None);
    let with_reports = issue_value(
        "task-1",
        "open",
        "task",
        None,
        json!([]),
        Some(
            json!({"openducktor": {"documents": {"qaReports": [{"markdown": "Initial QA", "verdict": "approved", "updatedAt": "2026-02-20T10:00:00Z", "updatedBy": "qa-agent", "sourceTool": ODT_QA_APPROVED_SOURCE_TOOL, "revision": 1}]}}}),
        ),
    );
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::WithEnv(Ok(json!([empty]).to_string())),
        MockStep::WithEnv(Ok(json!([with_reports]).to_string())),
        MockStep::WithEnv(Ok("{}".to_string())),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    assert!(store.get_latest_qa_report(repo.path(), "task-1")?.is_none());
    let appended = store.append_qa_report(
        repo.path(),
        "task-1",
        "  Needs fixes  ",
        QaVerdict::Rejected,
    )?;
    assert_eq!(appended.markdown, "Needs fixes");
    assert_eq!(appended.verdict, QaVerdict::Rejected);
    assert_eq!(appended.revision, 2);
    let calls = runner.take_calls();
    let metadata_root = metadata_from_call(&calls[2]);
    let newest = metadata_root["openducktor"]["documents"]["qaReports"][0].clone();
    assert_eq!(newest["revision"], Value::Number(2.into()));
    assert_eq!(
        newest["sourceTool"],
        Value::String(ODT_QA_REJECTED_SOURCE_TOOL.to_string())
    );
    Ok(())
}

#[test]
fn append_qa_report_rejects_malformed_existing_metadata() {
    let repo = RepoFixture::new("qa-docs-invalid");
    let malformed = issue_value(
        "task-1",
        "open",
        "task",
        None,
        json!([]),
        Some(json!({"openducktor": {"documents": {"qaReports": {"unexpected": true}}}})),
    );
    let runner =
        MockCommandRunner::with_steps(vec![MockStep::WithEnv(Ok(json!([malformed]).to_string()))]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let error = store
        .append_qa_report(repo.path(), "task-1", "Needs fixes", QaVerdict::Rejected)
        .expect_err("malformed qaReports metadata should fail");
    assert!(error
        .to_string()
        .contains("Invalid existing qaReports metadata: expected an array"));
    assert_eq!(runner.take_calls().len(), 1);
}

#[test]
fn record_qa_outcome_updates_status_and_metadata_in_one_update_call() -> Result<()> {
    let repo = RepoFixture::new("qa-outcome");
    let current = issue_value(
        "task-1",
        "ai_review",
        "task",
        None,
        json!([]),
        Some(
            json!({"openducktor": {"documents": {"qaReports": [{"markdown": "Initial QA", "verdict": "rejected", "updatedAt": "2026-02-20T10:00:00Z", "updatedBy": "qa-agent", "sourceTool": ODT_QA_REJECTED_SOURCE_TOOL, "revision": 1}]}}}),
        ),
    );
    let updated = issue_value(
        "task-1",
        "human_review",
        "task",
        None,
        json!([]),
        Some(
            json!({"openducktor": {"documents": {"qaReports": [{"markdown": "Looks good", "verdict": "approved", "updatedAt": "2026-02-20T12:00:00Z", "updatedBy": "qa-agent", "sourceTool": ODT_QA_APPROVED_SOURCE_TOOL, "revision": 2}]}}}),
        ),
    );
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::WithEnv(Ok(json!([current]).to_string())),
        MockStep::WithEnv(Ok(updated.to_string())),
        MockStep::WithEnv(Ok(json!([updated]).to_string())),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let task = store.record_qa_outcome(
        repo.path(),
        "task-1",
        TaskStatus::HumanReview,
        "  Looks good  ",
        QaVerdict::Approved,
    )?;
    assert_eq!(task.status, TaskStatus::HumanReview);
    let calls = runner.take_calls();
    assert_eq!(calls.len(), 3);
    let update_call = &calls[1];
    assert!(update_call.args.iter().any(|entry| entry == "--status"));
    assert!(update_call.args.iter().any(|entry| entry == "human_review"));
    let metadata_root = metadata_from_call(update_call);
    let newest = metadata_root["openducktor"]["documents"]["qaReports"][0].clone();
    assert_eq!(newest["markdown"], Value::String("Looks good".to_string()));
    assert_eq!(newest["verdict"], Value::String("approved".to_string()));
    assert_eq!(newest["revision"], Value::Number(2.into()));
    Ok(())
}

#[test]
fn get_latest_qa_report_returns_latest_entry_when_present() -> Result<()> {
    let repo = RepoFixture::new("qa-latest");
    let with_reports = issue_value(
        "task-1",
        "open",
        "task",
        None,
        json!([]),
        Some(json!({"openducktor": {"documents": {"qaReports": [
            {"markdown": "First report", "verdict": "rejected", "updatedAt": "2026-02-20T10:00:00Z", "updatedBy": "qa-agent", "sourceTool": ODT_QA_REJECTED_SOURCE_TOOL, "revision": 1},
            {"markdown": "Second report", "verdict": "approved", "updatedAt": "2026-02-20T11:00:00Z", "updatedBy": "qa-agent", "sourceTool": ODT_QA_APPROVED_SOURCE_TOOL, "revision": 2}
        ]}}})),
    );
    let runner = MockCommandRunner::with_steps(vec![MockStep::WithEnv(Ok(
        json!([with_reports]).to_string()
    ))]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner);

    let latest = store
        .get_latest_qa_report(repo.path(), "task-1")?
        .expect("latest report should exist");
    assert_eq!(latest.markdown, "Second report");
    assert_eq!(latest.verdict, QaVerdict::Approved);
    assert_eq!(latest.updated_at, "2026-02-20T11:00:00Z");
    assert_eq!(latest.revision, 2);
    Ok(())
}
