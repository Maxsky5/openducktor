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
