use super::command_support::{CommandResult, HeadlessCommandError, HeadlessState};
use super::{git_commands, runtime_commands, task_commands, workspace_commands};
use serde_json::Value;
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::OnceLock;

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

fn build_registry() -> CommandRegistry {
    let mut registry = CommandRegistry::default();
    workspace_commands::register_commands(&mut registry)
        .expect("workspace browser backend commands should register");
    git_commands::register_commands(&mut registry)
        .expect("git browser backend commands should register");
    task_commands::register_commands(&mut registry)
        .expect("task browser backend commands should register");
    runtime_commands::register_commands(&mut registry)
        .expect("runtime browser backend commands should register");
    registry
}

fn registry() -> &'static CommandRegistry {
    static REGISTRY: OnceLock<CommandRegistry> = OnceLock::new();
    REGISTRY.get_or_init(build_registry)
}

pub(super) async fn dispatch_command(
    state: &HeadlessState,
    command: &str,
    args: Value,
) -> CommandResult {
    let handler = registry().get(command).ok_or_else(|| {
        HeadlessCommandError::not_found(format!("Unsupported browser backend command: {command}"))
    })?;

    handler(state, args).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn registry_contains_known_commands_from_each_domain_module() {
        let registry = build_registry();

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
}
