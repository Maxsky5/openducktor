use super::command_support::{CommandResult, HeadlessCommandError, HeadlessState};
use super::{git_commands, runtime_commands, task_commands, workspace_commands};
use anyhow::anyhow;
use serde_json::Value;
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;

pub(super) type CommandFuture<'a> = Pin<Box<dyn Future<Output = CommandResult> + Send + 'a>>;

type BoxedCommandHandler =
    dyn for<'a> Fn(&'a HeadlessState, Value) -> CommandFuture<'a> + Send + Sync;

#[derive(Default)]
pub(super) struct CommandRegistry {
    handlers: HashMap<&'static str, Box<BoxedCommandHandler>>,
}

impl CommandRegistry {
    pub(super) fn register<F>(&mut self, command: &'static str, handler: F) -> Result<(), String>
    where
        F: for<'a> Fn(&'a HeadlessState, Value) -> CommandFuture<'a> + Send + Sync + 'static,
    {
        if self.handlers.insert(command, Box::new(handler)).is_some() {
            return Err(format!(
                "duplicate browser backend command registration: {command}"
            ));
        }

        Ok(())
    }

    fn get(&self, command: &str) -> Option<&BoxedCommandHandler> {
        self.handlers.get(command).map(Box::as_ref)
    }

    #[cfg(test)]
    fn contains(&self, command: &str) -> bool {
        self.handlers.contains_key(command)
    }
}

pub(super) fn build_registry() -> anyhow::Result<CommandRegistry> {
    let mut registry = CommandRegistry::default();
    workspace_commands::register_commands(&mut registry)
        .map_err(|error| anyhow!(error))?;
    git_commands::register_commands(&mut registry)
        .map_err(|error| anyhow!(error))?;
    task_commands::register_commands(&mut registry)
        .map_err(|error| anyhow!(error))?;
    runtime_commands::register_commands(&mut registry)
        .map_err(|error| anyhow!(error))?;
    Ok(registry)
}

pub(super) async fn dispatch_command(
    state: &HeadlessState,
    command: &str,
    args: Value,
) -> CommandResult {
    let handler = state.registry.get(command).ok_or_else(|| {
        HeadlessCommandError::not_found(format!("Unsupported browser backend command: {command}"))
    })?;

    handler(state, args).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::headless::command_support::deserialize_args;
    use crate::headless::events::HeadlessEventBus;
    use axum::body::to_bytes;
    use axum::http::StatusCode;
    use axum::response::IntoResponse;
    use host_application::AppService;
    use host_domain::TaskStore;
    use host_infra_beads::BeadsTaskStore;
    use host_infra_system::AppConfigStore;
    use serde::Deserialize;
    use serde_json::json;
    use serde_json::Value;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::Arc;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TestStateFixture {
        state: HeadlessState,
        root: PathBuf,
    }

    impl Drop for TestStateFixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[derive(Debug, Deserialize)]
    struct TestArgs {
        value: String,
    }

    fn unique_temp_path(prefix: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after UNIX_EPOCH")
            .as_nanos();
        std::env::temp_dir().join(format!("openducktor-headless-tests-{prefix}-{nanos}"))
    }

    fn test_state_fixture(registry: CommandRegistry) -> TestStateFixture {
        let root = unique_temp_path("registry");
        fs::create_dir_all(&root).expect("test root should exist");
        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let task_store: Arc<dyn TaskStore> = Arc::new(BeadsTaskStore::with_metadata_namespace(
            "openducktor",
        ));
        let service = Arc::new(AppService::new(task_store, config_store));

        TestStateFixture {
            state: HeadlessState {
                service,
                events: HeadlessEventBus::new(1),
                dev_server_events: HeadlessEventBus::new(1),
                registry: Arc::new(registry),
            },
            root,
        }
    }

    async fn response_json(error: HeadlessCommandError) -> (StatusCode, Value) {
        let response = error.into_response();
        let status = response.status();
        let bytes = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("error response body should collect");
        let payload = serde_json::from_slice(&bytes).expect("error response should deserialize");
        (status, payload)
    }

    #[test]
    fn registry_contains_known_commands_from_each_domain_module() {
        let registry = build_registry().expect("registry should build");

        assert!(registry.contains("workspace_list"));
        assert!(registry.contains("git_get_status"));
        assert!(registry.contains("task_create"));
        assert!(registry.contains("runtime_ensure"));
    }

    #[test]
    fn duplicate_registration_is_rejected() {
        let mut registry = CommandRegistry::default();
        registry
            .register("test_command", |_, _| Box::pin(async { Ok(Value::Null) }))
            .expect("first registration should succeed");

        let error = registry
            .register("test_command", |_, _| Box::pin(async { Ok(Value::Null) }))
            .expect_err("duplicate registration should fail");

        assert_eq!(error, "duplicate browser backend command registration: test_command");
    }

    #[tokio::test]
    async fn dispatch_command_returns_registered_handler_payload() {
        let mut registry = CommandRegistry::default();
        registry
            .register("test_success", |_, args| {
                Box::pin(async move {
                    let TestArgs { value } = deserialize_args(args)?;
                    Ok(json!({ "value": value }))
                })
            })
            .expect("test command should register");
        let fixture = test_state_fixture(registry);

        let payload = dispatch_command(&fixture.state, "test_success", json!({ "value": "ok" }))
            .await
            .expect("registered command should dispatch");

        assert_eq!(payload, json!({ "value": "ok" }));
    }

    #[tokio::test]
    async fn dispatch_command_returns_not_found_error_envelope_for_unknown_command() {
        let fixture = test_state_fixture(CommandRegistry::default());

        let error = dispatch_command(&fixture.state, "missing_command", json!({}))
            .await
            .expect_err("unknown command should fail");
        let (status, payload) = response_json(error).await;

        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(
            payload,
            json!({ "error": "Unsupported browser backend command: missing_command" })
        );
    }

    #[tokio::test]
    async fn dispatch_command_returns_bad_request_error_envelope_for_invalid_args() {
        let mut registry = CommandRegistry::default();
        registry
            .register("test_invalid_args", |_, args| {
                Box::pin(async move {
                    let TestArgs { value } = deserialize_args(args)?;
                    Ok(json!({ "value": value }))
                })
            })
            .expect("test command should register");
        let fixture = test_state_fixture(registry);

        let error = dispatch_command(&fixture.state, "test_invalid_args", json!({}))
            .await
            .expect_err("invalid args should fail");
        let (status, payload) = response_json(error).await;

        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(payload["error"]
            .as_str()
            .expect("error message should be a string")
            .contains("Invalid arguments:"));
    }
}
