use super::*;
use crate::command_runner::CommandRunner;
use crate::lifecycle::RepoReadiness;
use host_domain::{
    RepoStoreHealthCategory, RepoStoreHealthStatus, RepoStoreSharedServerOwnershipState,
};
use host_infra_system::{
    is_process_alive, resolve_repo_beads_attachment_root, resolve_server_state_file,
    SharedDoltServerAcquisition, SharedDoltServerState,
};
use std::path::Path;
use std::sync::{Arc, Condvar, LazyLock, Mutex};

static ENV_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

#[derive(Default)]
struct BlockingInitRunner {
    state: (Mutex<BlockingInitState>, Condvar),
}

#[derive(Default)]
struct BlockingInitState {
    entered: bool,
    released: bool,
}

impl BlockingInitRunner {
    fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    fn wait_until_entered(&self) {
        let (lock, condvar) = &self.state;
        let mut state = lock.lock().expect("blocking init state poisoned");
        while !state.entered {
            state = condvar
                .wait(state)
                .expect("blocking init wait should not poison");
        }
    }

    fn release(&self) {
        let (lock, condvar) = &self.state;
        let mut state = lock.lock().expect("blocking init state poisoned");
        state.released = true;
        condvar.notify_all();
    }
}

impl CommandRunner for BlockingInitRunner {
    fn uses_real_processes(&self) -> bool {
        false
    }

    fn run_with_env(
        &self,
        _program: &str,
        _args: &[&str],
        _cwd: Option<&Path>,
        _env: &[(&str, &str)],
    ) -> Result<String> {
        panic!("unexpected run_with_env call in blocking init runner");
    }

    fn run_allow_failure_with_env(
        &self,
        _program: &str,
        args: &[&str],
        _cwd: Option<&Path>,
        _env: &[(&str, &str)],
    ) -> Result<(bool, String, String)> {
        assert_eq!(args.first().copied(), Some("init"));

        let (lock, condvar) = &self.state;
        let mut state = lock.lock().expect("blocking init state poisoned");
        state.entered = true;
        condvar.notify_all();

        while !state.released {
            state = condvar
                .wait(state)
                .expect("blocking init wait should not poison");
        }

        Ok((false, String::new(), "init blocked for test".to_string()))
    }
}

#[test]
fn verify_repo_initialized_parse_errors_do_not_include_raw_output() -> Result<()> {
    let repo = RepoFixture::new("where-parse-redaction");
    let sensitive = "secret-path";
    let beads_dir = resolve_repo_beads_attachment_dir(repo.path())?;
    let database_name = compute_beads_database_name(repo.path())?;
    write_attachment_metadata(&beads_dir, repo.path(), 3307);
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::AllowFailureWithEnv(Ok((true, format!("| {database_name} |"), String::new()))),
        MockStep::AllowFailureWithEnv(Ok((
            true,
            format!("invalid-json-{sensitive}"),
            String::new(),
        ))),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner);

    let error = store
        .lifecycle
        .verify_repo_initialized(repo.path(), &beads_dir)
        .expect_err("invalid where payload should fail");
    let message = error.to_string();
    assert!(message.contains("Failed to decode `bd where --json` payload"));
    assert!(!message.contains(sensitive));
    Ok(())
}

#[test]
fn verify_repo_initialized_reads_json_errors_from_nonzero_exit() -> Result<()> {
    let repo = RepoFixture::new("where-json-error");
    let beads_dir = resolve_repo_beads_attachment_dir(repo.path())?;
    let database_name = compute_beads_database_name(repo.path())?;
    write_attachment_metadata(&beads_dir, repo.path(), 3307);
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::AllowFailureWithEnv(Ok((true, format!("| {database_name} |"), String::new()))),
        MockStep::AllowFailureWithEnv(Ok((
            false,
            json!({
                "error": "database \"beads\" not found"
            })
            .to_string(),
            String::new(),
        ))),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner);

    let readiness = store
        .lifecycle
        .verify_repo_initialized(repo.path(), &beads_dir)?;
    assert_eq!(
        readiness,
        RepoReadiness::AttachmentVerificationFailed {
            reason: "database \"beads\" not found".to_string(),
        }
    );
    Ok(())
}

