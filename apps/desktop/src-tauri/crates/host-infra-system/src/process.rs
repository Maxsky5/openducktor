use anyhow::{anyhow, Context, Result};
use std::path::Path;
use std::process::{Command, Stdio};

pub fn run_command(program: &str, args: &[&str], cwd: Option<&Path>) -> Result<String> {
    run_command_with_env(program, args, cwd, &[])
}

pub fn run_command_with_env(
    program: &str,
    args: &[&str],
    cwd: Option<&Path>,
    env: &[(&str, &str)],
) -> Result<String> {
    let mut command = Command::new(program);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(path) = cwd {
        command.current_dir(path);
    }
    if !env.is_empty() {
        command.envs(env.iter().copied());
    }

    let output = command
        .output()
        .with_context(|| format!("Failed to spawn command: {} {}", program, args.join(" ")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(anyhow!(
            "Command failed ({}): {} {}\n{}",
            output
                .status
                .code()
                .map(|code| code.to_string())
                .unwrap_or_else(|| "terminated".to_string()),
            program,
            args.join(" "),
            stderr
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

pub fn run_command_allow_failure(
    program: &str,
    args: &[&str],
    cwd: Option<&Path>,
) -> Result<(bool, String, String)> {
    run_command_allow_failure_with_env(program, args, cwd, &[])
}

pub fn run_command_allow_failure_with_env(
    program: &str,
    args: &[&str],
    cwd: Option<&Path>,
    env: &[(&str, &str)],
) -> Result<(bool, String, String)> {
    let mut command = Command::new(program);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(path) = cwd {
        command.current_dir(path);
    }
    if !env.is_empty() {
        command.envs(env.iter().copied());
    }

    let output = command
        .output()
        .with_context(|| format!("Failed to spawn command: {} {}", program, args.join(" ")))?;

    Ok((
        output.status.success(),
        String::from_utf8_lossy(&output.stdout).trim().to_string(),
        String::from_utf8_lossy(&output.stderr).trim().to_string(),
    ))
}

pub fn command_exists(program: &str) -> bool {
    Command::new("sh")
        .arg("-lc")
        .arg(format!(
            "command -v {} >/dev/null 2>&1",
            shell_escape(program)
        ))
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

pub fn version_command(program: &str, args: &[&str]) -> Option<String> {
    if !command_exists(program) {
        return None;
    }

    run_command(program, args, None).ok().and_then(|output| {
        output
            .lines()
            .find(|line| !line.trim().is_empty())
            .map(|line| line.trim().to_string())
    })
}

fn shell_escape(value: &str) -> String {
    value.replace('"', "\\\"")
}

#[cfg(test)]
mod tests {
    use super::{
        command_exists, run_command, run_command_allow_failure, run_command_allow_failure_with_env,
        run_command_with_env, version_command,
    };

    #[test]
    fn run_command_returns_stdout() {
        let output = run_command("sh", &["-lc", "printf 'ok'"], None).expect("command should pass");
        assert_eq!(output, "ok");
    }

    #[test]
    fn run_command_with_env_injects_environment() {
        let output = run_command_with_env(
            "sh",
            &["-lc", "printf '%s' \"$OBP_TEST_ENV\""],
            None,
            &[("OBP_TEST_ENV", "42")],
        )
        .expect("command should pass");
        assert_eq!(output, "42");
    }

    #[test]
    fn run_command_reports_failure_with_context() {
        let error =
            run_command("sh", &["-lc", "echo boom >&2; exit 7"], None).expect_err("must fail");
        let message = error.to_string();
        assert!(message.contains("Command failed"));
        assert!(message.contains("boom"));
    }

    #[test]
    fn run_command_allow_failure_returns_status_and_streams() {
        let (ok, stdout, stderr) = run_command_allow_failure(
            "sh",
            &["-lc", "echo hello; echo warn >&2; exit 3"],
            None,
        )
        .expect("command should execute");

        assert!(!ok);
        assert_eq!(stdout, "hello");
        assert_eq!(stderr, "warn");
    }

    #[test]
    fn run_command_allow_failure_with_env_supports_variables() {
        let (ok, stdout, _stderr) = run_command_allow_failure_with_env(
            "sh",
            &["-lc", "printf '%s' \"$OBP_ENV\""],
            None,
            &[("OBP_ENV", "set")],
        )
        .expect("command should execute");
        assert!(ok);
        assert_eq!(stdout, "set");
    }

    #[test]
    fn command_exists_and_version_command_behave_consistently() {
        assert!(command_exists("sh"));
        let version = version_command("sh", &["-lc", "echo v-test"]);
        assert_eq!(version.as_deref(), Some("v-test"));
        assert!(!command_exists("definitely_not_a_real_binary_name"));
    }
}
