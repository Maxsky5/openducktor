use super::*;

#[test]
fn list_tasks_parses_agent_sessions_for_multiple_tasks_in_single_list_call() -> Result<()> {
    let repo = RepoFixture::new("list-task-sessions");
    let task_one = issue_value(
        "task-1",
        "open",
        "task",
        None,
        json!([]),
        Some(json!({"openducktor": {"agentSessions": [
            serde_json::to_value(make_session("session-old", "2026-02-20T09:00:00Z"))?,
            serde_json::to_value(make_session("session-new", "2026-02-20T11:00:00Z"))?
        ]}})),
    );
    let task_two = issue_value(
        "task-2",
        "open",
        "task",
        None,
        json!([]),
        Some(json!({"openducktor": {"agentSessions": []}})),
    );
    let runner =
        MockCommandRunner::with_steps(vec![MockStep::WithEnv(Ok(
            json!([task_one, task_two]).to_string()
        ))]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let tasks = store.list_tasks(repo.path())?;
    assert_eq!(tasks.len(), 2);
    assert_eq!(
        tasks[0]
            .agent_sessions
            .iter()
            .map(|session| session.external_session_id.as_str())
            .collect::<Vec<_>>(),
        vec!["session-new", "session-old"]
    );
    assert!(tasks[1].agent_sessions.is_empty());
    let calls = runner.take_calls();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].program, "bd");
    assert_eq!(calls[0].args[0], "list");
    Ok(())
}

#[test]
fn list_agent_sessions_is_sorted_descending_by_started_at() -> Result<()> {
    let repo = RepoFixture::new("list-sessions");
    let payload = issue_value(
        "task-1",
        "open",
        "task",
        None,
        json!([]),
        Some(json!({"openducktor": {"agentSessions": [
            serde_json::to_value(make_session("session-old", "2026-02-20T09:00:00Z"))?,
            serde_json::to_value(make_session("session-new", "2026-02-20T11:00:00Z"))?
        ]}})),
    );
    let runner =
        MockCommandRunner::with_steps(vec![MockStep::WithEnv(Ok(json!([payload]).to_string()))]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner);

    let sessions = store.list_agent_sessions(repo.path(), "task-1")?;
    assert_eq!(sessions.len(), 2);
    assert_eq!(sessions[0].external_session_id, "session-new");
    assert_eq!(sessions[1].external_session_id, "session-old");
    Ok(())
}

#[test]
fn upsert_agent_session_updates_existing_session_without_duplication() -> Result<()> {
    let repo = RepoFixture::new("upsert-session");
    let payload = issue_value(
        "task-1",
        "open",
        "task",
        None,
        json!([]),
        Some(json!({"openducktor": {"agentSessions": [
            serde_json::to_value(make_session("session-1", "2026-02-20T10:00:00Z"))?,
            serde_json::to_value(make_session("session-2", "2026-02-20T09:00:00Z"))?
        ]}})),
    );
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::WithEnv(Ok(json!([payload]).to_string())),
        MockStep::WithEnv(Ok("{}".to_string())),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    store.upsert_agent_session(
        repo.path(),
        "task-1",
        make_session("session-1", "2026-02-20T12:00:00Z"),
    )?;
    let calls = runner.take_calls();
    let metadata_root = metadata_from_call(&calls[1]);
    let sessions = metadata_root["openducktor"]["agentSessions"]
        .as_array()
        .expect("agentSessions should be an array");
    assert_eq!(sessions.len(), 2);
    let session_1 = sessions
        .iter()
        .find(|entry| entry["externalSessionId"] == Value::String("session-1".to_string()))
        .expect("session-1 missing");
    assert!(session_1.get("status").is_none());
    assert_eq!(
        session_1.get("externalSessionId").and_then(Value::as_str),
        Some("session-1")
    );
    assert!(session_1.get("sessionId").is_none());
    assert!(session_1.get("scenario").is_none());
    assert!(session_1.get("baseUrl").is_none());
    Ok(())
}

#[test]
fn upsert_agent_session_truncates_to_latest_100_entries() -> Result<()> {
    let repo = RepoFixture::new("upsert-session-truncate");
    let existing = (0..100)
        .map(|index| {
            let started_at = format!("2026-02-20T{:02}:00:00Z", index % 24);
            serde_json::to_value(make_session(
                &format!("session-{index:03}"),
                started_at.as_str(),
            ))
            .expect("session should serialize")
        })
        .collect::<Vec<_>>();
    let payload = issue_value(
        "task-1",
        "open",
        "task",
        None,
        json!([]),
        Some(json!({"openducktor": {"agentSessions": existing}})),
    );
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::WithEnv(Ok(json!([payload]).to_string())),
        MockStep::WithEnv(Ok("{}".to_string())),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    store.upsert_agent_session(
        repo.path(),
        "task-1",
        make_session("session-newest", "2026-02-21T00:00:00Z"),
    )?;
    let calls = runner.take_calls();
    let metadata_root = metadata_from_call(&calls[1]);
    let sessions = metadata_root["openducktor"]["agentSessions"]
        .as_array()
        .expect("agentSessions should be an array");
    assert_eq!(sessions.len(), 100);
    assert!(sessions
        .iter()
        .any(|entry| entry["externalSessionId"] == Value::String("session-newest".to_string())));
    Ok(())
}