#[test]
fn diagnose_repo_store_reports_healthy_attachment_and_server() -> Result<()> {
    let repo = RepoFixture::new("diagnose-healthy");
    let _env_lock = ENV_LOCK.lock().expect("env lock poisoned");
    let config_root = repo.path().join("config-root");
    let previous_config_dir = std::env::var_os("OPENDUCKTOR_CONFIG_DIR");
    unsafe {
        std::env::set_var("OPENDUCKTOR_CONFIG_DIR", &config_root);
    }
    let beads_dir = resolve_repo_beads_attachment_dir(repo.path())?;
    let database_name = compute_beads_database_name(repo.path())?;
    fs::create_dir_all(&beads_dir)?;
    fs::write(
        beads_dir.join("metadata.json"),
        json!({
            "backend": "dolt",
            "dolt_mode": "server",
            "dolt_server_host": "127.0.0.1",
            "dolt_server_port": 3307,
            "dolt_server_user": "root",
            "dolt_database": database_name,
        })
        .to_string(),
    )?;
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::AllowFailureWithEnv(Ok((true, format!("| {database_name} |"), String::new()))),
        MockStep::AllowFailureWithEnv(Ok((
            true,
            json!({
                "path": beads_dir,
                "prefix": "openducktor"
            })
            .to_string(),
            String::new(),
        ))),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner);

    let health = store.diagnose_repo_store(repo.path())?;

    match previous_config_dir {
        Some(value) => unsafe {
            std::env::set_var("OPENDUCKTOR_CONFIG_DIR", value);
        },
        None => unsafe {
            std::env::remove_var("OPENDUCKTOR_CONFIG_DIR");
        },
    }

    assert_eq!(health.category, RepoStoreHealthCategory::Healthy);
    assert_eq!(health.status, RepoStoreHealthStatus::Ready);
    assert!(health.is_ready);
    assert_eq!(
        health.attachment.path.as_deref(),
        Some(beads_dir.to_string_lossy().as_ref())
    );
    assert_eq!(
        health.attachment.database_name.as_deref(),
        Some(database_name.as_str())
    );
    assert_eq!(health.shared_server.host.as_deref(), Some("127.0.0.1"));
    assert!(health.shared_server.port.is_some());
    assert_eq!(
        health.shared_server.ownership_state,
        RepoStoreSharedServerOwnershipState::Unavailable
    );
    Ok(())
}

#[test]
fn diagnose_repo_store_reports_initializing_while_repo_init_is_in_progress() -> Result<()> {
    let repo = RepoFixture::new("diagnose-initializing");
    let runner = BlockingInitRunner::new();
    let store = Arc::new(BeadsTaskStore::with_test_runner(
        "openducktor",
        runner.clone(),
    ));
    let repo_path = repo.path().to_path_buf();
    let init_store = store.clone();

    let init_handle = std::thread::spawn(move || init_store.ensure_repo_initialized(&repo_path));
    runner.wait_until_entered();

    let health = store.diagnose_repo_store(repo.path())?;

    runner.release();
    let init_result = init_handle.join().expect("init thread should join");

    assert!(init_result.is_err());
    assert_eq!(health.category, RepoStoreHealthCategory::Initializing);
    assert_eq!(health.status, RepoStoreHealthStatus::Initializing);
    assert!(!health.is_ready);
    assert!(health
        .detail
        .as_deref()
        .unwrap_or_default()
        .contains("initialization is in progress"));
    Ok(())
}

