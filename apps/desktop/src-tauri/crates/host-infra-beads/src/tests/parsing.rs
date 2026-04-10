use super::*;

#[test]
fn metadata_namespace_roundtrip() {
    let root = parse_metadata_root(Some(json!({
        "openducktor": {
            "qaRequired": true
        },
        "other": {
            "keep": true
        }
    })));

    let namespace = metadata_namespace(&root, "openducktor").expect("namespace missing");
    assert_eq!(metadata_bool_qa_required(namespace), Some(true));
    assert!(root.contains_key("other"));
}

#[test]
fn normalize_helpers_keep_payloads_stable() {
    let labels = normalize_labels(vec![
        "backend".to_string(),
        " backend ".to_string(),
        "".to_string(),
        "api".to_string(),
    ]);
    assert_eq!(labels, vec!["api".to_string(), "backend".to_string()]);

    assert_eq!(
        normalize_text_option(Some("  value  ".to_string())),
        Some("value".to_string())
    );
    assert_eq!(normalize_text_option(Some("   ".to_string())), None);
}

#[test]
fn process_command_runner_executes_commands_with_and_without_failure() -> Result<()> {
    let runner = ProcessCommandRunner;
    let output = runner.run_with_env(
        "sh",
        &["-lc", "printf '%s' \"$ODT_BEADS_RUNNER_TEST\""],
        None,
        &[("ODT_BEADS_RUNNER_TEST", "ok")],
    )?;
    assert_eq!(output, "ok");

    let (ok, stdout, stderr) = runner.run_allow_failure_with_env(
        "sh",
        &["-lc", "echo stdout; echo stderr >&2; exit 9"],
        None,
        &[],
    )?;
    assert!(!ok);
    assert_eq!(stdout, "stdout");
    assert_eq!(stderr, "stderr");
    Ok(())
}

#[test]
fn beads_store_constructors_and_debug_are_stable() {
    let default_store = BeadsTaskStore::new();
    let blank_namespace_store = BeadsTaskStore::with_metadata_namespace("   ");
    let custom_namespace_store = BeadsTaskStore::with_metadata_namespace("custom");

    let default_debug = format!("{default_store:?}");
    let blank_debug = format!("{blank_namespace_store:?}");
    let custom_debug = format!("{custom_namespace_store:?}");

    assert!(default_debug.contains("BeadsTaskStore"));
    assert!(blank_debug.contains("openducktor"));
    assert!(custom_debug.contains("custom"));
}

#[test]
fn run_bd_json_parse_errors_do_not_include_raw_output() {
    let repo = RepoFixture::new("parse-redaction");
    let sensitive = "token-abc123";
    let runner =
        MockCommandRunner::with_steps(vec![MockStep::WithEnv(Ok(format!("not-json-{sensitive}")))]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner);

    let error = store
        .list_tasks(repo.path())
        .expect_err("invalid JSON should fail");
    let message = error.to_string();
    assert!(message.contains("Failed to parse bd JSON output from `bd list`"));
    assert!(!message.contains(sensitive));
}

#[test]
fn strict_issue_type_and_status_parsers_return_actionable_errors() {
    assert_eq!(
        parse_issue_type("task-1", "feature").expect("feature should parse"),
        IssueType::Feature
    );
    assert_eq!(
        parse_task_status("task-1", "blocked").expect("blocked should parse"),
        TaskStatus::Blocked
    );
    assert!(default_ai_review_enabled(&IssueType::Epic));
    assert!(default_ai_review_enabled(&IssueType::Bug));

    let issue_type_error = parse_issue_type("task-1", "unknown-type")
        .expect_err("unknown issue type should fail")
        .to_string();
    assert!(issue_type_error.contains("task-1"));
    assert!(issue_type_error.contains("issue type"));
    assert!(issue_type_error.contains("unknown-type"));

    let status_error = parse_task_status("task-1", "backlog")
        .expect_err("unknown status should fail")
        .to_string();
    assert!(status_error.contains("task-1"));
    assert!(status_error.contains("status"));
    assert!(status_error.contains("backlog"));
}

