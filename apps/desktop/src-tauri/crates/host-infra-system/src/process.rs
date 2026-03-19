use anyhow::{anyhow, Context, Result};
use std::env;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};

#[cfg(windows)]
const DEFAULT_WINDOWS_EXECUTABLE_EXTENSIONS: [&str; 4] = [".exe", ".cmd", ".bat", ".com"];

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

pub fn bundled_command(program: &str) -> Option<String> {
    bundled_command_path(program)
}

#[cfg(windows)]
fn command_file_names(program: &str) -> Vec<OsString> {
    if Path::new(program).extension().is_some() {
        return vec![OsString::from(program)];
    }

    let configured_extensions = env::var_os("PATHEXT")
        .map(|value| value.to_string_lossy().to_string())
        .map(|value| {
            value
                .split(';')
                .map(str::trim)
                .filter(|extension| !extension.is_empty())
                .map(|extension| {
                    let normalized = if extension.starts_with('.') {
                        extension.to_ascii_lowercase()
                    } else {
                        format!(".{extension}").to_ascii_lowercase()
                    };
                    OsString::from(format!("{program}{normalized}"))
                })
                .collect::<Vec<_>>()
        })
        .filter(|extensions| !extensions.is_empty())
        .unwrap_or_else(|| {
            DEFAULT_WINDOWS_EXECUTABLE_EXTENSIONS
                .iter()
                .map(|extension| OsString::from(format!("{program}{extension}")))
                .collect()
        });

    let mut file_names = vec![OsString::from(program)];
    for candidate in configured_extensions {
        if file_names.iter().any(|existing| existing == &candidate) {
            continue;
        }
        file_names.push(candidate);
    }

    file_names
}

#[cfg(not(windows))]
fn command_file_names(program: &str) -> Vec<OsString> {
    vec![OsString::from(program)]
}

fn home_directory() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        env::var_os("USERPROFILE")
            .or_else(|| env::var_os("HOME"))
            .map(PathBuf::from)
    }
    #[cfg(not(windows))]
    {
        env::var_os("HOME").map(PathBuf::from)
    }
}

fn common_user_search_directories() -> Vec<PathBuf> {
    let mut directories = Vec::new();

    if let Some(home) = home_directory() {
        directories.push(home.join(".cargo").join("bin"));
        directories.push(home.join(".bun").join("bin"));
        directories.push(home.join(".local").join("bin"));
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
            let local_app_data = PathBuf::from(local_app_data);
            directories.push(
                local_app_data
                    .join("Microsoft")
                    .join("WinGet")
                    .join("Links"),
            );
            directories.push(local_app_data.join("Programs").join("GitHub CLI"));
            directories.push(
                local_app_data
                    .join("Programs")
                    .join("GitHub CLI")
                    .join("bin"),
            );
        }
        if let Some(program_files) = env::var_os("ProgramFiles") {
            let program_files = PathBuf::from(program_files);
            directories.push(program_files.join("GitHub CLI"));
            directories.push(program_files.join("GitHub CLI").join("bin"));
        }
        if let Some(program_files_x86) = env::var_os("ProgramFiles(x86)") {
            let program_files_x86 = PathBuf::from(program_files_x86);
            directories.push(program_files_x86.join("GitHub CLI"));
            directories.push(program_files_x86.join("GitHub CLI").join("bin"));
        }
    }

    unique_path_entries(directories)
}

fn existing_file_path(path: PathBuf) -> Option<String> {
    path.is_file().then(|| path.to_string_lossy().to_string())
}

fn path_entries_from_value(path_value: Option<OsString>) -> Vec<PathBuf> {
    path_value
        .as_ref()
        .map(env::split_paths)
        .into_iter()
        .flatten()
        .collect()
}

fn path_value_from_entries(entries: &[PathBuf]) -> Option<OsString> {
    let filtered = entries
        .iter()
        .filter(|entry| !entry.as_os_str().is_empty())
        .cloned()
        .collect::<Vec<_>>();
    if filtered.is_empty() {
        return None;
    }
    env::join_paths(filtered).ok()
}