#[test]
fn diagnose_repo_store_does_not_report_reused_owner_for_dead_foreign_pid() -> Result<()> {
    let repo = RepoFixture::new("diagnose-dead-foreign-owner");
    let _env_lock = ENV_LOCK.lock().expect("env lock poisoned");
    let config_root = repo.path().join("config-root");
    let previous_config_dir = std::env::var_os("OPENDUCKTOR_CONFIG_DIR");
    unsafe {
        std::env::set_var("OPENDUCKTOR_CONFIG_DIR", &config_root);
    }

    let beads_dir = resolve_repo_beads_attachment_dir(repo.path())?;
    let database_name = compute_beads_database_name(repo.path())?;
    fs::create_dir_all(&beads_dir)?;
    fs::write(
        beads_dir.join("metadata.json"),
        json!({
            "backend": "dolt",
            "dolt_mode": "server",
            "dolt_server_host": "127.0.0.1",
            "dolt_server_port": 3307,
            "dolt_server_user": "root",
            "dolt_database": database_name,
        })
        .to_string(),
    )?;

    let dead_owner_pid = u32::MAX;
    assert!(!is_process_alive(dead_owner_pid));

    let state_file = resolve_server_state_file()?;
    if let Some(parent) = state_file.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(
        &state_file,
        serde_json::to_string(&SharedDoltServerState {
            pid: std::process::id(),
            owner_pid: dead_owner_pid,
            acquisition: SharedDoltServerAcquisition::StartedByOwner,
            host: "127.0.0.1".to_string(),
            user: "root".to_string(),
            port: 3307,
            shared_server_root: config_root.join("shared-server"),
            dolt_data_dir: config_root.join("dolt-data"),
            started_at: "2026-02-20T12:00:00Z".to_string(),
        })?,
    )?;

    let runner = MockCommandRunner::with_steps(vec![
        MockStep::AllowFailureWithEnv(Ok((true, format!("| {database_name} |"), String::new()))),
        MockStep::AllowFailureWithEnv(Ok((
            true,
            json!({
                "path": beads_dir,
                "prefix": "openducktor"
            })
            .to_string(),
            String::new(),
        ))),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner);

    let health = store.diagnose_repo_store(repo.path())?;

    match previous_config_dir {
        Some(value) => unsafe {
            std::env::set_var("OPENDUCKTOR_CONFIG_DIR", value);
        },
        None => unsafe {
            std::env::remove_var("OPENDUCKTOR_CONFIG_DIR");
        },
    }

    assert_eq!(health.category, RepoStoreHealthCategory::Healthy);
    assert_eq!(health.status, RepoStoreHealthStatus::Ready);
    assert!(health.is_ready);
    assert_eq!(health.shared_server.host.as_deref(), Some("127.0.0.1"));
    assert_eq!(health.shared_server.port, Some(3307));
    assert_eq!(
        health.shared_server.ownership_state,
        RepoStoreSharedServerOwnershipState::Unavailable
    );
    Ok(())
}

#[test]
fn diagnose_repo_store_reports_restore_needed_when_shared_database_is_missing() -> Result<()> {
    let repo = RepoFixture::new("diagnose-restore-needed");
    let _env_lock = ENV_LOCK.lock().expect("env lock poisoned");
    let config_root = repo.path().join("config-root");
    let previous_config_dir = std::env::var_os("OPENDUCKTOR_CONFIG_DIR");
    unsafe {
        std::env::set_var("OPENDUCKTOR_CONFIG_DIR", &config_root);
    }
    let beads_dir = resolve_repo_beads_attachment_dir(repo.path())?;
    let database_name = compute_beads_database_name(repo.path())?;
    fs::create_dir_all(&beads_dir)?;
    fs::write(
        beads_dir.join("metadata.json"),
        json!({
            "backend": "dolt",
            "dolt_mode": "server",
            "dolt_server_host": "127.0.0.1",
            "dolt_server_port": 3307,
            "dolt_server_user": "root",
            "dolt_database": database_name,
        })
        .to_string(),
    )?;
    let runner = MockCommandRunner::with_steps(vec![MockStep::AllowFailureWithEnv(Ok((
        true,
        "| information_schema |".to_string(),
        String::new(),
    )))]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner);

    let health = store.diagnose_repo_store(repo.path())?;

    match previous_config_dir {
        Some(value) => unsafe {
            std::env::set_var("OPENDUCKTOR_CONFIG_DIR", value);
        },
        None => unsafe {
            std::env::remove_var("OPENDUCKTOR_CONFIG_DIR");
        },
    }

    assert_eq!(
        health.category,
        RepoStoreHealthCategory::MissingSharedDatabase
    );
    assert_eq!(health.status, RepoStoreHealthStatus::RestoreNeeded);
    assert!(!health.is_ready);
    assert_eq!(
        health.attachment.database_name.as_deref(),
        Some(database_name.as_str())
    );
    assert!(health
        .detail
        .as_deref()
        .unwrap_or_default()
        .contains("restore is required"));
    Ok(())
}

#[test]
fn diagnose_repo_store_reports_attachment_contract_mismatch() -> Result<()> {
    let repo = RepoFixture::new("diagnose-contract-mismatch");
    let _env_lock = ENV_LOCK.lock().expect("env lock poisoned");
    let config_root = repo.path().join("config-root");
    let previous_config_dir = std::env::var_os("OPENDUCKTOR_CONFIG_DIR");
    unsafe {
        std::env::set_var("OPENDUCKTOR_CONFIG_DIR", &config_root);
    }
    let beads_dir = resolve_repo_beads_attachment_dir(repo.path())?;
    fs::create_dir_all(&beads_dir)?;
    let database_name = compute_beads_database_name(repo.path())?;
    fs::write(
        beads_dir.join("metadata.json"),
        json!({
            "backend": "dolt",
            "dolt_mode": "server",
            "dolt_server_host": "127.0.0.1",
            "dolt_server_port": 3308,
            "dolt_server_user": "root",
            "dolt_database": database_name,
        })
        .to_string(),
    )?;
    let runner = MockCommandRunner::with_steps(vec![]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner);

    let health = store.diagnose_repo_store(repo.path())?;

    match previous_config_dir {
        Some(value) => unsafe {
            std::env::set_var("OPENDUCKTOR_CONFIG_DIR", value);
        },
        None => unsafe {
            std::env::remove_var("OPENDUCKTOR_CONFIG_DIR");
        },
    }

    assert_eq!(
        health.category,
        RepoStoreHealthCategory::AttachmentContractInvalid
    );
    assert_eq!(health.status, RepoStoreHealthStatus::Blocking);
    assert!(!health.is_ready);
    assert!(health
        .detail
        .as_deref()
        .unwrap_or_default()
        .contains("Beads attachment port is"));
    Ok(())
}

#[test]
fn diagnose_repo_store_reports_missing_attachment_when_state_and_attachment_are_missing(
) -> Result<()> {
    let repo = RepoFixture::new("diagnose-missing-shared-server");
    let _env_lock = ENV_LOCK.lock().expect("env lock poisoned");
    let config_root = repo.path().join("config-root");
    let previous_config_dir = std::env::var_os("OPENDUCKTOR_CONFIG_DIR");
    unsafe {
        std::env::set_var("OPENDUCKTOR_CONFIG_DIR", &config_root);
    }
    let runner = MockCommandRunner::with_steps_using_real_processes(vec![]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner);

    let health = store.diagnose_repo_store(repo.path())?;

    match previous_config_dir {
        Some(value) => unsafe {
            std::env::set_var("OPENDUCKTOR_CONFIG_DIR", value);
        },
        None => unsafe {
            std::env::remove_var("OPENDUCKTOR_CONFIG_DIR");
        },
    }

    assert_eq!(health.category, RepoStoreHealthCategory::MissingAttachment);
    assert_eq!(health.status, RepoStoreHealthStatus::Blocking);
    assert!(!health.is_ready);
    assert_eq!(health.shared_server.host, None);
    assert_eq!(health.shared_server.port, None);
    assert!(health
        .detail
        .as_deref()
        .unwrap_or_default()
        .contains("Beads attachment is missing"));
    Ok(())
}

#[test]
fn diagnose_repo_store_uses_attachment_metadata_when_shared_server_state_is_missing() -> Result<()>
{
    let repo = RepoFixture::new("diagnose-missing-state-uses-metadata");
    let _env_lock = ENV_LOCK.lock().expect("env lock poisoned");
    let config_root = repo.path().join("config-root");
    let previous_config_dir = std::env::var_os("OPENDUCKTOR_CONFIG_DIR");
    unsafe {
        std::env::set_var("OPENDUCKTOR_CONFIG_DIR", &config_root);
    }
    let beads_dir = resolve_repo_beads_attachment_dir(repo.path())?;
    let database_name = compute_beads_database_name(repo.path())?;
    fs::create_dir_all(&beads_dir)?;
    fs::write(
        beads_dir.join("metadata.json"),
        json!({
            "backend": "dolt",
            "dolt_mode": "server",
            "dolt_server_host": "127.0.0.1",
            "dolt_server_port": 3307,
            "dolt_server_user": "root",
            "dolt_database": database_name,
        })
        .to_string(),
    )?;
    let runner = MockCommandRunner::with_steps_using_real_processes(vec![
        MockStep::AllowFailureWithEnv(Ok((true, format!("| {database_name} |"), String::new()))),
        MockStep::AllowFailureWithEnv(Ok((
            true,
            json!({
                "path": beads_dir,
                "prefix": "openducktor"
            })
            .to_string(),
            String::new(),
        ))),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner);

    let health = store.diagnose_repo_store(repo.path())?;

    match previous_config_dir {
        Some(value) => unsafe {
            std::env::set_var("OPENDUCKTOR_CONFIG_DIR", value);
        },
        None => unsafe {
            std::env::remove_var("OPENDUCKTOR_CONFIG_DIR");
        },
    }

    assert_eq!(health.category, RepoStoreHealthCategory::Healthy);
    assert_eq!(health.status, RepoStoreHealthStatus::Ready);
    assert!(health.is_ready);
    assert_eq!(health.shared_server.host.as_deref(), Some("127.0.0.1"));
    assert_eq!(health.shared_server.port, Some(3307));
    assert_eq!(
        health.shared_server.ownership_state,
        RepoStoreSharedServerOwnershipState::Unavailable
    );
    Ok(())
}

#[test]
fn diagnose_repo_store_rejects_wrong_database_when_shared_server_state_is_missing() -> Result<()> {
    let repo = RepoFixture::new("diagnose-missing-state-wrong-database");
    let _env_lock = ENV_LOCK.lock().expect("env lock poisoned");
    let config_root = repo.path().join("config-root");
    let previous_config_dir = std::env::var_os("OPENDUCKTOR_CONFIG_DIR");
    unsafe {
        std::env::set_var("OPENDUCKTOR_CONFIG_DIR", &config_root);
    }
    let beads_dir = resolve_repo_beads_attachment_dir(repo.path())?;
    let database_name = compute_beads_database_name(repo.path())?;
    fs::create_dir_all(&beads_dir)?;
    fs::write(
        beads_dir.join("metadata.json"),
        json!({
            "backend": "dolt",
            "dolt_mode": "server",
            "dolt_server_host": "127.0.0.1",
            "dolt_server_port": 3307,
            "dolt_server_user": "root",
            "dolt_database": format!("{database_name}_wrong"),
        })
        .to_string(),
    )?;
    let runner = MockCommandRunner::with_steps_using_real_processes(vec![]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner);

    let health = store.diagnose_repo_store(repo.path())?;

    match previous_config_dir {
        Some(value) => unsafe {
            std::env::set_var("OPENDUCKTOR_CONFIG_DIR", value);
        },
        None => unsafe {
            std::env::remove_var("OPENDUCKTOR_CONFIG_DIR");
        },
    }

    assert_eq!(
        health.category,
        RepoStoreHealthCategory::AttachmentContractInvalid
    );
    assert_eq!(health.status, RepoStoreHealthStatus::Blocking);
    assert!(!health.is_ready);
    assert!(health
        .detail
        .as_deref()
        .unwrap_or_default()
        .contains("Beads attachment database is"));
    Ok(())
}

#[test]
fn verify_repo_initialized_prefers_decodable_stderr_json_over_noisy_stdout() -> Result<()> {
    let repo = RepoFixture::new("where-stderr-json-wins");
    let beads_dir = resolve_repo_beads_attachment_dir(repo.path())?;
    let database_name = compute_beads_database_name(repo.path())?;
    write_attachment_metadata(&beads_dir, repo.path(), 3307);
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::AllowFailureWithEnv(Ok((true, format!("| {database_name} |"), String::new()))),
        MockStep::AllowFailureWithEnv(Ok((
            false,
            "bd debug log line".to_string(),
            "warning before json\n{\"error\":\"database \\\"beads\\\" not found\"}".to_string(),
        ))),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner);

    let readiness = store
        .lifecycle
        .verify_repo_initialized(repo.path(), &beads_dir)?;
    assert_eq!(
        readiness,
        RepoReadiness::AttachmentVerificationFailed {
            reason: "database \"beads\" not found".to_string(),
        }
    );
    Ok(())
}

#[test]
fn verify_repo_initialized_accepts_noisy_stdout_before_json_payload() -> Result<()> {
    let repo = RepoFixture::new("where-noisy-stdout-before-json");
    let beads_dir = resolve_repo_beads_attachment_dir(repo.path())?;
    let database_name = compute_beads_database_name(repo.path())?;
    write_attachment_metadata(&beads_dir, repo.path(), 3307);
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::AllowFailureWithEnv(Ok((true, format!("| {database_name} |"), String::new()))),
        MockStep::AllowFailureWithEnv(Ok((
            true,
            format!(
                "warning before payload\n{}",
                json!({
                    "path": beads_dir,
                    "prefix": "openducktor"
                })
            ),
            String::new(),
        ))),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner);

    let readiness = store
        .lifecycle
        .verify_repo_initialized(repo.path(), &beads_dir)?;
    assert_eq!(readiness, RepoReadiness::Ready);
    Ok(())
}