#[test]
fn markdown_and_qa_entry_parsers_reject_invalid_entries() {
    assert!(parse_markdown_entries(&json!([
        {
            "markdown": "# Spec",
            "encoding": DOCUMENT_ENCODING_GZIP_BASE64_V1,
            "updatedAt": "2026-02-17T12:34:56Z",
            "updatedBy": "planner-agent",
            "sourceTool": ODT_SET_SPEC_SOURCE_TOOL,
            "revision": 1
        },
        {
            "markdown": 42
        }
    ]))
    .is_none());

    assert!(parse_qa_entries(&json!([
        {
            "markdown": "# QA",
            "encoding": DOCUMENT_ENCODING_GZIP_BASE64_V1,
            "verdict": "approved",
            "updatedAt": "2026-02-17T13:10:00Z",
            "updatedBy": "qa-agent",
            "sourceTool": ODT_QA_APPROVED_SOURCE_TOOL,
            "revision": 2
        },
        {
            "verdict": "rejected"
        }
    ]))
    .is_none());

    let sessions = parse_agent_sessions(&json!([
        {
            "sessionId": "obp-session-1",
            "externalSessionId": "session-opencode-1",
            "role": "spec",
            "scenario": "spec_initial",
            "startedAt": "2026-02-18T17:20:00Z",
            "workingDirectory": "/repo",
            "selectedModel": {
                "providerId": "openai",
                "modelId": "gpt-5",
                "variant": "high",
                "opencodeAgent": "architect"
            }
        },
        {
            "sessionId": 123
        }
    ]))
    .expect("agent sessions");
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].session_id, "obp-session-1");
    assert_eq!(
        sessions[0].external_session_id.as_deref(),
        Some("session-opencode-1")
    );

    let legacy_sessions = parse_agent_sessions(&json!([
        {
            "sessionId": "legacy-planner-session",
            "externalSessionId": "legacy-opencode-session",
            "role": "planner",
            "scenario": "planner_revision",
            "startedAt": "2026-02-18T17:22:00Z",
            "runtimeKind": "opencode",
            "workingDirectory": "/repo",
            "selectedModel": null
        }
    ]))
    .expect("legacy agent sessions");
    assert_eq!(legacy_sessions.len(), 1);
    assert_eq!(legacy_sessions[0].scenario, "planner_initial");
}

#[test]
fn next_document_revision_rejects_u32_overflow() {
    let error = next_document_revision(
        Some(&json!([
            {
                "revision": 4294967295u64
            }
        ])),
        "openducktor.documents.spec",
    )
    .expect_err("u32::MAX revision should fail cleanly");

    assert!(error.to_string().contains(
        "Invalid existing openducktor.documents.spec metadata: revision exceeds supported range"
    ));
}

#[test]
fn revision_zero_is_rejected_in_both_validation_paths() {
    let revision_error = next_document_revision(
        Some(&json!([
            {
                "revision": 0
            }
        ])),
        "openducktor.documents.spec",
    )
    .expect_err("revision 0 should fail cleanly");

    assert!(revision_error.to_string().contains(
        "Invalid existing openducktor.documents.spec metadata at index 0: revision must be a positive integer"
    ));

    let plan = read_latest_markdown_document(
        Some(&json!([
            {
                "markdown": "# Plan",
                "updatedAt": "2026-02-20T12:00:00Z",
                "revision": 0
            }
        ])),
        "openducktor.documents.implementationPlan",
    );

    assert!(plan.markdown.is_empty());
    assert_eq!(plan.updated_at.as_deref(), Some("2026-02-20T12:00:00Z"));
    assert!(plan.revision.is_none());
    let error = plan
        .error
        .expect("revision 0 should surface a document error");
    assert!(error.contains("revision must be a positive integer"));
}

#[test]
#[ignore = "manual benchmark scaffold; run with cargo test -p host-infra-beads metadata_parsing_benchmark_scaffold -- --ignored --nocapture"]
fn metadata_parsing_benchmark_scaffold() {
    let markdown_payload = Value::Array(
        (0..200)
            .map(|index| {
                json!({
                    "markdown": format!("# Spec {index}\n\n{}", "detail ".repeat(32)),
                    "updatedAt": "2026-02-17T12:34:56Z",
                    "updatedBy": "planner-agent",
                    "sourceTool": ODT_SET_SPEC_SOURCE_TOOL,
                    "revision": index + 1
                })
            })
            .collect(),
    );
    let qa_payload = Value::Array(
        (0..200)
            .map(|index| {
                json!({
                    "markdown": format!("# QA {index}\n\n{}", "report ".repeat(48)),
                    "verdict": if index % 2 == 0 { "approved" } else { "rejected" },
                    "updatedAt": "2026-02-17T13:10:00Z",
                    "updatedBy": "qa-agent",
                    "sourceTool": if index % 2 == 0 {
                        ODT_QA_APPROVED_SOURCE_TOOL
                    } else {
                        ODT_QA_REJECTED_SOURCE_TOOL
                    },
                    "revision": index + 1
                })
            })
            .collect(),
    );
    let session_payload = Value::Array(
        (0..200)
            .map(|index| {
                json!({
                    "sessionId": format!("obp-session-{index}"),
                    "externalSessionId": format!("session-opencode-{index}"),
                    "role": "build",
                    "scenario": "build_default",
                    "startedAt": "2026-02-18T17:20:00Z",
                    "workingDirectory": "/repo",
                    "selectedModel": null
                })
            })
            .collect(),
    );

    let iterations = 200;
    let started = Instant::now();
    let mut parsed_entries = 0usize;

    for _ in 0..iterations {
        parsed_entries += parse_markdown_entries(&markdown_payload)
            .expect("expected markdown entries")
            .len();
        parsed_entries += parse_qa_entries(&qa_payload)
            .expect("expected qa entries")
            .len();
        parsed_entries += parse_agent_sessions(&session_payload)
            .expect("expected session entries")
            .len();
    }

    let expected_entries = iterations * 600;
    assert_eq!(parsed_entries, expected_entries);
    eprintln!(
        "metadata parsing benchmark scaffold: parsed {parsed_entries} entries in {:?}",
        started.elapsed()
    );
}
