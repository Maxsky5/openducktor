use super::{
    compute_beads_database_name, compute_repo_id, compute_repo_slug,
    deterministic_shared_dolt_port_candidate, ensure_shared_dolt_server_running, is_process_alive,
    process_matches_expected_dolt_server, read_shared_dolt_server_state, resolve_beads_root,
    resolve_default_worktree_base_dir, resolve_dolt_config_dir, resolve_dolt_config_file,
    resolve_effective_worktree_base_dir, resolve_repo_beads_attachment_dir,
    resolve_repo_beads_attachment_root, resolve_repo_beads_paths, resolve_repo_live_database_dir,
    resolve_server_lock_file, resolve_server_state_file, resolve_shared_dolt_root,
    resolve_shared_server_root, restore_shared_dolt_database_from_backup,
    stop_shared_dolt_server_for_current_owner, wrap_port_candidate, write_dolt_config_file,
    SharedDoltServerState, SHARED_DOLT_PORT_RANGE_LEN, SHARED_DOLT_PORT_RANGE_START,
    SHARED_DOLT_SERVER_HOST, SHARED_DOLT_SERVER_USER,
};
use anyhow::{anyhow, Result};
use host_test_support::{lock_env, EnvVarGuard};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use url::Url;

fn temp_config_root(label: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("time should be after epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("odt-shared-dolt-{label}-{nanos}"))
}

fn skip_if_dolt_unavailable() -> bool {
    crate::resolve_command_path("dolt")
        .expect("dolt resolution should not fail")
        .is_none()
}

#[test]
fn slug_sanitizes_to_ascii_and_collapses_separators() {
    let slug = compute_repo_slug(Path::new("/tmp/___My Repo___"));
    assert_eq!(slug, "my-repo");
}

#[test]
fn slug_falls_back_to_repo_when_empty() {
    let slug = compute_repo_slug(Path::new("///"));
    assert_eq!(slug, "repo");
}

#[test]
fn repo_id_is_stable_for_same_path() {
    let path = Path::new("/tmp/example-project");
    let first = compute_repo_id(path).expect("first id");
    let second = compute_repo_id(path).expect("second id");
    assert_eq!(first, second);
}

#[test]
fn repo_id_differs_for_different_paths_with_same_basename() {
    let first = compute_repo_id(Path::new("/tmp/a/project")).expect("first id");
    let second = compute_repo_id(Path::new("/tmp/b/project")).expect("second id");
    assert_ne!(first, second);
}

#[test]
fn beads_database_name_is_stable_for_same_repo() {
    let repo_path = temp_config_root("db-name-stable").join("OpenDucktor Repo");
    let first = compute_beads_database_name(&repo_path).expect("first database name");
    let second = compute_beads_database_name(&repo_path).expect("second database name");

    assert_eq!(first, second);
    assert!(first.starts_with("odt_openducktor_repo_"));
    assert!(first.len() <= 64);
}

#[test]
fn beads_database_name_differs_for_distinct_repo_paths_with_same_basename() {
    let temp_root = temp_config_root("db-name-diff");
    let first = compute_beads_database_name(&temp_root.join("a").join("project"))
        .expect("first database name");
    let second = compute_beads_database_name(&temp_root.join("b").join("project"))
        .expect("second database name");

    assert!(first.starts_with("odt_project_"));
    assert!(second.starts_with("odt_project_"));
    assert_ne!(first, second);
}

#[test]
fn shared_beads_helpers_use_expected_layouts() {
    let _env_lock = lock_env();
    let _override_guard = EnvVarGuard::remove("OPENDUCKTOR_CONFIG_DIR");

    let beads_root = resolve_beads_root().expect("beads root");
    let shared_root = resolve_shared_server_root().expect("shared root");
    let dolt_root = resolve_shared_dolt_root().expect("dolt root");
    let cfg_dir = resolve_dolt_config_dir().expect("cfg dir");
    let config_file = resolve_dolt_config_file().expect("config file");
    let state_file = resolve_server_state_file().expect("state file");
    let lock_file = resolve_server_lock_file().expect("lock file");

    assert!(beads_root.ends_with(Path::new(".openducktor").join("beads")));
    assert!(shared_root.ends_with(
        Path::new(".openducktor")
            .join("beads")
            .join("shared-server")
    ));
    assert!(dolt_root.ends_with(
        Path::new(".openducktor")
            .join("beads")
            .join("shared-server")
            .join("dolt")
    ));
    assert!(cfg_dir.ends_with(
        Path::new(".openducktor")
            .join("beads")
            .join("shared-server")
            .join(".doltcfg")
    ));
    assert!(config_file.ends_with(
        Path::new(".openducktor")
            .join("beads")
            .join("shared-server")
            .join("dolt-config.yaml")
    ));
    assert!(state_file.ends_with(
        Path::new(".openducktor")
            .join("beads")
            .join("shared-server")
            .join("server.json")
    ));
    assert!(lock_file.ends_with(
        Path::new(".openducktor")
            .join("beads")
            .join("shared-server")
            .join("server.lock")
    ));
}

#[test]
fn repo_attachment_helpers_use_expected_layouts() {
    let _env_lock = lock_env();
    let _override_guard = EnvVarGuard::set("OPENDUCKTOR_CONFIG_DIR", "/tmp/odt-config-root");
    let repo_path = Path::new("/tmp/openducktor-test/repo");
    let repo_id = compute_repo_id(repo_path).expect("repo id");

    let attachment_root =
        resolve_repo_beads_attachment_root(repo_path).expect("attachment root should resolve");
    let attachment_dir =
        resolve_repo_beads_attachment_dir(repo_path).expect("attachment dir should resolve");
    let live_db_dir =
        resolve_repo_live_database_dir(repo_path).expect("live db dir should resolve");
    let paths = resolve_repo_beads_paths(repo_path).expect("repo paths should resolve");

    assert_eq!(
        attachment_root,
        PathBuf::from("/tmp/odt-config-root/beads").join(&repo_id)
    );
    assert_eq!(attachment_dir, attachment_root.join(".beads"));
    assert_eq!(
        live_db_dir,
        PathBuf::from("/tmp/odt-config-root/beads/shared-server/dolt").join(&paths.database_name)
    );
    assert_eq!(paths.attachment_dir, attachment_dir);
    assert_eq!(paths.live_database_dir, live_db_dir);
}

#[test]
fn server_state_round_trip_reads_serialized_file() {
    let _env_lock = lock_env();
    let temp_root = std::env::temp_dir().join("odt-shared-dolt-state-test");
    let _override_guard = EnvVarGuard::set(
        "OPENDUCKTOR_CONFIG_DIR",
        temp_root.to_string_lossy().as_ref(),
    );
    let state_path = resolve_server_state_file().expect("state file should resolve");
    fs::create_dir_all(state_path.parent().expect("state parent")).expect("create state dir");
    let payload = SharedDoltServerState {
        pid: 12,
        owner_pid: 34,
        host: "127.0.0.1".to_string(),
        user: "root".to_string(),
        port: 36123,
        shared_server_root: resolve_shared_server_root().expect("shared root"),
        dolt_data_dir: resolve_shared_dolt_root().expect("dolt root"),
        started_at: "2026-04-08T00:00:00Z".to_string(),
    };
    fs::write(
        &state_path,
        serde_json::to_string(&payload).expect("serialize payload"),
    )
    .expect("write state payload");

    let loaded = read_shared_dolt_server_state()
        .expect("state should load")
        .expect("state should exist");
    assert_eq!(loaded, payload);

    let _ = fs::remove_dir_all(temp_root);
}

#[test]
fn deterministic_port_candidate_stays_in_reserved_range() {
    let _env_lock = lock_env();
    let _override_guard = EnvVarGuard::set("OPENDUCKTOR_CONFIG_DIR", "/tmp/odt-config-root");

    let port = deterministic_shared_dolt_port_candidate().expect("port candidate");
    assert!((SHARED_DOLT_PORT_RANGE_START
        ..(SHARED_DOLT_PORT_RANGE_START + SHARED_DOLT_PORT_RANGE_LEN))
        .contains(&port));
    assert_eq!(
        wrap_port_candidate(port, u32::from(SHARED_DOLT_PORT_RANGE_LEN)),
        port
    );
}

#[test]
fn process_liveness_detects_current_process() {
    assert!(is_process_alive(std::process::id()));
}

#[test]
fn current_process_is_not_mistaken_for_shared_dolt_server() {
    let temp_root = temp_config_root("process-identity");
    let matches = process_matches_expected_dolt_server(std::process::id(), &temp_root)
        .expect("process identity check should succeed");
    assert!(!matches);
}

#[test]
fn shared_dolt_config_quotes_paths_with_spaces() {
    let _env_lock = lock_env();
    let config_root = temp_config_root("config with spaces");
    let _override_guard = EnvVarGuard::set(
        "OPENDUCKTOR_CONFIG_DIR",
        config_root.to_string_lossy().as_ref(),
    );

    write_dolt_config_file(39280).expect("config file should be written");
    let config_file = resolve_dolt_config_file().expect("config file path should resolve");
    let contents = fs::read_to_string(config_file).expect("config file should be readable");

    assert!(contents.contains("data_dir: '"));
    assert!(contents.contains("cfg_dir: '"));
    assert!(contents.contains("privilege_file: '"));
    assert!(contents.contains("branch_control_file: '"));

    let _ = fs::remove_dir_all(config_root);
}

#[test]
fn default_worktree_base_dir_uses_expected_layout() {
    let _env_lock = lock_env();
    let _override_guard = EnvVarGuard::remove("OPENDUCKTOR_CONFIG_DIR");
    let resolved = resolve_default_worktree_base_dir(Path::new("/tmp/openducktor-test/repo"))
        .expect("worktree base dir");
    let as_string = resolved.to_string_lossy();
    assert!(as_string.contains(".openducktor/worktrees/"));
    assert!(!as_string.ends_with("/.beads"));
}

#[test]
fn effective_worktree_base_dir_prefers_configured_override() {
    let override_path = "/tmp/custom-worktrees";
    let resolved = resolve_effective_worktree_base_dir(
        Path::new("/tmp/openducktor-test/repo"),
        Some(override_path),
    )
    .expect("effective worktree base dir");
    assert_eq!(resolved, PathBuf::from(override_path));
}

#[test]
fn effective_worktree_base_dir_uses_default_when_override_missing() {
    let _env_lock = lock_env();
    let resolved =
        resolve_effective_worktree_base_dir(Path::new("/tmp/openducktor-test/repo"), None)
            .expect("effective worktree base dir");
    let expected = resolve_default_worktree_base_dir(Path::new("/tmp/openducktor-test/repo"))
        .expect("default worktree base dir");
    assert_eq!(resolved, expected);
}

#[test]
fn effective_worktree_base_dir_expands_home_shorthand_override() {
    let _env_lock = lock_env();
    let home = std::env::temp_dir().join("odt-worktree-home");
    let _home_guard = EnvVarGuard::set("HOME", home.to_string_lossy().as_ref());

    let resolved = resolve_effective_worktree_base_dir(
        Path::new("/tmp/openducktor-test/repo"),
        Some("~/custom-worktrees"),
    )
    .expect("effective worktree base dir");

    assert_eq!(resolved, home.join("custom-worktrees"));
}

#[test]
fn shared_dolt_server_reuses_healthy_state_for_same_root() -> Result<()> {
    if skip_if_dolt_unavailable() {
        return Ok(());
    }

    let _env_lock = lock_env();
    let config_root = temp_config_root("reuse");
    let _override_guard = EnvVarGuard::set(
        "OPENDUCKTOR_CONFIG_DIR",
        config_root.to_string_lossy().as_ref(),
    );

    let first = ensure_shared_dolt_server_running(1001)?;
    let second = ensure_shared_dolt_server_running(1001)?;

    assert_eq!(first.pid, second.pid);
    assert_eq!(first.port, second.port);
    assert!(is_process_alive(first.pid));

    assert!(stop_shared_dolt_server_for_current_owner(1001)?);
    let _ = fs::remove_dir_all(config_root);
    Ok(())
}

#[test]
fn shared_dolt_server_replaces_stale_state_files() -> Result<()> {
    if skip_if_dolt_unavailable() {
        return Ok(());
    }

    let _env_lock = lock_env();
    let config_root = temp_config_root("stale-state");
    let _override_guard = EnvVarGuard::set(
        "OPENDUCKTOR_CONFIG_DIR",
        config_root.to_string_lossy().as_ref(),
    );

    let shared_root = resolve_shared_server_root()?;
    let dolt_root = resolve_shared_dolt_root()?;
    let state_file = resolve_server_state_file()?;
    fs::create_dir_all(&shared_root)?;
    fs::write(
        &state_file,
        serde_json::to_string(&SharedDoltServerState {
            pid: 999_999,
            owner_pid: 2002,
            host: "127.0.0.1".to_string(),
            user: "root".to_string(),
            port: 39999,
            shared_server_root: shared_root.clone(),
            dolt_data_dir: dolt_root,
            started_at: "2026-04-08T00:00:00Z".to_string(),
        })?,
    )?;

    let replacement = ensure_shared_dolt_server_running(2002)?;
    assert_ne!(replacement.pid, 999_999);
    assert_ne!(replacement.port, 39999);
    assert!(is_process_alive(replacement.pid));

    assert!(stop_shared_dolt_server_for_current_owner(2002)?);
    let _ = fs::remove_dir_all(config_root);
    Ok(())
}

#[test]
fn shared_dolt_shutdown_only_stops_matching_owner() -> Result<()> {
    if skip_if_dolt_unavailable() {
        return Ok(());
    }

    let _env_lock = lock_env();
    let config_root = temp_config_root("owner");
    let _override_guard = EnvVarGuard::set(
        "OPENDUCKTOR_CONFIG_DIR",
        config_root.to_string_lossy().as_ref(),
    );

    let state = ensure_shared_dolt_server_running(3003)?;
    assert!(!stop_shared_dolt_server_for_current_owner(4004)?);
    assert!(is_process_alive(state.pid));
    assert!(stop_shared_dolt_server_for_current_owner(3003)?);

    let _ = fs::remove_dir_all(config_root);
    Ok(())
}

#[test]
fn shared_dolt_server_adopts_healthy_state_when_previous_owner_is_gone() -> Result<()> {
    if skip_if_dolt_unavailable() {
        return Ok(());
    }

    let _env_lock = lock_env();
    let config_root = temp_config_root("adopt-owner");
    let _override_guard = EnvVarGuard::set(
        "OPENDUCKTOR_CONFIG_DIR",
        config_root.to_string_lossy().as_ref(),
    );

    let first = ensure_shared_dolt_server_running(6006)?;
    let state_file = resolve_server_state_file()?;
    fs::write(
        &state_file,
        serde_json::to_string(&SharedDoltServerState {
            owner_pid: 999_999,
            ..first.clone()
        })?,
    )?;

    let adopted = ensure_shared_dolt_server_running(7007)?;
    let persisted = read_shared_dolt_server_state()?.expect("expected persisted shared state");

    assert_eq!(adopted.pid, first.pid);
    assert_eq!(adopted.port, first.port);
    assert_eq!(adopted.owner_pid, 7007);
    assert_eq!(persisted.owner_pid, 7007);

    assert!(stop_shared_dolt_server_for_current_owner(7007)?);
    let _ = fs::remove_dir_all(config_root);
    Ok(())
}

#[test]
fn shared_dolt_server_replaces_unhealthy_process_from_dead_owner() -> Result<()> {
    if skip_if_dolt_unavailable() {
        return Ok(());
    }

    let _env_lock = lock_env();
    let config_root = temp_config_root("replace-dead-owner");
    let _override_guard = EnvVarGuard::set(
        "OPENDUCKTOR_CONFIG_DIR",
        config_root.to_string_lossy().as_ref(),
    );

    let first = ensure_shared_dolt_server_running(8008)?;
    let state_file = resolve_server_state_file()?;
    fs::write(
        &state_file,
        serde_json::to_string(&SharedDoltServerState {
            owner_pid: 999_999,
            port: first.port.saturating_add(1),
            ..first.clone()
        })?,
    )?;

    let replacement = ensure_shared_dolt_server_running(9009)?;
    let persisted = read_shared_dolt_server_state()?.expect("expected persisted shared state");

    assert_ne!(replacement.pid, first.pid);
    assert_eq!(replacement.owner_pid, 9009);
    assert_eq!(persisted.pid, replacement.pid);
    assert_eq!(persisted.owner_pid, 9009);
    assert!(stop_shared_dolt_server_for_current_owner(9009)?);

    let _ = fs::remove_dir_all(config_root);
    Ok(())
}

#[test]
fn shared_dolt_server_rejects_replacement_when_live_owner_still_controls_process() -> Result<()> {
    if skip_if_dolt_unavailable() {
        return Ok(());
    }

    let _env_lock = lock_env();
    let config_root = temp_config_root("live-owner-guard");
    let _override_guard = EnvVarGuard::set(
        "OPENDUCKTOR_CONFIG_DIR",
        config_root.to_string_lossy().as_ref(),
    );

    let owner_pid = std::process::id();
    let first = ensure_shared_dolt_server_running(owner_pid)?;
    let state_file = resolve_server_state_file()?;
    fs::write(
        &state_file,
        serde_json::to_string(&SharedDoltServerState {
            port: first.port.saturating_add(1),
            ..first.clone()
        })?,
    )?;

    let error = ensure_shared_dolt_server_running(owner_pid.saturating_add(1))
        .expect_err("live owner should block replacement");
    assert!(error
        .to_string()
        .contains("is unhealthy but still owned by live pid"));

    assert!(stop_shared_dolt_server_for_current_owner(owner_pid)?);
    let _ = fs::remove_dir_all(config_root);
    Ok(())
}

fn create_test_dolt_backup(backup_root: &Path) -> Result<()> {
    let source_root = backup_root.join("source");
    fs::create_dir_all(&source_root)?;
    crate::run_command("dolt", &["init"], Some(&source_root))?;
    crate::run_command(
        "dolt",
        &["sql", "-q", "create table t (id int primary key)"],
        Some(&source_root),
    )?;
    crate::run_command("dolt", &["add", "."], Some(&source_root))?;

    let commit_env = [
        ("DOLT_AUTHOR_NAME", "OpenDucktor Test"),
        ("DOLT_AUTHOR_EMAIL", "test@example.com"),
    ];
    crate::run_command_with_env(
        "dolt",
        &["commit", "-m", "init"],
        Some(&source_root),
        &commit_env,
    )?;

    let backup_dir = backup_root.join("backup");
    let backup_url = Url::from_file_path(&backup_dir)
        .map_err(|()| anyhow!("Failed converting {} into file URL", backup_dir.display()))?;
    crate::run_command(
        "dolt",
        &["backup", "add", "localbackup", backup_url.as_str()],
        Some(&source_root),
    )?;
    crate::run_command(
        "dolt",
        &["backup", "sync", "localbackup"],
        Some(&source_root),
    )?;

    Ok(())
}

#[test]
fn restore_shared_dolt_database_rejects_live_owner_mismatch() -> Result<()> {
    if skip_if_dolt_unavailable() {
        return Ok(());
    }

    let _env_lock = lock_env();
    let config_root = temp_config_root("restore-owner-mismatch");
    let _override_guard = EnvVarGuard::set(
        "OPENDUCKTOR_CONFIG_DIR",
        config_root.to_string_lossy().as_ref(),
    );

    let owner_pid = std::process::id();
    let state = ensure_shared_dolt_server_running(owner_pid)?;
    let backup_dir = config_root.join("backup-source").join("backup");

    let error = restore_shared_dolt_database_from_backup(
        owner_pid.saturating_add(1),
        "odt_restore_owner_mismatch_deadbeef",
        &backup_dir,
    )
    .expect_err("restore should fail when another live owner controls the server");
    assert!(error
        .to_string()
        .contains("cannot be stopped for restore by pid"));
    assert!(is_process_alive(state.pid));

    assert!(stop_shared_dolt_server_for_current_owner(owner_pid)?);
    let _ = fs::remove_dir_all(config_root);
    Ok(())
}

#[test]
fn restore_shared_dolt_database_restarts_server_after_successful_restore() -> Result<()> {
    if skip_if_dolt_unavailable() {
        return Ok(());
    }

    let _env_lock = lock_env();
    let config_root = temp_config_root("restore-restart");
    let _override_guard = EnvVarGuard::set(
        "OPENDUCKTOR_CONFIG_DIR",
        config_root.to_string_lossy().as_ref(),
    );

    let owner_pid = std::process::id();
    let initial_state = ensure_shared_dolt_server_running(owner_pid)?;
    let backup_root = config_root.join("backup-source");
    create_test_dolt_backup(&backup_root)?;
    let backup_dir = backup_root.join("backup");
    let database_name = "odt_restore_restart_deadbeef";

    restore_shared_dolt_database_from_backup(owner_pid, database_name, &backup_dir)?;

    let restored_state = read_shared_dolt_server_state()?.expect("shared state should exist");
    let restored_db_dir = resolve_shared_dolt_root()?.join(database_name);
    assert_eq!(restored_state.owner_pid, owner_pid);
    assert!(is_process_alive(restored_state.pid));
    assert!(restored_db_dir.exists());
    assert_ne!(restored_state.pid, initial_state.pid);

    let port = restored_state.port.to_string();
    let (ok, stdout, stderr) = crate::run_command_allow_failure(
        "dolt",
        &[
            "--host",
            SHARED_DOLT_SERVER_HOST,
            "--port",
            port.as_str(),
            "--no-tls",
            "-u",
            SHARED_DOLT_SERVER_USER,
            "-p",
            "",
            "sql",
            "-q",
            "show databases",
        ],
        None,
    )?;
    assert!(ok, "show databases should succeed: {stderr}");
    assert!(stdout.contains(database_name));

    assert!(stop_shared_dolt_server_for_current_owner(owner_pid)?);
    let _ = fs::remove_dir_all(config_root);
    Ok(())
}

#[test]
fn shared_dolt_server_keeps_roots_and_ports_separate_per_config_dir() -> Result<()> {
    if skip_if_dolt_unavailable() {
        return Ok(());
    }

    let _env_lock = lock_env();
    let root_one = temp_config_root("root-one");
    let root_two = temp_config_root("root-two");

    let first = {
        let _guard = EnvVarGuard::set(
            "OPENDUCKTOR_CONFIG_DIR",
            root_one.to_string_lossy().as_ref(),
        );
        ensure_shared_dolt_server_running(5005)?
    };
    let second = {
        let _guard = EnvVarGuard::set(
            "OPENDUCKTOR_CONFIG_DIR",
            root_two.to_string_lossy().as_ref(),
        );
        ensure_shared_dolt_server_running(5005)?
    };

    assert_ne!(first.shared_server_root, second.shared_server_root);
    assert_ne!(first.dolt_data_dir, second.dolt_data_dir);
    assert_ne!(first.port, second.port);

    {
        let _guard = EnvVarGuard::set(
            "OPENDUCKTOR_CONFIG_DIR",
            root_one.to_string_lossy().as_ref(),
        );
        assert!(stop_shared_dolt_server_for_current_owner(5005)?);
    }
    {
        let _guard = EnvVarGuard::set(
            "OPENDUCKTOR_CONFIG_DIR",
            root_two.to_string_lossy().as_ref(),
        );
        assert!(stop_shared_dolt_server_for_current_owner(5005)?);
    }

    let _ = fs::remove_dir_all(root_one);
    let _ = fs::remove_dir_all(root_two);
    Ok(())
}
