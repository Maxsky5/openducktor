use crate::app_state::{AppState, PullRequestSyncLoopState};
use crate::commands::command_registry::register_desktop_commands;
use crate::external_task_sync::{start_task_event_relay, TaskEventRelayState, TASK_EVENT_NAME};
use crate::logging::init_tracing_subscriber;
#[cfg(all(feature = "cef", target_os = "macos"))]
use crate::macos_cef_quit;
use crate::pull_request_sync::start_pull_request_sync_loop;
use crate::shutdown::{startup_phase_exit_shutdown_handler, startup_phase_shutdown_hooks};
use crate::TauriRuntime;
use anyhow::Context;
use host_application::AppService;
use host_domain::TASK_METADATA_NAMESPACE;
use host_infra_beads::BeadsTaskStore;
use host_infra_system::{AppConfigStore, RuntimeConfigStore};
use std::sync::Arc;
use tauri::{Emitter, Manager};

fn validate_startup_config(
    config_store: &AppConfigStore,
    runtime_config_store: &RuntimeConfigStore,
) -> anyhow::Result<()> {
    config_store.load().with_context(|| {
        format!(
            "Failed loading startup config from {}. Fix invalid JSON in this file or delete it so OpenDucktor can recreate defaults.",
            config_store.path().display()
        )
    })?;
    runtime_config_store.load().with_context(|| {
        format!(
            "Failed loading runtime config from {}. Fix invalid JSON in this file or delete it so OpenDucktor can recreate defaults.",
            runtime_config_store.path().display()
        )
    })?;
    Ok(())
}

pub(crate) fn startup_phase_tracing() {
    init_tracing_subscriber();
}

pub(crate) fn startup_phase_service_bootstrap() -> anyhow::Result<Arc<AppService>> {
    let config_store = AppConfigStore::new().context("failed to initialize config store")?;
    let runtime_config_store = RuntimeConfigStore::from_user_settings_store(&config_store);
    validate_startup_config(&config_store, &runtime_config_store)?;
    let instance_pid = resolve_host_owner_pid()?;
    let task_store = Arc::new(
        BeadsTaskStore::with_metadata_namespace_config_and_owner_pid(
            TASK_METADATA_NAMESPACE,
            config_store.clone(),
            instance_pid,
        ),
    );
    let service = Arc::new(AppService::with_instance_pid(
        task_store,
        config_store,
        instance_pid,
    ));

    Ok(service)
}

fn resolve_host_owner_pid() -> anyhow::Result<u32> {
    const HOST_OWNER_PID_ENV: &str = "OPENDUCKTOR_HOST_OWNER_PID";
    match std::env::var(HOST_OWNER_PID_ENV) {
        Ok(raw) => {
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                return Err(anyhow::anyhow!(
                    "{HOST_OWNER_PID_ENV} is set but empty; expected the owning OpenDucktor process id"
                ));
            }
            let pid = trimmed.parse::<u32>().with_context(|| {
                format!("{HOST_OWNER_PID_ENV} must be a positive process id, got {trimmed:?}")
            })?;
            if pid == 0 {
                return Err(anyhow::anyhow!(
                    "{HOST_OWNER_PID_ENV} must be a positive process id, got {trimmed:?}"
                ));
            }
            Ok(pid)
        }
        Err(std::env::VarError::NotPresent) => Ok(std::process::id()),
        Err(error) => Err(error).context(format!("failed reading {HOST_OWNER_PID_ENV}")),
    }
}

fn startup_phase_prepare_external_mcp_discovery<T>(
    value: T,
    ensure_ready: impl FnOnce(&T) -> anyhow::Result<()>,
) -> anyhow::Result<T> {
    ensure_ready(&value).context(
        "failed to initialize the local MCP bridge used for external OpenDucktor discovery",
    )?;
    Ok(value)
}

fn startup_phase_build_tauri_app(
    service: Arc<AppService>,
) -> anyhow::Result<tauri::App<TauriRuntime>> {
    let builder = tauri::Builder::<TauriRuntime>::default();
    let setup_service = service.clone();

    #[cfg(all(feature = "cef", target_os = "macos"))]
    let builder = builder.command_line_args([
        ("--use-mock-keychain", None::<String>),
        ("--password-store", Some("basic".to_string())),
        ("--no-first-run", None::<String>),
    ]);

    let builder = builder.manage(AppState { service }).setup(move |app| {
        #[cfg(all(feature = "cef", target_os = "macos"))]
        macos_cef_quit::install(app)?;

        let stop_requested = start_task_event_relay(setup_service.clone(), app.handle().clone());
        let pull_request_sync_stop_requested =
            start_pull_request_sync_loop(setup_service.clone(), {
                let app_handle = app.handle().clone();
                move |event| {
                    if let Err(error) = app_handle.emit(TASK_EVENT_NAME, event) {
                        tracing::error!(
                            target: "openducktor.task-sync",
                            error = %error,
                            "Pull request sync loop failed to emit a desktop task event"
                        );
                    }
                }
            });
        app.manage(TaskEventRelayState { stop_requested });
        app.manage(PullRequestSyncLoopState {
            stop_requested: pull_request_sync_stop_requested,
        });
        Ok(())
    });

    register_desktop_commands(builder)
        .build(tauri::generate_context!())
        .context("error while building openducktor")
}

