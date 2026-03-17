use anyhow::{anyhow, Context, Result};
use std::env;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};

fn command_env_override_name(program: &str) -> String {
    let sanitized = program
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_uppercase()
            } else {
                '_'
            }
        })
        .collect::<String>();
    format!("OPENDUCKTOR_{sanitized}_PATH")
}

fn explicit_command_override(program: &str) -> Result<Option<String>> {
    let override_name = command_env_override_name(program);
    let Some(explicit_path) = env::var_os(&override_name).map(PathBuf::from) else {
        return Ok(None);
    };

    if explicit_path.is_file() {
        return Ok(Some(explicit_path.to_string_lossy().to_string()));
    }

    Err(anyhow!(
        "Configured command override {override_name} points to a missing file: {}",
        explicit_path.display()
    ))
}

fn bundled_command_path_from_executable(executable_path: &Path, program: &str) -> Option<String> {
    let executable_name = if cfg!(windows) {
        format!("{program}.exe")
    } else {
        program.to_string()
    };
    let executable_dir = executable_path.parent()?.to_path_buf();
    let candidate = executable_dir.join(executable_name);
    candidate
        .is_file()
        .then(|| candidate.to_string_lossy().to_string())
}

fn bundled_command_path(program: &str) -> Option<String> {
    let executable_path = env::current_exe().ok()?;
    bundled_command_path_from_executable(&executable_path, program)
}

pub fn resolve_command_path(program: &str) -> Result<Option<String>> {
    let path = Path::new(program);
    if path.components().count() > 1 {
        return Ok(Some(path.to_string_lossy().to_string()));
    }

    if let Some(explicit_path) = explicit_command_override(program)? {
        return Ok(Some(explicit_path));
    }

    Ok(bundled_command_path(program).or_else(|| command_path(program)))
}

fn configured_command(
    program: &str,
    args: &[&str],
    cwd: Option<&Path>,
    env: &[(&str, &str)],
) -> Command {
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
    command
}

fn spawn_command_output(
    program: &str,
    args: &[&str],
    cwd: Option<&Path>,
    env: &[(&str, &str)],
) -> Result<Output> {
    configured_command(program, args, cwd, env)
        .output()
        .with_context(|| format!("Failed to spawn command: {} {}", program, args.join(" ")))
}

pub fn run_command(program: &str, args: &[&str], cwd: Option<&Path>) -> Result<String> {
    run_command_with_env(program, args, cwd, &[])
}

pub fn run_command_with_env(
    program: &str,
    args: &[&str],
    cwd: Option<&Path>,
    env: &[(&str, &str)],
) -> Result<String> {
    let resolved_program = resolve_command_path(program)?.unwrap_or_else(|| program.to_string());
    let output = spawn_command_output(&resolved_program, args, cwd, env)?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(anyhow!(
            "Command failed ({}): {} {}\n{}",
            output
                .status
                .code()
                .map(|code| code.to_string())
                .unwrap_or_else(|| "terminated".to_string()),
            resolved_program,
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
    let resolved_program = resolve_command_path(program)?.unwrap_or_else(|| program.to_string());
    let output = spawn_command_output(&resolved_program, args, cwd, env)?;

    Ok((
        output.status.success(),
        String::from_utf8_lossy(&output.stdout).trim().to_string(),
        String::from_utf8_lossy(&output.stderr).trim().to_string(),
    ))
}

/// Resolves a command name using the active shell's PATH lookup.
///
/// The lookup script is static and `program` is passed as a positional shell
/// argument (`$1`) to avoid shell interpolation of untrusted input.
pub fn command_path(program: &str) -> Option<String> {
    spawn_command_output(
        "sh",
        &[
            "-c",
            "command -v \"$1\" 2>/dev/null",
            "odt-command-path",
            program,
        ],
        None,
        &[],
    )
    .ok()
    .and_then(|output| {
        String::from_utf8_lossy(&output.stdout)
            .lines()
            .find(|line| !line.trim().is_empty())
            .map(|line| line.trim().to_string())
    })
    .filter(|path| !path.is_empty())
}

/// Returns whether `program` can be resolved on PATH by [`command_path`].
pub fn command_exists(program: &str) -> bool {
    resolve_command_path(program).ok().flatten().is_some()
}

pub fn version_command(program: &str, args: &[&str]) -> Option<String> {
    let resolved = resolve_command_path(program).ok().flatten()?;
    run_command(&resolved, args, None).ok().and_then(|output| {
        output
            .lines()
            .find(|line| !line.trim().is_empty())
            .map(|line| line.trim().to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::{
        bundled_command_path_from_executable, command_env_override_name, command_exists,
        command_path, explicit_command_override, run_command, run_command_allow_failure,
        run_command_allow_failure_with_env, run_command_with_env, version_command,
    };
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
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
        let (ok, stdout, stderr) =
            run_command_allow_failure("sh", &["-lc", "echo hello; echo warn >&2; exit 3"], None)
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
        assert!(command_path("sh").is_some());
        let version = version_command("sh", &["-lc", "echo v-test"]);
        assert_eq!(version.as_deref(), Some("v-test"));
        assert!(!command_exists("definitely_not_a_real_binary_name"));
        assert!(command_path("definitely_not_a_real_binary_name").is_none());
    }

    #[test]
    fn command_path_treats_metacharacters_as_literal_program_name() {
        let payload = "definitely_not_real_$(echo injected)`uname`;touch /tmp/odt";
        assert!(command_path(payload).is_none());
    }

    #[test]
    fn command_path_does_not_execute_shell_substitution_payloads() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        let marker = std::env::temp_dir().join(format!("odt-command-path-marker-{nonce}"));
        let payload = format!("definitely_not_real_$(touch {})", marker.display());

        assert!(command_path(payload.as_str()).is_none());
        assert!(
            !marker.exists(),
            "payload should not be able to execute touch via shell expansion"
        );
    }

    #[test]
    fn bundled_command_path_resolves_sibling_binary() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("odt-bundled-command-{nonce}"));
        let executable_dir = root.join("MacOS");
        fs::create_dir_all(&executable_dir).expect("temp executable dir should be created");
        let fake_executable = executable_dir.join("openducktor-desktop");
        let fake_bd = executable_dir.join("bd");
        fs::write(&fake_executable, "").expect("fake executable should be writable");
        fs::write(&fake_bd, "").expect("fake bundled command should be writable");

        let resolved = bundled_command_path_from_executable(&fake_executable, "bd");
        assert_eq!(resolved.as_deref(), Some(fake_bd.to_string_lossy().as_ref()));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn run_command_prefers_env_override_for_command_lookup() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("odt-command-override-{nonce}"));
        fs::create_dir_all(&root).expect("temp dir should be created");
        let script = root.join("fake-bd");
        fs::write(&script, "#!/bin/sh\nprintf 'override-ok'").expect("script should be writable");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;

            let mut permissions = fs::metadata(&script)
                .expect("script metadata should exist")
                .permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(&script, permissions).expect("script should be executable");
        }

        let env_name = command_env_override_name("bd");
        std::env::set_var(&env_name, &script);
        let output = run_command("bd", &[], None).expect("override command should execute");
        std::env::remove_var(&env_name);

        assert_eq!(output, "override-ok");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn explicit_command_override_reports_invalid_path() {
        let env_name = command_env_override_name("bd");
        std::env::set_var(&env_name, "/tmp/odt-missing-command-override");

        let error = explicit_command_override("bd").expect_err("invalid override should fail");
        std::env::remove_var(&env_name);

        assert!(error
            .to_string()
            .contains("Configured command override"));
    }
}