fn unique_path_entries(entries: impl IntoIterator<Item = PathBuf>) -> Vec<PathBuf> {
    let mut deduped = Vec::new();
    for entry in entries {
        if deduped.iter().any(|existing| existing == &entry) {
            continue;
        }
        deduped.push(entry);
    }
    deduped
}

fn standard_search_directories() -> Vec<PathBuf> {
    let mut directories = common_user_search_directories();

    #[cfg(target_os = "macos")]
    {
        directories.push(PathBuf::from("/opt/homebrew/bin"));
        directories.push(PathBuf::from("/usr/local/bin"));
    }

    #[cfg(target_os = "linux")]
    {
        directories.push(PathBuf::from("/usr/local/bin"));
        directories.push(PathBuf::from("/usr/bin"));
        directories.push(PathBuf::from("/snap/bin"));
        if let Some(home) = env::var_os("HOME") {
            directories.push(PathBuf::from(home).join(".local").join("bin"));
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
            directories.push(PathBuf::from(local_app_data).join("Programs"));
        }
        if let Some(program_files) = env::var_os("ProgramFiles") {
            directories.push(PathBuf::from(program_files));
        }
        if let Some(program_files_x86) = env::var_os("ProgramFiles(x86)") {
            directories.push(PathBuf::from(program_files_x86));
        }
    }

    unique_path_entries(directories)
}

fn standard_command_directories(program: &str) -> Vec<PathBuf> {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    let mut directories = standard_search_directories();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let directories = standard_search_directories();

    #[cfg(target_os = "macos")]
    {
        directories.push(PathBuf::from(format!("/opt/homebrew/opt/{program}/bin")));
        directories.push(PathBuf::from(format!("/usr/local/opt/{program}/bin")));
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
            directories.push(PathBuf::from(local_app_data).join("Programs").join(program));
        }
        if let Some(program_files) = env::var_os("ProgramFiles") {
            directories.push(PathBuf::from(program_files).join(program));
        }
        if let Some(program_files_x86) = env::var_os("ProgramFiles(x86)") {
            directories.push(PathBuf::from(program_files_x86).join(program));
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let _ = program;

    unique_path_entries(directories)
}

fn command_path_from_directories(program: &str, directories: &[PathBuf]) -> Option<String> {
    let file_names = command_file_names(program);
    directories
        .iter()
        .filter(|directory| !directory.as_os_str().is_empty())
        .find_map(|directory| {
            file_names
                .iter()
                .find_map(|file_name| existing_file_path(directory.join(file_name)))
        })
}

fn command_path_from_environment_path(
    program: &str,
    path_value: Option<OsString>,
) -> Option<String> {
    let directories = path_entries_from_value(path_value);
    command_path_from_directories(program, &directories)
}

fn explicit_command_override_directories() -> Vec<PathBuf> {
    let directories = env::vars_os()
        .filter_map(|(key, value)| {
            let key = key.to_string_lossy();
            if !key.starts_with("OPENDUCKTOR_") || !key.ends_with("_PATH") {
                return None;
            }

            let path = PathBuf::from(value);
            if !path.is_file() {
                return None;
            }

            path.parent().map(Path::to_path_buf)
        })
        .collect::<Vec<_>>();
    unique_path_entries(directories)
}

fn process_path_with_order(
    path_override: Option<&str>,
    bundled_dir_first: bool,
) -> Option<OsString> {
    let bundled_dir = env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf));
    let explicit_override_directories = explicit_command_override_directories();
    let inherited = path_entries_from_value(
        path_override
            .map(OsString::from)
            .or_else(|| env::var_os("PATH")),
    );
    let standard = standard_search_directories();

    let entries = if bundled_dir_first {
        unique_path_entries(
            bundled_dir
                .into_iter()
                .chain(explicit_override_directories)
                .chain(inherited)
                .chain(standard),
        )
    } else {
        unique_path_entries(
            explicit_override_directories
                .into_iter()
                .chain(inherited)
                .chain(standard)
                .chain(bundled_dir),
        )
    };
    path_value_from_entries(&entries)
}

fn augmented_process_path(path_override: Option<&str>) -> Option<OsString> {
    process_path_with_order(path_override, true)
}

