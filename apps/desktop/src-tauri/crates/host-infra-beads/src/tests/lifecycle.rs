use super::*;
use crate::lifecycle::BeadsLifecycle;

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
    assert!(!BeadsLifecycle::reason_requires_shared_database_seed(
        "attachment metadata is malformed"
    ));
}