pub(crate) fn run_desktop() -> anyhow::Result<()> {
    startup_phase_tracing();
    let service = startup_phase_prepare_external_mcp_discovery(
        startup_phase_service_bootstrap()?,
        |service| service.ensure_external_mcp_discovery_ready(),
    )?;
    let app_service = service.clone();
    startup_phase_shutdown_hooks(app_service.clone());

    startup_phase_build_tauri_app(service)?.run(startup_phase_exit_shutdown_handler(app_service));

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use anyhow::anyhow;
    use host_test_support::{lock_env, EnvVarGuard};
    use std::fs;
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;
    use std::path::PathBuf;
    use std::time::SystemTime;

    fn unique_temp_path(prefix: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("system clock should be after UNIX_EPOCH")
            .as_nanos();
        std::env::temp_dir().join(format!("openducktor-lib-tests-{prefix}-{nanos}"))
    }

    #[test]
    fn validate_startup_config_succeeds_with_valid_config() -> anyhow::Result<()> {
        let root = unique_temp_path("startup-config-valid");
        let config_path = root.join("config.json");
        let config_store = AppConfigStore::from_path(config_path);
        let runtime_store = RuntimeConfigStore::from_user_settings_store(&config_store);
        let config = host_infra_system::GlobalConfig::default();
        let runtime_config = host_infra_system::RuntimeConfig::default();
        config_store.save(&config)?;
        runtime_store.save(&runtime_config)?;

        validate_startup_config(&config_store, &runtime_store)?;
        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn validate_startup_config_returns_actionable_error_on_config_failure() -> anyhow::Result<()> {
        let root = unique_temp_path("startup-config-invalid");
        let config_path = root.join("config.json");
        fs::create_dir_all(&root)?;
        fs::write(&config_path, "{ invalid json")?;
        #[cfg(unix)]
        fs::set_permissions(&config_path, fs::Permissions::from_mode(0o600))?;

        let config_store = AppConfigStore::from_path(config_path.clone());
        let runtime_store = RuntimeConfigStore::from_user_settings_store(&config_store);
        let error = validate_startup_config(&config_store, &runtime_store)
            .expect_err("invalid config should fail startup config validation");
        let message = format!("{error:#}");

        assert!(
            message.contains(&format!(
                "Failed loading startup config from {}",
                config_path.display()
            )),
            "error should include config path and startup context: {message}"
        );
        assert!(
            message.contains(
                "Fix invalid JSON in this file or delete it so OpenDucktor can recreate defaults"
            ),
            "error should include recovery instruction: {message}"
        );
        assert!(
            message.contains("Failed parsing config file"),
            "error should preserve parse failure context: {message}"
        );
        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn validate_startup_config_returns_actionable_error_on_runtime_config_failure(
    ) -> anyhow::Result<()> {
        let root = unique_temp_path("runtime-config-invalid");
        let config_store = AppConfigStore::from_path(root.join("config.json"));
        config_store.save(&host_infra_system::GlobalConfig::default())?;

        let runtime_path = root.join("runtime-config.json");
        fs::create_dir_all(&root)?;
        fs::write(&runtime_path, "{ invalid json")?;
        #[cfg(unix)]
        fs::set_permissions(&runtime_path, fs::Permissions::from_mode(0o600))?;
        let runtime_store = RuntimeConfigStore::from_user_settings_store(&config_store);

        let error = validate_startup_config(&config_store, &runtime_store)
            .expect_err("invalid runtime config should fail startup config validation");
        let message = format!("{error:#}");

        assert!(
            message.contains(&format!(
                "Failed loading runtime config from {}",
                runtime_path.display()
            )),
            "error should include runtime config path and startup context: {message}"
        );
        assert!(
            message.contains(
                "Fix invalid JSON in this file or delete it so OpenDucktor can recreate defaults"
            ),
            "error should include recovery instruction: {message}"
        );
        assert!(
            message.contains("Failed parsing config file"),
            "error should preserve parse failure context: {message}"
        );

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn resolve_host_owner_pid_rejects_zero_env_value() {
        let _env_lock = lock_env();
        let _guard = EnvVarGuard::set("OPENDUCKTOR_HOST_OWNER_PID", "0");

        let error = resolve_host_owner_pid().expect_err("zero pid should be rejected");

        assert!(
            error
                .to_string()
                .contains("OPENDUCKTOR_HOST_OWNER_PID must be a positive process id"),
            "error should explain positive pid requirement: {error:#}"
        );
    }

    #[test]
    fn startup_phase_prepare_external_mcp_discovery_returns_value_on_success() -> anyhow::Result<()>
    {
        let value = Arc::new("service".to_string());

        let prepared = startup_phase_prepare_external_mcp_discovery(value.clone(), |_| Ok(()))?;

        assert!(Arc::ptr_eq(&prepared, &value));
        Ok(())
    }

    #[test]
    fn startup_phase_prepare_external_mcp_discovery_adds_context_on_failure() {
        let error = startup_phase_prepare_external_mcp_discovery(Arc::new(()), |_| {
            Err(anyhow!("bridge unavailable"))
        })
        .expect_err("startup phase should fail");

        assert!(error.to_string().contains(
            "failed to initialize the local MCP bridge used for external OpenDucktor discovery",
        ));
        assert!(format!("{error:#}").contains("bridge unavailable"));
    }
}
