use super::*;

#[test]
fn get_task_uses_id_flag_when_loading_issue() -> Result<()> {
    let repo = RepoFixture::new("show-with-id-flag");
    let issue = issue_value("task-1", "open", "task", None, json!([]), None);
    let runner =
        MockCommandRunner::with_steps(vec![MockStep::WithEnv(Ok(json!([issue]).to_string()))]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let task = store.get_task(repo.path(), "task-1")?;
    assert_eq!(task.id, "task-1");

    let calls = runner.take_calls();
    assert_eq!(calls.len(), 1);
    assert_eq!(
        calls[0].args,
        vec!["show", "--id", "task-1", "--json"]
            .into_iter()
            .map(str::to_string)
            .collect::<Vec<_>>()
    );
    Ok(())
}

#[test]
fn get_task_rejects_invalid_issue_type_with_task_context() {
    let repo = RepoFixture::new("show-invalid-issue-type");
    let issue = issue_value("task-bad-type", "open", "decision", None, json!([]), None);
    let runner =
        MockCommandRunner::with_steps(vec![MockStep::WithEnv(Ok(json!([issue]).to_string()))]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner);

    let error = store
        .get_task(repo.path(), "task-bad-type")
        .expect_err("invalid issue type should fail");
    let message = error.to_string();
    assert!(message.contains("task-bad-type"));
    assert!(message.contains("issue type"));
    assert!(message.contains("decision"));
}

#[test]
fn get_task_reports_missing_tasks_with_task_context() {
    let repo = RepoFixture::new("show-missing-task");
    let runner = MockCommandRunner::with_steps(vec![MockStep::WithEnv(Ok(json!([]).to_string()))]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner);

    let error = store
        .get_task(repo.path(), "task-missing")
        .expect_err("missing task should fail");
    assert_eq!(error.to_string(), "Task not found: task-missing");
}

#[test]
fn list_tasks_rejects_invalid_status_with_task_context() {
    let repo = RepoFixture::new("list-invalid-status");
    let payload = json!([issue_value(
        "task-bad-status",
        "backlog",
        "task",
        None,
        json!([]),
        None
    )]);
    let runner = MockCommandRunner::with_steps(vec![MockStep::WithEnv(Ok(payload.to_string()))]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner);

    let error = store
        .list_tasks(repo.path())
        .expect_err("invalid status should fail");
    let message = error.to_string();
    assert!(message.contains("task-bad-status"));
    assert!(message.contains("status"));
    assert!(message.contains("backlog"));
}

#[test]
fn list_tasks_filters_events_and_populates_subtask_ids() -> Result<()> {
    let repo = RepoFixture::new("list-tasks");
    let payload = json!([
        issue_value(
            "task-parent",
            "open",
            "epic",
            None,
            json!([]),
            Some(json!({
                "openducktor": {
                    "qaRequired": true,
                    "documents": {
                        "spec": [
                            {
                                "markdown": "# Spec",
                                "updatedAt": "2026-02-20T09:00:00Z",
                                "updatedBy": "planner-agent",
                                "sourceTool": ODT_SET_SPEC_SOURCE_TOOL,
                                "revision": 1
                            }
                        ],
                        "qaReports": [
                            {
                                "markdown": "QA approved",
                                "verdict": "approved",
                                "updatedAt": "2026-02-20T10:00:00Z",
                                "updatedBy": "qa-agent",
                                "sourceTool": ODT_QA_APPROVED_SOURCE_TOOL,
                                "revision": 1
                            }
                        ]
                    }
                }
            }))
        ),
        issue_value(
            "task-child",
            "in_progress",
            "task",
            None,
            json!([{"type":"parent-child","depends_on_id":"task-parent"}]),
            None
        ),
        issue_value("task-event", "open", "event", None, json!([]), None),
        issue_value("task-gate", "open", "gate", None, json!([]), None)
    ]);
    let runner = MockCommandRunner::with_steps(vec![MockStep::WithEnv(Ok(payload.to_string()))]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let tasks = store.list_tasks(repo.path())?;
    assert_eq!(tasks.len(), 2);

    let parent = tasks
        .iter()
        .find(|task| task.id == "task-parent")
        .expect("parent task missing");
    assert_eq!(parent.subtask_ids, vec!["task-child".to_string()]);
    assert!(parent.document_summary.spec.has);
    assert_eq!(
        parent.document_summary.spec.updated_at.as_deref(),
        Some("2026-02-20T09:00:00Z")
    );
    assert!(!parent.document_summary.plan.has);
    assert!(parent.document_summary.qa_report.has);
    assert_eq!(
        parent.document_summary.qa_report.updated_at.as_deref(),
        Some("2026-02-20T10:00:00Z")
    );

    let child = tasks
        .iter()
        .find(|task| task.id == "task-child")
        .expect("child task missing");
    assert_eq!(child.parent_id.as_deref(), Some("task-parent"));
    assert!(!child.document_summary.spec.has);
    assert!(!child.document_summary.plan.has);
    assert!(!child.document_summary.qa_report.has);

    let calls = runner.take_calls();
    assert_eq!(calls.len(), 1);
    assert_eq!(
        calls[0].args,
        vec!["list", "--all", "--limit", "0", "--json"]
            .into_iter()
            .map(str::to_string)
            .collect::<Vec<_>>()
    );
    Ok(())
}

#[test]
fn list_tasks_keeps_qa_verdict_but_marks_missing_content_when_latest_markdown_is_empty(
) -> Result<()> {
    let repo = RepoFixture::new("list-qa-empty-markdown");
    let payload = json!([issue_value(
        "task-qa-empty",
        "open",
        "task",
        None,
        json!([]),
        Some(json!({
            "openducktor": {
                "qaRequired": true,
                "documents": {
                    "qaReports": [
                        {
                            "markdown": "previous qa",
                            "verdict": "approved",
                            "updatedAt": "2026-02-20T09:00:00Z",
                            "updatedBy": "qa-agent",
                            "sourceTool": ODT_QA_APPROVED_SOURCE_TOOL,
                            "revision": 1
                        },
                        {
                            "markdown": "   ",
                            "verdict": "rejected",
                            "updatedAt": "2026-02-20T10:00:00Z",
                            "updatedBy": "qa-agent",
                            "sourceTool": ODT_QA_REJECTED_SOURCE_TOOL,
                            "revision": 2
                        }
                    ]
                }
            }
        })),
    )]);
    let runner = MockCommandRunner::with_steps(vec![MockStep::WithEnv(Ok(payload.to_string()))]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner);

    let tasks = store.list_tasks(repo.path())?;
    assert_eq!(tasks.len(), 1);
    let task = &tasks[0];
    assert!(!task.document_summary.qa_report.has);
    assert!(task.document_summary.qa_report.updated_at.is_none());
    assert_eq!(
        task.document_summary.qa_report.verdict,
        host_domain::QaWorkflowVerdict::Rejected
    );
    Ok(())
}

#[test]
fn list_tasks_uses_short_lived_repo_cache() -> Result<()> {
    let repo = RepoFixture::new("list-cache-hit");
    let payload = json!([issue_value("task-1", "open", "task", None, json!([]), None)]);
    let runner = MockCommandRunner::with_steps(vec![MockStep::WithEnv(Ok(payload.to_string()))]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let first = store.list_tasks(repo.path())?;
    let second = store.list_tasks(repo.path())?;
    assert_eq!(first.len(), 1);
    assert_eq!(second.len(), 1);
    assert_eq!(second[0].id, "task-1");

    let calls = runner.take_calls();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].args[0], "list");
    Ok(())
}

#[test]
fn list_tasks_cache_is_invalidated_after_update_mutation() -> Result<()> {
    let repo = RepoFixture::new("list-cache-invalidate-update");
    let initial_list = json!([issue_value("task-1", "open", "task", None, json!([]), None)]);
    let updated_show = json!([issue_value(
        "task-1",
        "blocked",
        "task",
        None,
        json!([]),
        None
    )]);
    let refreshed_list = json!([issue_value(
        "task-1",
        "blocked",
        "task",
        None,
        json!([]),
        None
    )]);
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::WithEnv(Ok(initial_list.to_string())),
        MockStep::WithEnv(Ok("{}".to_string())),
        MockStep::WithEnv(Ok(updated_show.to_string())),
        MockStep::WithEnv(Ok(refreshed_list.to_string())),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let initial = store.list_tasks(repo.path())?;
    assert_eq!(initial[0].status, TaskStatus::Open);
    let updated = store.update_task(
        repo.path(),
        "task-1",
        UpdateTaskPatch {
            title: None,
            description: None,
            notes: None,
            status: Some(TaskStatus::Blocked),
            priority: None,
            issue_type: None,
            ai_review_enabled: None,
            labels: None,
            assignee: None,
            parent_id: None,
        },
    )?;
    assert_eq!(updated.status, TaskStatus::Blocked);
    let refreshed = store.list_tasks(repo.path())?;
    assert_eq!(refreshed[0].status, TaskStatus::Blocked);

    let calls = runner.take_calls();
    let list_calls = calls
        .iter()
        .filter(|call| call.args.first().map(String::as_str) == Some("list"))
        .count();
    assert_eq!(list_calls, 2);
    Ok(())
}

#[test]
fn list_tasks_cache_is_invalidated_after_metadata_mutation() -> Result<()> {
    let repo = RepoFixture::new("list-cache-invalidate-metadata");
    let initial_list = json!([issue_value("task-1", "open", "task", None, json!([]), None)]);
    let current_issue = issue_value("task-1", "open", "task", None, json!([]), None);
    let refreshed_list = json!([issue_value(
        "task-1",
        "open",
        "task",
        None,
        json!([]),
        Some(json!({
            "openducktor": {
                "documents": {
                    "spec": [{
                        "markdown": "# Spec",
                        "updatedAt": "2026-02-20T12:00:00Z",
                        "updatedBy": "planner-agent",
                        "sourceTool": ODT_SET_SPEC_SOURCE_TOOL,
                        "revision": 1
                    }]
                }
            }
        })),
    )]);
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::WithEnv(Ok(initial_list.to_string())),
        MockStep::WithEnv(Ok(json!([current_issue]).to_string())),
        MockStep::WithEnv(Ok("{}".to_string())),
        MockStep::WithEnv(Ok(refreshed_list.to_string())),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let initial = store.list_tasks(repo.path())?;
    assert!(!initial[0].document_summary.spec.has);
    store.set_spec(repo.path(), "task-1", "# Spec")?;
    let refreshed = store.list_tasks(repo.path())?;
    assert!(refreshed[0].document_summary.spec.has);

    let calls = runner.take_calls();
    let list_calls = calls
        .iter()
        .filter(|call| call.args.first().map(String::as_str) == Some("list"))
        .count();
    assert_eq!(list_calls, 2);
    Ok(())
}

#[test]
fn list_tasks_cache_expires_after_ttl() -> Result<()> {
    let repo = RepoFixture::new("list-cache-expiry");
    let initial_list = json!([issue_value("task-1", "open", "task", None, json!([]), None)]);
    let refreshed_list = json!([issue_value(
        "task-1",
        "blocked",
        "task",
        None,
        json!([]),
        None
    )]);
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::WithEnv(Ok(initial_list.to_string())),
        MockStep::WithEnv(Ok(refreshed_list.to_string())),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let initial = store.list_tasks(repo.path())?;
    assert_eq!(initial[0].status, TaskStatus::Open);
    std::thread::sleep(Duration::from_millis(TASK_LIST_CACHE_TTL_MS + 50));
    let refreshed = store.list_tasks(repo.path())?;
    assert_eq!(refreshed[0].status, TaskStatus::Blocked);

    let calls = runner.take_calls();
    let list_calls = calls
        .iter()
        .filter(|call| call.args.first().map(String::as_str) == Some("list"))
        .count();
    assert_eq!(list_calls, 2);
    Ok(())
}

#[test]
fn list_tasks_cache_is_invalidated_after_create_mutation() -> Result<()> {
    let repo = RepoFixture::new("list-cache-invalidate-create");
    let initial_list = json!([issue_value("task-1", "open", "task", None, json!([]), None)]);
    let created = issue_value("task-2", "open", "task", None, json!([]), None);
    let shown = issue_value("task-2", "open", "task", None, json!([]), None);
    let refreshed_list = json!([
        issue_value("task-1", "open", "task", None, json!([]), None),
        issue_value("task-2", "open", "task", None, json!([]), None)
    ]);
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::WithEnv(Ok(initial_list.to_string())),
        MockStep::WithEnv(Ok(created.to_string())),
        MockStep::WithEnv(Ok("{}".to_string())),
        MockStep::WithEnv(Ok(json!([shown]).to_string())),
        MockStep::WithEnv(Ok(refreshed_list.to_string())),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let initial = store.list_tasks(repo.path())?;
    assert_eq!(initial.len(), 1);
    let created_task = store.create_task(
        repo.path(),
        CreateTaskInput {
            title: "New task".to_string(),
            issue_type: IssueType::Task,
            priority: 2,
            description: None,
            labels: None,
            ai_review_enabled: Some(true),
            parent_id: None,
        },
    )?;
    assert_eq!(created_task.id, "task-2");
    let refreshed = store.list_tasks(repo.path())?;
    assert_eq!(refreshed.len(), 2);
    assert!(refreshed.iter().any(|task| task.id == "task-2"));

    let calls = runner.take_calls();
    let list_calls = calls
        .iter()
        .filter(|call| call.args.first().map(String::as_str) == Some("list"))
        .count();
    assert_eq!(list_calls, 2);
    Ok(())
}

#[test]
fn list_tasks_cache_is_invalidated_after_delete_mutation() -> Result<()> {
    let repo = RepoFixture::new("list-cache-invalidate-delete");
    let initial_list = json!([issue_value("task-1", "open", "task", None, json!([]), None)]);
    let refreshed_list = json!([]);
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::WithEnv(Ok(initial_list.to_string())),
        MockStep::WithEnv(Ok("done".to_string())),
        MockStep::WithEnv(Ok(refreshed_list.to_string())),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let initial = store.list_tasks(repo.path())?;
    assert_eq!(initial.len(), 1);
    assert!(store.delete_task(repo.path(), "task-1", false)?);
    let refreshed = store.list_tasks(repo.path())?;
    assert!(refreshed.is_empty());

    let calls = runner.take_calls();
    let list_calls = calls
        .iter()
        .filter(|call| call.args.first().map(String::as_str) == Some("list"))
        .count();
    assert_eq!(list_calls, 2);
    Ok(())
}

#[test]
fn stale_generation_cache_writes_are_ignored() -> Result<()> {
    let repo = RepoFixture::new("list-cache-generation-guard");
    let payload = json!([issue_value("task-1", "open", "task", None, json!([]), None)]);
    let runner = MockCommandRunner::with_steps(vec![MockStep::WithEnv(Ok(payload.to_string()))]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let stale_generation = store.task_list_cache_generation_for_repo(repo.path())?;
    store.invalidate_task_list_cache(repo.path())?;
    store.cache_task_list_for_repo_if_generation(
        repo.path(),
        "openducktor",
        stale_generation,
        &[],
    )?;
    let tasks = store.list_tasks(repo.path())?;
    assert_eq!(tasks.len(), 1);

    let calls = runner.take_calls();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].args[0], "list");
    Ok(())
}