#[test]
fn verify_repo_initialized_does_not_let_unrelated_stderr_json_shadow_stdout() -> Result<()> {
    let repo = RepoFixture::new("where-unrelated-stderr-json");
    let beads_dir = resolve_repo_beads_attachment_dir(repo.path())?;
    let database_name = compute_beads_database_name(repo.path())?;
    write_attachment_metadata(&beads_dir, repo.path(), 3307);
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::AllowFailureWithEnv(Ok((true, format!("| {database_name} |"), String::new()))),
        MockStep::AllowFailureWithEnv(Ok((
            true,
            json!({
                "path": beads_dir,
                "prefix": "openducktor"
            })
            .to_string(),
            "{\"level\":\"warn\"}".to_string(),
        ))),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner);

    let readiness = store
        .lifecycle
        .verify_repo_initialized(repo.path(), &beads_dir)?;
    assert_eq!(readiness, RepoReadiness::Ready);
    Ok(())
}

#[test]
fn verify_repo_initialized_rejects_where_payloads_with_path_and_error() -> Result<()> {
    let repo = RepoFixture::new("where-path-and-error");
    let beads_dir = resolve_repo_beads_attachment_dir(repo.path())?;
    let database_name = compute_beads_database_name(repo.path())?;
    write_attachment_metadata(&beads_dir, repo.path(), 3307);
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::AllowFailureWithEnv(Ok((true, format!("| {database_name} |"), String::new()))),
        MockStep::AllowFailureWithEnv(Ok((
            true,
            json!({
                "path": beads_dir,
                "error": "unexpected-error"
            })
            .to_string(),
            String::new(),
        ))),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner);

    let error = store
        .lifecycle
        .verify_repo_initialized(repo.path(), &beads_dir)
        .expect_err("payloads with both path and error should fail fast");
    assert!(error
        .to_string()
        .contains("bd where --json returned both path and error"));
    Ok(())
}