#[test]
fn get_task_metadata_fetches_all_fields_in_single_call() -> Result<()> {
    let repo = RepoFixture::new("get-task-metadata");
    let issue = issue_value(
        "task-1",
        "open",
        "task",
        None,
        json!([]),
        Some(json!({
            "openducktor": {
                "documents": {
                    "spec": [{"markdown": "# Spec content", "updatedAt": "2026-02-20T10:00:00Z", "updatedBy": "planner-agent", "sourceTool": ODT_SET_SPEC_SOURCE_TOOL, "revision": 1}],
                    "implementationPlan": [{"markdown": "# Plan content", "updatedAt": "2026-02-20T11:00:00Z", "updatedBy": "planner-agent", "sourceTool": ODT_SET_PLAN_SOURCE_TOOL, "revision": 1}],
                    "qaReports": [{"markdown": "# QA Report", "verdict": "approved", "updatedAt": "2026-02-20T12:00:00Z", "updatedBy": "qa-agent", "sourceTool": ODT_QA_APPROVED_SOURCE_TOOL, "revision": 1}]
                },
                "agentSessions": [{
                    "externalSessionId": "ext-1",
                "taskId": "task-1",
                "role": "build",
                "status": "completed",
                "startedAt": "2026-02-20T09:00:00Z",
                "updatedAt": "2026-02-20T10:00:00Z",
                "endedAt": "2026-02-20T10:00:00Z",
                "runtimeId": "runtime-1",
                "runtimeKind": "opencode",
                "runId": "run-1",
                "baseUrl": "http://localhost:8080",
                "workingDirectory": "/tmp/work",
                "selectedModel": null
                }]
            }
        })),
    );
    let runner =
        MockCommandRunner::with_steps(vec![MockStep::WithEnv(Ok(json!([issue]).to_string()))]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let metadata = store.get_task_metadata(repo.path(), "task-1")?;
    assert_eq!(metadata.spec.markdown, "# Spec content");
    assert_eq!(
        metadata.spec.updated_at.as_deref(),
        Some("2026-02-20T10:00:00Z")
    );
    assert!(metadata.spec.error.is_none());
    assert_eq!(metadata.plan.markdown, "# Plan content");
    assert_eq!(
        metadata.plan.updated_at.as_deref(),
        Some("2026-02-20T11:00:00Z")
    );
    assert!(metadata.plan.error.is_none());
    let qa = metadata.qa_report.expect("qa_report should be present");
    assert_eq!(qa.markdown, "# QA Report");
    assert_eq!(qa.verdict, QaWorkflowVerdict::Approved);
    assert_eq!(qa.revision, Some(1));
    assert!(qa.error.is_none());
    assert_eq!(metadata.agent_sessions.len(), 1);
    assert_eq!(metadata.agent_sessions[0].external_session_id, "ext-1");
    assert_eq!(metadata.agent_sessions[0].role, "build");

    let calls = runner.take_calls();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].program, "bd");
    assert!(calls[0].args.contains(&"show".to_string()));
    Ok(())
}

#[test]
fn get_task_metadata_handles_empty_metadata() -> Result<()> {
    let repo = RepoFixture::new("get-task-metadata-empty");
    let issue = issue_value("task-1", "open", "task", None, json!([]), None);
    let runner =
        MockCommandRunner::with_steps(vec![MockStep::WithEnv(Ok(json!([issue]).to_string()))]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner);

    let metadata = store.get_task_metadata(repo.path(), "task-1")?;
    assert!(metadata.spec.markdown.is_empty());
    assert!(metadata.spec.updated_at.is_none());
    assert!(metadata.spec.error.is_none());
    assert!(metadata.plan.markdown.is_empty());
    assert!(metadata.plan.updated_at.is_none());
    assert!(metadata.plan.error.is_none());
    assert!(metadata.qa_report.is_none());
    assert!(metadata.agent_sessions.is_empty());
    Ok(())
}

#[test]
fn clear_agent_sessions_by_roles_ignores_blank_role_inputs() -> Result<()> {
    let repo = RepoFixture::new("clear-agent-sessions-blank-roles");
    let runner = MockCommandRunner::with_steps(vec![]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    store.clear_agent_sessions_by_roles(repo.path(), "task-1", &["   "])?;

    let calls = runner.take_calls();
    assert!(calls.is_empty());
    Ok(())
}