#[test]
fn get_task_metadata_ignores_cached_task_list_metadata() -> Result<()> {
    let repo = RepoFixture::new("metadata-read-bypasses-task-list-cache");
    let stale = issue_value(
        "task-1",
        "open",
        "task",
        None,
        json!([]),
        Some(json!({
            "openducktor": {"documents": {"spec": [{
                "markdown": "# Stale spec",
                "updatedAt": "2026-02-20T10:00:00Z",
                "updatedBy": "planner-agent",
                "sourceTool": ODT_SET_SPEC_SOURCE_TOOL,
                "revision": 1
            }]}}
        })),
    );
    let fresh = issue_value(
        "task-1",
        "open",
        "task",
        None,
        json!([]),
        Some(json!({
            "openducktor": {"documents": {"spec": [{
                "markdown": "# Fresh spec",
                "updatedAt": "2026-02-20T11:00:00Z",
                "updatedBy": "planner-agent",
                "sourceTool": ODT_SET_SPEC_SOURCE_TOOL,
                "revision": 2
            }]}}
        })),
    );
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::WithEnv(Ok(json!([stale]).to_string())),
        MockStep::WithEnv(Ok(json!([fresh]).to_string())),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let _ = store.list_tasks(repo.path())?;
    let metadata = store.get_task_metadata(repo.path(), "task-1")?;
    assert_eq!(metadata.spec.markdown, "# Fresh spec");
    assert_eq!(
        metadata.spec.updated_at.as_deref(),
        Some("2026-02-20T11:00:00Z")
    );

    let calls = runner.take_calls();
    assert_eq!(calls.len(), 2);
    assert_eq!(calls[0].args[0], "list");
    assert_eq!(calls[1].args[0], "show");
    Ok(())
}