fn resolve_command_path_with_path_override(
    program: &str,
    path_override: Option<&str>,
) -> Result<Option<String>> {
    let path = Path::new(program);
    if path.components().count() > 1 {
        return Ok(existing_file_path(path.to_path_buf()));
    }

    if let Some(explicit_path) = explicit_command_override(program)? {
        return Ok(Some(explicit_path));
    }

    let resolved = bundled_command_path(program)
        .or_else(|| {
            command_path_from_environment_path(program, augmented_process_path(path_override))
        })
        .or_else(|| command_path_from_directories(program, &standard_command_directories(program)));
    Ok(resolved)
}

pub fn resolve_command_path(program: &str) -> Result<Option<String>> {
    resolve_command_path_with_path_override(program, None)
}

pub fn subprocess_path_env() -> Option<OsString> {
    process_path_with_order(None, false)
}

fn configured_command(
    program: &str,
    args: &[&str],
    cwd: Option<&Path>,
    env: &[(&str, &str)],
) -> Command {
    let mut command = Command::new(program);
    let path_override = env
        .iter()
        .find_map(|(key, value)| (*key == "PATH").then_some(*value));
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(path) = cwd {
        command.current_dir(path);
    }
    if !env.is_empty() {
        for (key, value) in env.iter().copied().filter(|(key, _)| *key != "PATH") {
            command.env(key, value);
        }
    }
    if let Some(path_value) = augmented_process_path(path_override) {
        command.env("PATH", path_value);
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
    let path_override = env
        .iter()
        .find_map(|(key, value)| (*key == "PATH").then_some(*value));
    let resolved_program = resolve_command_path_with_path_override(program, path_override)?
        .unwrap_or_else(|| program.to_string());
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
    let path_override = env
        .iter()
        .find_map(|(key, value)| (*key == "PATH").then_some(*value));
    let resolved_program = resolve_command_path_with_path_override(program, path_override)?
        .unwrap_or_else(|| program.to_string());
    let output = spawn_command_output(&resolved_program, args, cwd, env)?;

    Ok((
        output.status.success(),
        String::from_utf8_lossy(&output.stdout).trim().to_string(),
        String::from_utf8_lossy(&output.stderr).trim().to_string(),
    ))
}

/// Resolves a command name using the same augmented PATH used for subprocesses.
pub fn command_path(program: &str) -> Option<String> {
    command_path_from_environment_path(program, augmented_process_path(None))
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
        command_path, explicit_command_override, resolve_command_path, run_command,
        run_command_allow_failure, run_command_allow_failure_with_env, run_command_with_env,
        subprocess_path_env, version_command,
    };
    use host_test_support::{lock_env, EnvVarGuard};
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
        #[cfg(windows)]
        let fake_bd = executable_dir.join("bd.exe");
        #[cfg(not(windows))]
        let fake_bd = executable_dir.join("bd");
        fs::write(&fake_executable, "").expect("fake executable should be writable");
        fs::write(&fake_bd, "").expect("fake bundled command should be writable");

        let resolved = bundled_command_path_from_executable(&fake_executable, "bd");
        assert_eq!(
            resolved.as_deref(),
            Some(fake_bd.to_string_lossy().as_ref())
        );

        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn run_command_prefers_env_override_for_command_lookup() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        let program = format!("bd-override-{nonce}");
        let root = std::env::temp_dir().join(format!("odt-command-override-{nonce}"));
        fs::create_dir_all(&root).expect("temp dir should be created");
        let script = root.join(format!("fake-{program}"));
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

        let env_name = command_env_override_name(program.as_str());
        std::env::set_var(&env_name, &script);
        let output =
            run_command(program.as_str(), &[], None).expect("override command should execute");
        std::env::remove_var(&env_name);

        assert_eq!(output, "override-ok");
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn run_command_with_env_prefers_supplied_path_for_lookup() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        let program = format!("bd-path-{nonce}");
        let root = std::env::temp_dir().join(format!("odt-command-path-override-{nonce}"));
        fs::create_dir_all(&root).expect("temp dir should be created");
        let script = root.join(program.as_str());
        fs::write(&script, "#!/bin/sh\nprintf 'path-override-ok'")
            .expect("script should be writable");
        {
            use std::os::unix::fs::PermissionsExt;

            let mut permissions = fs::metadata(&script)
                .expect("script metadata should exist")
                .permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(&script, permissions).expect("script should be executable");
        }

        let output = run_command_with_env(
            program.as_str(),
            &[],
            None,
            &[("PATH", root.to_string_lossy().as_ref())],
        )
        .expect("PATH override command should execute");

        assert_eq!(output, "path-override-ok");
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn run_command_searches_common_user_toolchain_directories() {
        let _env_lock = lock_env();
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        let program = format!("bd-home-{nonce}");
        let home = std::env::temp_dir().join(format!("odt-home-search-{nonce}"));
        let cargo_bin = home.join(".cargo").join("bin");
        fs::create_dir_all(&cargo_bin).expect("toolchain bin dir should be created");

        let script = cargo_bin.join(program.as_str());
        fs::write(&script, "#!/bin/sh\nprintf 'home-search-ok'")
            .expect("script should be writable");
        {
            use std::os::unix::fs::PermissionsExt;

            let mut permissions = fs::metadata(&script)
                .expect("script metadata should exist")
                .permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(&script, permissions).expect("script should be executable");
        }

        let _home_guard = EnvVarGuard::set("HOME", home.to_string_lossy().as_ref());
        let _path_guard = EnvVarGuard::set("PATH", "/usr/bin:/bin");

        let output = run_command(program.as_str(), &[], None)
            .expect("command in common user toolchain dir should execute");

        assert_eq!(output, "home-search-ok");
        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn subprocess_path_env_prioritizes_override_and_inherited_directories() {
        let _env_lock = lock_env();
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("odt-subprocess-path-{nonce}"));
        let override_dir = root.join("override-bin");
        let inherited_a = root.join("inherited-a");
        let inherited_b = root.join("inherited-b");
        fs::create_dir_all(&override_dir).expect("override dir should exist");
        fs::create_dir_all(&inherited_a).expect("inherited dir should exist");
        fs::create_dir_all(&inherited_b).expect("inherited dir should exist");

        let override_file = override_dir.join("custom-bun");
        fs::write(&override_file, "").expect("override file should exist");

        let inherited_path = std::env::join_paths([inherited_a.as_path(), inherited_b.as_path()])
            .expect("inherited path should join");
        let _override_guard = EnvVarGuard::set(
            "OPENDUCKTOR_BUN_PATH",
            override_file.to_string_lossy().as_ref(),
        );
        let _path_guard = EnvVarGuard::set("PATH", inherited_path.to_string_lossy().as_ref());

        let path = subprocess_path_env().expect("subprocess PATH should be assembled");
        let entries = std::env::split_paths(&path).collect::<Vec<_>>();
        let bundled_dir = std::env::current_exe()
            .expect("current executable should resolve")
            .parent()
            .expect("current executable should have parent")
            .to_path_buf();

        let override_index = entries
            .iter()
            .position(|entry| entry == &override_dir)
            .expect("override parent should be included");
        let inherited_a_index = entries
            .iter()
            .position(|entry| entry == &inherited_a)
            .expect("first inherited path should be included");
        let inherited_b_index = entries
            .iter()
            .position(|entry| entry == &inherited_b)
            .expect("second inherited path should be included");
        let bundled_index = entries
            .iter()
            .position(|entry| entry == &bundled_dir)
            .expect("bundled directory should be included");

        assert!(override_index < bundled_index);
        assert!(inherited_a_index < bundled_index);
        assert!(inherited_b_index < bundled_index);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn explicit_command_override_reports_invalid_path() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        let program = format!("bd-missing-{nonce}");
        let env_name = command_env_override_name(program.as_str());
        std::env::set_var(&env_name, "/tmp/odt-missing-command-override");

        let error =
            explicit_command_override(program.as_str()).expect_err("invalid override should fail");
        std::env::remove_var(&env_name);

        assert!(error.to_string().contains("Configured command override"));
    }

    #[test]
    fn resolve_command_path_requires_explicit_paths_to_exist() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        let missing = std::env::temp_dir().join(format!("odt-missing-explicit-command-{nonce}"));
        let missing_str = missing.to_string_lossy().to_string();

        let resolved =
            resolve_command_path(missing_str.as_str()).expect("path resolution should succeed");

        assert!(resolved.is_none());
        assert!(!command_exists(missing_str.as_str()));
    }
}
