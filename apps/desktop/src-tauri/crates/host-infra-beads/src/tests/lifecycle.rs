use super::*;
use crate::lifecycle::BeadsLifecycle;

#[test]
fn verify_repo_initialized_parse_errors_do_not_include_raw_output() -> Result<()> {
    let repo = RepoFixture::new("where-parse-redaction");
    let sensitive = "secret-path";
    let beads_dir = resolve_repo_beads_attachment_dir(repo.path())?;
    write_attachment_metadata(&beads_dir, repo.path(), 3307);
    let runner = MockCommandRunner::with_steps(vec![MockStep::AllowFailureWithEnv(Ok((
        true,
        format!("invalid-json-{sensitive}"),
        String::new(),
    )))]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner);

    let error = store
        .lifecycle
        .verify_repo_initialized(repo.path(), &beads_dir)
        .expect_err("invalid where payload should fail");
    let message = error.to_string();
    assert!(message.contains("Failed to parse `bd where --json` output"));
    assert!(!message.contains(sensitive));
    Ok(())
}

#[test]
fn verify_repo_initialized_reads_json_errors_from_nonzero_exit() -> Result<()> {
    let repo = RepoFixture::new("where-json-error");
    let beads_dir = resolve_repo_beads_attachment_dir(repo.path())?;
    write_attachment_metadata(&beads_dir, repo.path(), 3307);
    let runner = MockCommandRunner::with_steps(vec![MockStep::AllowFailureWithEnv(Ok((
        false,
        json!({
            "error": "database \"beads\" not found"
        })
        .to_string(),
        String::new(),
    )))]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner);

    let (is_ready, reason) = store
        .lifecycle
        .verify_repo_initialized(repo.path(), &beads_dir)?;
    assert!(!is_ready);
    assert_eq!(reason, "database \"beads\" not found");
    Ok(())
}

#[test]
fn lifecycle_repo_init_caches_success_only_after_custom_status_configuration() -> Result<()> {
    let repo = RepoFixture::new("lifecycle-config-before-cache");
    let beads_dir = resolve_repo_beads_attachment_dir(repo.path())?;
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::AllowFailureWithEnv(Ok((
            true,
            json!({
                "path": beads_dir,
                "prefix": "openducktor"
            })
            .to_string(),
            String::new(),
        ))),
        MockStep::WithEnv(Err("status config failed".to_string())),
        MockStep::AllowFailureWithEnv(Ok((
            true,
            json!({
                "path": beads_dir,
                "prefix": "openducktor"
            })
            .to_string(),
            String::new(),
        ))),
        MockStep::WithEnv(Ok("configured statuses".to_string())),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());
    write_attachment_metadata(&beads_dir, repo.path(), 3307);

    let error = store
        .ensure_repo_initialized(repo.path())
        .expect_err("status configuration should fail readiness");
    assert!(error
        .to_string()
        .contains("Failed to configure custom statuses"));

    store.ensure_repo_initialized(repo.path())?;

    let calls = runner.take_calls();
    assert_eq!(calls.len(), 4);
    assert_eq!(calls[0].args, vec!["where", "--json"]);
    assert_eq!(
        calls[1].args,
        vec!["config", "set", "status.custom", CUSTOM_STATUS_VALUES]
    );
    assert_eq!(calls[2].args, vec!["where", "--json"]);
    assert_eq!(
        calls[3].args,
        vec!["config", "set", "status.custom", CUSTOM_STATUS_VALUES]
    );
    Ok(())
}

#[test]
fn lifecycle_verifier_only_restores_for_missing_shared_database_reasons() {
    assert!(BeadsLifecycle::reason_requires_shared_database_seed(
        "database \"odt_demo_deadbeef\" not found on Dolt server"
    ));
    assert!(BeadsLifecycle::reason_requires_shared_database_seed(
        "Error 1049: unknown database"
    ));
    assert!(!BeadsLifecycle::reason_requires_shared_database_seed(
        "server not reachable"
    ));
    assert!(!BeadsLifecycle::reason_requires_shared_database_seed(
        "dolt server unreachable"
    ));
    assert!(!BeadsLifecycle::reason_requires_shared_database_seed(
        "attachment metadata is malformed"
    ));
}

#[test]
fn ensure_repo_initialized_repairs_when_verifier_reports_connectivity_error() -> Result<()> {
    for reason in ["server not reachable", "dolt server unreachable"] {
        let repo = RepoFixture::new("init-connectivity-error");
        let beads_dir = resolve_repo_beads_attachment_dir(repo.path())?;
        write_attachment_metadata(&beads_dir, repo.path(), 3307);
        fs::write(beads_dir.join("beads.db"), "stale").expect("beads.db should be writable");
        let runner = MockCommandRunner::with_steps(vec![
            MockStep::AllowFailureWithEnv(Ok((false, String::new(), reason.to_string()))),
            MockStep::WithEnv(Ok("doctor fixed".to_string())),
            MockStep::AllowFailureWithEnv(Ok((
                true,
                json!({
                    "path": beads_dir,
                    "prefix": "openducktor"
                })
                .to_string(),
                String::new(),
            ))),
            MockStep::WithEnv(Ok("configured statuses".to_string())),
        ]);
        let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

        store.ensure_repo_initialized(repo.path())?;

        let calls = runner.take_calls();
        assert_eq!(calls[1].args, vec!["doctor", "--fix", "--yes"]);
        assert!(!calls.iter().any(|call| call.program == "dolt"));
    }
    Ok(())
}

#[test]
fn ensure_repo_initialized_errors_when_existing_store_is_still_not_ready_after_repair() {
    let repo = RepoFixture::new("init-still-unready-after-repair");
    let beads_dir = resolve_repo_beads_attachment_dir(repo.path()).expect("expected beads dir");
    write_attachment_metadata(&beads_dir, repo.path(), 3307);
    fs::write(beads_dir.join("beads.db"), "stale").expect("beads.db should be writable");
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::AllowFailureWithEnv(Ok((false, String::new(), "bd where failed".to_string()))),
        MockStep::WithEnv(Ok("doctor fixed".to_string())),
        MockStep::AllowFailureWithEnv(Ok((
            false,
            String::new(),
            "attachment still points at the wrong database".to_string(),
        ))),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let error = store
        .ensure_repo_initialized(repo.path())
        .expect_err("existing store should fail instead of re-running init");
    assert!(error
        .to_string()
        .contains("Beads repair completed but store is still not ready"));

    let calls = runner.take_calls();
    assert_eq!(calls.len(), 3);
    assert_eq!(calls[1].args, vec!["doctor", "--fix", "--yes"]);
    assert!(!calls
        .iter()
        .any(|call| call.args.first().map(String::as_str) == Some("init")));
}