#[test]
fn list_tasks_for_kanban_requests_recent_closed_tasks() -> Result<()> {
    let repo = RepoFixture::new("kanban-list-recent-closed");
    let open_tasks = json!([issue_value("task-1", "open", "task", None, json!([]), None)]);
    let recent_closed = json!([issue_value(
        "task-2",
        "closed",
        "task",
        None,
        json!([]),
        None
    )]);
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::WithEnv(Ok(open_tasks.to_string())),
        MockStep::WithEnv(Ok(recent_closed.to_string())),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let earliest_cutoff = (Utc::now() - ChronoDuration::days(1))
        .format("%Y-%m-%d")
        .to_string();
    let tasks = store.list_tasks_for_kanban(repo.path(), 1)?;
    let latest_cutoff = (Utc::now() - ChronoDuration::days(1))
        .format("%Y-%m-%d")
        .to_string();
    assert_eq!(tasks.len(), 2);
    assert!(tasks.iter().any(|task| task.id == "task-1"));
    assert!(tasks.iter().any(|task| task.id == "task-2"));

    let calls = runner.take_calls();
    assert_eq!(calls.len(), 2);
    assert_eq!(calls[0].args[0], "list");
    assert_eq!(calls[0].args[1], "--limit");
    assert_eq!(calls[0].args[2], "0");
    assert_eq!(calls[1].args[0], "list");
    assert!(calls[1]
        .args
        .windows(2)
        .any(|pair| pair == ["--status", "closed"]));
    let actual_cutoff = calls[1]
        .args
        .windows(2)
        .find_map(|pair| (pair[0] == "--closed-after").then(|| pair[1].clone()))
        .expect("expected --closed-after argument");
    assert!(
        actual_cutoff >= earliest_cutoff && actual_cutoff <= latest_cutoff,
        "unexpected cutoff: {actual_cutoff}"
    );
    Ok(())
}