#[test]
fn lifecycle_repo_init_caches_success_only_after_custom_status_configuration() -> Result<()> {
    let repo = RepoFixture::new("lifecycle-config-before-cache");
    let beads_dir = resolve_repo_beads_attachment_dir(repo.path())?;
    let database_name = compute_beads_database_name(repo.path())?;
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::AllowFailureWithEnv(Ok((true, format!("| {database_name} |"), String::new()))),
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
        MockStep::AllowFailureWithEnv(Ok((true, format!("| {database_name} |"), String::new()))),
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
    assert_eq!(calls.len(), 6);
    assert_eq!(calls[0].program, "dolt");
    assert_eq!(
        calls[0].args.last().expect("expected sql query"),
        "show databases"
    );
    assert_eq!(calls[1].args, vec!["where", "--json"]);
    assert_eq!(
        calls[2].args,
        vec!["config", "set", "status.custom", CUSTOM_STATUS_VALUES]
    );
    assert_eq!(calls[3].program, "dolt");
    assert_eq!(
        calls[3].args.last().expect("expected sql query"),
        "show databases"
    );
    assert_eq!(calls[4].args, vec!["where", "--json"]);
    assert_eq!(
        calls[5].args,
        vec!["config", "set", "status.custom", CUSTOM_STATUS_VALUES]
    );
    Ok(())
}

