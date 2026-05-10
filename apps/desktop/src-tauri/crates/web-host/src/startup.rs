use crate::logging::init_tracing_subscriber;
use anyhow::Context;
use host_application::AppService;
use host_domain::TASK_METADATA_NAMESPACE;
use host_infra_beads::BeadsTaskStore;
use host_infra_system::{AppConfigStore, RuntimeConfigStore};
use std::sync::Arc;

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
    Ok(Arc::new(AppService::with_instance_pid(
        task_store,
        config_store,
        instance_pid,
    )))
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;
    use std::sync::Mutex;

    const HOST_OWNER_PID_ENV: &str = "OPENDUCKTOR_HOST_OWNER_PID";
    static HOST_OWNER_PID_ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn resolve_host_owner_pid_uses_current_process_when_unset() {
        with_host_owner_pid_env(None, || {
            assert_eq!(
                resolve_host_owner_pid().expect("unset env should use current process"),
                std::process::id()
            );
        });
    }

    #[test]
    fn resolve_host_owner_pid_rejects_empty_value() {
        with_host_owner_pid_env(Some(OsString::from("")), || {
            assert!(resolve_host_owner_pid().is_err());
        });
    }

    #[test]
    fn resolve_host_owner_pid_rejects_non_numeric_value() {
        with_host_owner_pid_env(Some(OsString::from("abc")), || {
            assert!(resolve_host_owner_pid().is_err());
        });
    }

    #[test]
    fn resolve_host_owner_pid_rejects_zero() {
        with_host_owner_pid_env(Some(OsString::from("0")), || {
            assert!(resolve_host_owner_pid().is_err());
        });
    }

    #[cfg(unix)]
    #[test]
    fn resolve_host_owner_pid_rejects_non_utf8_value() {
        use std::os::unix::ffi::OsStringExt;

        with_host_owner_pid_env(Some(OsString::from_vec(vec![0x66, 0x80, 0x6f])), || {
            assert!(resolve_host_owner_pid().is_err());
        });
    }

    fn with_host_owner_pid_env(value: Option<OsString>, test: impl FnOnce()) {
        let _guard = HOST_OWNER_PID_ENV_LOCK
            .lock()
            .expect("host owner pid env lock should not be poisoned");
        let original = std::env::var_os(HOST_OWNER_PID_ENV);
        match value {
            Some(value) => std::env::set_var(HOST_OWNER_PID_ENV, value),
            None => std::env::remove_var(HOST_OWNER_PID_ENV),
        }

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(test));

        match original {
            Some(value) => std::env::set_var(HOST_OWNER_PID_ENV, value),
            None => std::env::remove_var(HOST_OWNER_PID_ENV),
        }

        if let Err(panic) = result {
            std::panic::resume_unwind(panic);
        }
    }
}