#[test]
fn list_tasks_for_kanban_skips_closed_fetch_for_zero_days() -> Result<()> {
    let repo = RepoFixture::new("kanban-list-zero-days");
    let open_tasks = json!([issue_value("task-1", "open", "task", None, json!([]), None)]);
    let runner = MockCommandRunner::with_steps(vec![MockStep::WithEnv(Ok(open_tasks.to_string()))]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let tasks = store.list_tasks_for_kanban(repo.path(), 0)?;
    assert_eq!(tasks.len(), 1);

    let calls = runner.take_calls();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].args[0], "list");
    Ok(())
}

#[test]
fn list_tasks_for_kanban_cache_key_includes_done_visible_days() -> Result<()> {
    let repo = RepoFixture::new("kanban-list-cache-key");
    let open_tasks = json!([issue_value("task-1", "open", "task", None, json!([]), None)]);
    let closed_tasks = json!([issue_value(
        "task-2",
        "closed",
        "task",
        None,
        json!([]),
        None
    )]);
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::WithEnv(Ok(open_tasks.to_string())),
        MockStep::WithEnv(Ok(closed_tasks.to_string())),
        MockStep::WithEnv(Ok(open_tasks.to_string())),
        MockStep::WithEnv(Ok(closed_tasks.to_string())),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let first = store.list_tasks_for_kanban(repo.path(), 1)?;
    let second = store.list_tasks_for_kanban(repo.path(), 1)?;
    let third = store.list_tasks_for_kanban(repo.path(), 7)?;
    assert_eq!(first.len(), 2);
    assert_eq!(second.len(), 2);
    assert_eq!(third.len(), 2);

    let calls = runner.take_calls();
    let list_calls = calls
        .iter()
        .filter(|call| call.args.first().map(String::as_str) == Some("list"))
        .count();
    assert_eq!(list_calls, 4);
    Ok(())
}