#[test]
fn ensure_repo_initialized_uses_init_for_missing_attachment() -> Result<()> {
    let repo = RepoFixture::new("missing-attachment");
    let beads_dir = resolve_repo_beads_attachment_dir(repo.path())?;
    let database_name = compute_beads_database_name(repo.path())?;
    let effective_port = match read_shared_dolt_server_state()? {
        Some(state) => state.port,
        None => 3307,
    };
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::AllowFailureWithEnvAndWrites {
            result: Ok((true, String::new(), String::new())),
            writes: vec![(
                beads_dir.join("metadata.json"),
                json!({
                    "backend": "dolt",
                    "dolt_mode": "server",
                    "dolt_server_host": "127.0.0.1",
                    "dolt_server_port": effective_port,
                    "dolt_server_user": "root",
                    "dolt_database": database_name,
                })
                .to_string(),
            )],
        },
        MockStep::AllowFailureWithEnv(Ok((true, format!("| {database_name} |"), String::new()))),
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
    assert_eq!(calls[0].args.first().expect("expected subcommand"), "init");
    assert_eq!(calls[1].program, "dolt");
    assert_eq!(
        calls[1].args.last().expect("expected sql query"),
        "show databases"
    );
    assert_eq!(calls[2].args, vec!["where", "--json"]);
    assert_eq!(
        calls[3].args,
        vec!["config", "set", "status.custom", CUSTOM_STATUS_VALUES]
    );
    assert!(!calls
        .iter()
        .any(|call| call.args == vec!["doctor", "--fix", "--yes"]));
    assert!(!calls
        .iter()
        .any(|call| call.program == "dolt"
            && call.args.first().map(String::as_str) == Some("backup")));
    Ok(())
}

#[test]
fn ensure_repo_initialized_surfaces_stdout_when_init_fails() -> Result<()> {
    let repo = RepoFixture::new("init-failure-stdout");
    let runner = MockCommandRunner::with_steps(vec![MockStep::AllowFailureWithEnv(Ok((
        false,
        "init failed from stdout".to_string(),
        String::new(),
    )))]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let error = store
        .ensure_repo_initialized(repo.path())
        .expect_err("stdout diagnostics should be preserved for bd init failures");
    assert!(error.to_string().contains("init failed from stdout"));

    let calls = runner.take_calls();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].args.first().expect("expected subcommand"), "init");
    Ok(())
}

#[test]
fn ensure_repo_initialized_initializes_in_attachment_root_with_stealth() -> Result<()> {
    let repo = RepoFixture::new("init-stealth");
    let attachment_root = resolve_repo_beads_attachment_root(repo.path())?;
    let beads_dir = resolve_repo_beads_attachment_dir(repo.path())?;
    let database_name = compute_beads_database_name(repo.path())?;
    let effective_port = match read_shared_dolt_server_state()? {
        Some(state) => state.port,
        None => 3307,
    };
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::AllowFailureWithEnvAndWrites {
            result: Ok((true, String::new(), String::new())),
            writes: vec![(
                beads_dir.join("metadata.json"),
                json!({
                    "backend": "dolt",
                    "dolt_mode": "server",
                    "dolt_server_host": "127.0.0.1",
                    "dolt_server_port": effective_port,
                    "dolt_server_user": "root",
                    "dolt_database": database_name,
                })
                .to_string(),
            )],
        },
        MockStep::AllowFailureWithEnv(Ok((true, format!("| {database_name} |"), String::new()))),
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
    assert_eq!(calls.len(), 4);
    assert_eq!(calls[0].args[0], "init");
    assert!(calls[0].args.iter().any(|arg| arg == "--stealth"));
    assert_eq!(calls[0].cwd.as_deref(), Some(attachment_root.as_path()));
    assert_eq!(calls[1].program, "dolt");
    assert_eq!(
        calls[1].args.last().expect("expected sql query"),
        "show databases"
    );
    assert_eq!(calls[2].args, vec!["where", "--json"]);
    assert_eq!(calls[2].cwd.as_deref(), Some(attachment_root.as_path()));
    assert_eq!(
        calls[3].args,
        vec!["config", "set", "status.custom", CUSTOM_STATUS_VALUES]
    );
    assert_eq!(calls[3].cwd.as_deref(), Some(attachment_root.as_path()));
    Ok(())
}

#[test]
fn ensure_repo_initialized_enforces_no_git_ops_for_existing_attachment() -> Result<()> {
    let repo = RepoFixture::new("existing-no-git-ops");
    let beads_dir = resolve_repo_beads_attachment_dir(repo.path())?;
    let attachment_root = resolve_repo_beads_attachment_root(repo.path())?;
    let database_name = compute_beads_database_name(repo.path())?;
    write_attachment_metadata(&beads_dir, repo.path(), 3307);
    fs::write(
        beads_dir.join("config.yaml"),
        "json: true\n  no-git-ops: false   # keep me\n",
    )
    .expect("config.yaml should be writable");
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::AllowFailureWithEnv(Ok((true, format!("| {database_name} |"), String::new()))),
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

    let config =
        fs::read_to_string(beads_dir.join("config.yaml")).expect("config.yaml should be readable");
    assert!(config.contains("json: true"));
    assert!(config.contains("  no-git-ops: true   # keep me"));
    assert!(!config.contains("no-git-ops: false"));
    assert_eq!(calls.len(), 3);
    assert_eq!(calls[0].program, "dolt");
    assert_eq!(
        calls[0].args.last().expect("expected sql query"),
        "show databases"
    );
    assert_eq!(calls[1].args, vec!["where", "--json"]);
    assert_eq!(calls[1].cwd.as_deref(), Some(attachment_root.as_path()));
    assert_eq!(
        calls[2].args,
        vec!["config", "set", "status.custom", CUSTOM_STATUS_VALUES]
    );
    assert_eq!(calls[2].cwd.as_deref(), Some(attachment_root.as_path()));
    Ok(())
}

