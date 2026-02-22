use anyhow::Result;
use host_infra_system::{run_command_allow_failure_with_env, run_command_with_env};
use std::path::Path;

pub(crate) trait CommandRunner: Send + Sync {
    fn run_with_env(
        &self,
        program: &str,
        args: &[&str],
        cwd: Option<&Path>,
        env: &[(&str, &str)],
    ) -> Result<String>;

    fn run_allow_failure_with_env(
        &self,
        program: &str,
        args: &[&str],
        cwd: Option<&Path>,
        env: &[(&str, &str)],
    ) -> Result<(bool, String, String)>;
}

#[derive(Debug, Default)]
pub(crate) struct ProcessCommandRunner;

impl CommandRunner for ProcessCommandRunner {
    fn run_with_env(
        &self,
        program: &str,
        args: &[&str],
        cwd: Option<&Path>,
        env: &[(&str, &str)],
    ) -> Result<String> {
        run_command_with_env(program, args, cwd, env)
    }

    fn run_allow_failure_with_env(
        &self,
        program: &str,
        args: &[&str],
        cwd: Option<&Path>,
        env: &[(&str, &str)],
    ) -> Result<(bool, String, String)> {
        run_command_allow_failure_with_env(program, args, cwd, env)
    }
}