#[test]
fn create_task_normalizes_payload_and_persists_qa_flag() -> Result<()> {
    let repo = RepoFixture::new("create-task");
    let created = issue_value("task-1", "open", "feature", None, json!([]), None);
    let shown = issue_value(
        "task-1",
        "open",
        "feature",
        Some("epic-1"),
        json!([]),
        Some(json!({"openducktor": {"qaRequired": false}})),
    );
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::WithEnv(Ok(created.to_string())),
        MockStep::WithEnv(Ok("{}".to_string())),
        MockStep::WithEnv(Ok(json!([shown]).to_string())),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let task = store.create_task(
        repo.path(),
        CreateTaskInput {
            title: "Build API".to_string(),
            issue_type: IssueType::Feature,
            priority: 3,
            description: Some("  expose endpoint ".to_string()),
            labels: Some(vec![
                "backend".to_string(),
                "api".to_string(),
                "backend".to_string(),
                "".to_string(),
            ]),
            ai_review_enabled: Some(false),
            parent_id: Some(" epic-1 ".to_string()),
        },
    )?;

    assert_eq!(task.id, "task-1");
    assert!(!task.ai_review_enabled);
    let calls = runner.take_calls();
    assert_eq!(calls.len(), 3);
    assert_eq!(calls[0].program, "bd");
    assert_eq!(calls[0].args[0], "create");
    let metadata_root = metadata_from_call(&calls[1]);
    assert_eq!(
        metadata_root["openducktor"]["qaRequired"],
        Value::Bool(false)
    );
    assert_eq!(calls[1].args[0], "update");
    assert_eq!(calls[1].args.last().map(String::as_str), Some("task-1"));
    Ok(())
}