#[test]
fn ensure_repo_initialized_restores_when_shared_database_is_missing() -> Result<()> {
    let repo = RepoFixture::new("missing-shared-database");
    let beads_dir = resolve_repo_beads_attachment_dir(repo.path())?;
    let backup_dir = beads_dir.join("backup");
    let database_name = compute_beads_database_name(repo.path())?;
    write_attachment_metadata(&beads_dir, repo.path(), 3307);
    fs::create_dir_all(&backup_dir).expect("backup dir should be writable");
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::AllowFailureWithEnv(Ok((true, "| other_database |".to_string(), String::new()))),
        MockStep::WithEnv(Ok("restored backup".to_string())),
        MockStep::AllowFailureWithEnv(Ok((true, format!("| {database_name} |"), String::new()))),
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
    assert_eq!(calls[0].program, "dolt");
    assert_eq!(calls[1].program, "dolt");
    assert_eq!(calls[1].args[0], "backup");
    assert_eq!(calls[1].args[1], "restore");
    assert_eq!(calls[1].args[2], format!("file://{}", backup_dir.display()));
    assert_eq!(calls[1].args[3], database_name);
    assert_eq!(calls[2].program, "dolt");
    assert_eq!(calls[3].args, vec!["where", "--json"]);
    assert!(!calls
        .iter()
        .any(|call| call.args == vec!["doctor", "--fix", "--yes"]));
    assert!(!calls
        .iter()
        .any(|call| call.args.first().map(String::as_str) == Some("init")));
    Ok(())
}

#[test]
fn verify_repo_initialized_treats_file_attachment_path_as_missing_attachment() -> Result<()> {
    let repo = RepoFixture::new("attachment-path-is-file");
    let beads_dir = resolve_repo_beads_attachment_dir(repo.path())?;
    fs::create_dir_all(
        beads_dir
            .parent()
            .expect("beads dir should have a parent attachment root"),
    )
    .expect("attachment root should be writable");
    fs::write(&beads_dir, "not-a-directory").expect("attachment path file should be writable");
    let runner = MockCommandRunner::with_steps(vec![]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let readiness = store
        .lifecycle
        .verify_repo_initialized(repo.path(), &beads_dir)?;
    assert_eq!(readiness, RepoReadiness::MissingAttachment);

    let calls = runner.take_calls();
    assert!(calls.is_empty());
    Ok(())
}

#[test]
fn ensure_repo_initialized_fails_fast_for_broken_metadata() -> Result<()> {
    let repo = RepoFixture::new("broken-metadata");
    let beads_dir = resolve_repo_beads_attachment_dir(repo.path())?;
    fs::create_dir_all(&beads_dir).expect("beads dir should be writable");
    fs::write(beads_dir.join("metadata.json"), "not-json").expect("metadata should be writable");
    let runner = MockCommandRunner::with_steps(vec![]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let error = store
        .ensure_repo_initialized(repo.path())
        .expect_err("broken metadata should fail without repair fallback");
    assert!(error
        .to_string()
        .contains("Beads attachment contract is invalid"));

    let calls = runner.take_calls();
    assert!(calls.is_empty());
    Ok(())
}

#[test]
fn verify_repo_initialized_fails_when_where_path_cannot_be_canonicalized() -> Result<()> {
    let repo = RepoFixture::new("uncanonicalizable-where-path");
    let beads_dir = resolve_repo_beads_attachment_dir(repo.path())?;
    let database_name = compute_beads_database_name(repo.path())?;
    write_attachment_metadata(&beads_dir, repo.path(), 3307);
    let missing_path = beads_dir.join("missing-reported-path");
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::AllowFailureWithEnv(Ok((true, format!("| {database_name} |"), String::new()))),
        MockStep::AllowFailureWithEnv(Ok((
            true,
            json!({
                "path": missing_path,
                "prefix": "openducktor"
            })
            .to_string(),
            String::new(),
        ))),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner);

    let error = store
        .lifecycle
        .verify_repo_initialized(repo.path(), &beads_dir)
        .expect_err("non-canonicalizable reported paths should fail fast");
    assert!(error
        .to_string()
        .contains("Failed to canonicalize Beads attachment path reported by `bd where --json`"));
    Ok(())
}

#[test]
fn ensure_repo_initialized_fails_fast_for_malformed_where_output() -> Result<()> {
    let repo = RepoFixture::new("malformed-where-output");
    let beads_dir = resolve_repo_beads_attachment_dir(repo.path())?;
    let database_name = compute_beads_database_name(repo.path())?;
    write_attachment_metadata(&beads_dir, repo.path(), 3307);
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::AllowFailureWithEnv(Ok((true, format!("| {database_name} |"), String::new()))),
        MockStep::AllowFailureWithEnv(Ok((true, String::new(), String::new()))),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let error = store
        .ensure_repo_initialized(repo.path())
        .expect_err("malformed where output should fail without fallback recovery");
    assert!(error
        .to_string()
        .contains("bd where --json exited successfully but returned no JSON payload"));

    let calls = runner.take_calls();
    assert_eq!(calls.len(), 2);
    assert_eq!(calls[0].program, "dolt");
    assert_eq!(calls[1].args, vec!["where", "--json"]);
    assert!(!calls
        .iter()
        .any(|call| call.args.first().map(String::as_str) == Some("init")));
    assert!(!calls
        .iter()
        .any(|call| call.args == vec!["doctor", "--fix", "--yes"]));
    assert!(!calls
        .iter()
        .any(|call| call.program == "dolt"
            && call.args.first().map(String::as_str) == Some("backup")));
    Ok(())
}

#[test]
fn ensure_repo_initialized_fails_fast_for_non_json_where_failure_output() -> Result<()> {
    let repo = RepoFixture::new("non-json-where-failure-output");
    let beads_dir = resolve_repo_beads_attachment_dir(repo.path())?;
    let database_name = compute_beads_database_name(repo.path())?;
    write_attachment_metadata(&beads_dir, repo.path(), 3307);
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::AllowFailureWithEnv(Ok((true, format!("| {database_name} |"), String::new()))),
        MockStep::AllowFailureWithEnv(Ok((
            false,
            String::new(),
            "plain text failure output".to_string(),
        ))),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let error = store
        .ensure_repo_initialized(repo.path())
        .expect_err("non-JSON where failure output should fail without fallback recovery");
    assert!(error
        .to_string()
        .contains("bd where --json exited unsuccessfully without a decodable JSON payload"));

    let calls = runner.take_calls();
    assert_eq!(calls.len(), 2);
    assert_eq!(calls[0].program, "dolt");
    assert_eq!(calls[1].args, vec!["where", "--json"]);
    assert!(!calls
        .iter()
        .any(|call| call.args == vec!["doctor", "--fix", "--yes"]));
    assert!(!calls
        .iter()
        .any(|call| call.args.first().map(String::as_str) == Some("init")));
    assert!(!calls
        .iter()
        .any(|call| call.program == "dolt"
            && call.args.first().map(String::as_str) == Some("backup")));
    Ok(())
}

#[test]
fn ensure_repo_initialized_treats_bracket_prefixed_stderr_as_plain_text_failure() -> Result<()> {
    let repo = RepoFixture::new("bracket-prefixed-stderr-failure");
    let beads_dir = resolve_repo_beads_attachment_dir(repo.path())?;
    let database_name = compute_beads_database_name(repo.path())?;
    write_attachment_metadata(&beads_dir, repo.path(), 3307);
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::AllowFailureWithEnv(Ok((true, format!("| {database_name} |"), String::new()))),
        MockStep::AllowFailureWithEnv(Ok((
            false,
            String::new(),
            "[warn] server unreachable".to_string(),
        ))),
    ]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let error = store
        .ensure_repo_initialized(repo.path())
        .expect_err("bracket-prefixed stderr should stay a plain-text failure");
    assert!(error
        .to_string()
        .contains("bd where --json exited unsuccessfully without a decodable JSON payload"));

    let calls = runner.take_calls();
    assert_eq!(calls.len(), 2);
    assert_eq!(calls[0].program, "dolt");
    assert_eq!(calls[1].args, vec!["where", "--json"]);
    Ok(())
}

#[test]
fn ensure_repo_initialized_fails_fast_when_shared_dolt_probe_fails() -> Result<()> {
    let repo = RepoFixture::new("shared-dolt-unavailable");
    let beads_dir = resolve_repo_beads_attachment_dir(repo.path())?;
    write_attachment_metadata(&beads_dir, repo.path(), 3307);
    let runner = MockCommandRunner::with_steps(vec![MockStep::AllowFailureWithEnv(Ok((
        false,
        String::new(),
        "server not reachable".to_string(),
    )))]);
    let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

    let error = store
        .ensure_repo_initialized(repo.path())
        .expect_err("shared Dolt probe failure should not fall back to repair");
    assert!(error
        .to_string()
        .contains("Shared Dolt readiness probe failed"));

    let calls = runner.take_calls();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].program, "dolt");
    assert!(!calls
        .iter()
        .any(|call| call.args == vec!["doctor", "--fix", "--yes"]));
    assert!(!calls
        .iter()
        .any(|call| call.args.first().map(String::as_str) == Some("init")));
    Ok(())
}

#[test]
fn ensure_repo_initialized_succeeds_for_healthy_attachment_without_recovery() -> Result<()> {
    let repo = RepoFixture::new("healthy-attachment");
    let beads_dir = resolve_repo_beads_attachment_dir(repo.path())?;
    let database_name = compute_beads_database_name(repo.path())?;
    write_attachment_metadata(&beads_dir, repo.path(), 3307);
    let runner = MockCommandRunner::with_steps(vec![
        MockStep::AllowFailureWithEnv(Ok((true, format!("| {database_name} |"), String::new()))),
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
    assert_eq!(calls.len(), 3);
    assert_eq!(calls[0].program, "dolt");
    assert_eq!(calls[1].args, vec!["where", "--json"]);
    assert_eq!(
        calls[2].args,
        vec!["config", "set", "status.custom", CUSTOM_STATUS_VALUES]
    );
    assert!(!calls
        .iter()
        .any(|call| call.args == vec!["doctor", "--fix", "--yes"]));
    assert!(!calls
        .iter()
        .any(|call| call.args.first().map(String::as_str) == Some("init")));
    assert!(!calls
        .iter()
        .any(|call| call.program == "dolt"
            && call.args.first().map(String::as_str) == Some("backup")));
    Ok(())
}