#[test]
fn update_task_updates_cli_fields_and_qa_metadata() -> Result<()> {
    let repo = RepoFixture::new("update-task");
    let current = issue_value(
        "task-1",
        "open",
        "task",
        None,
        json!([]),
        Some(json!({"openducktor": {}})),
    );
    let updated = issue_value(
        "task-1",
        "blocked",
        "feature",
        Some("parent-1"),
        json!([]),
        Some(json!({"openducktor": {"qaRequired": false}})),
    );
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::WithEnv(Ok("{}".to_string())),
        MockStep::WithEnv(Ok(json!([current]).to_string())),
        MockStep::WithEnv(Ok("{}".to_string())),
        MockStep::WithEnv(Ok(json!([updated]).to_string())),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let task = store.update_task(
        repo.path(),
        "task-1",
        UpdateTaskPatch {
            title: Some("Renamed".to_string()),
            description: Some("Updated description".to_string()),
            notes: Some("Updated notes".to_string()),
            status: Some(TaskStatus::Blocked),
            priority: Some(1),
            issue_type: Some(IssueType::Feature),
            ai_review_enabled: Some(false),
            labels: Some(vec![
                "backend".to_string(),
                "api".to_string(),
                "backend".to_string(),
            ]),
            assignee: Some("alice".to_string()),
            parent_id: Some(" parent-1 ".to_string()),
        },
    )?;
    assert_eq!(task.status, TaskStatus::Blocked);
    assert_eq!(task.parent_id.as_deref(), Some("parent-1"));

    let calls = runner.take_calls();
    assert_eq!(calls.len(), 4);
    assert_eq!(calls[0].args[0], "update");
    let metadata_root = metadata_from_call(&calls[2]);
    assert_eq!(
        metadata_root["openducktor"]["qaRequired"],
        Value::Bool(false)
    );
    Ok(())
}

#[test]
fn update_task_can_update_only_ai_review_metadata() -> Result<()> {
    let repo = RepoFixture::new("update-task-metadata");
    let current = issue_value(
        "task-1",
        "open",
        "task",
        None,
        json!([]),
        Some(json!({"openducktor": {"qaRequired": false}})),
    );
    let updated = issue_value(
        "task-1",
        "open",
        "task",
        None,
        json!([]),
        Some(json!({"openducktor": {"qaRequired": true}})),
    );
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::WithEnv(Ok(json!([current]).to_string())),
        MockStep::WithEnv(Ok("{}".to_string())),
        MockStep::WithEnv(Ok(json!([updated]).to_string())),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let task = store.update_task(
        repo.path(),
        "task-1",
        UpdateTaskPatch {
            title: None,
            description: None,
            notes: None,
            status: None,
            priority: None,
            issue_type: None,
            ai_review_enabled: Some(true),
            labels: None,
            assignee: None,
            parent_id: None,
        },
    )?;
    assert!(task.ai_review_enabled);

    let calls = runner.take_calls();
    assert_eq!(calls.len(), 3);
    assert_eq!(calls[0].args[0], "show");
    assert_eq!(calls[1].args[0], "update");
    let metadata_root = metadata_from_call(&calls[1]);
    assert_eq!(
        metadata_root["openducktor"]["qaRequired"],
        Value::Bool(true)
    );
    Ok(())
}

#[test]
fn delete_task_forwards_cascade_flag() -> Result<()> {
    let repo = RepoFixture::new("delete-task");
    let runner = MockCommandRunner::with_steps(vec![MockStep::WithEnv(Ok("done".to_string()))]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    assert!(store.delete_task(repo.path(), "task-1", true)?);
    let calls = runner.take_calls();
    assert_eq!(calls.len(), 1);
    assert!(!calls[0].args.iter().any(|entry| entry == "--reason"));
    assert!(calls[0].args.iter().any(|entry| entry == "--cascade"));
    assert!(calls[0].args.iter().any(|entry| entry == "--"));
    assert_eq!(calls[0].args.last().map(String::as_str), Some("task-1"));
    Ok(())
}
