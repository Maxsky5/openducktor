use crate::parse_user_path_os;
use anyhow::{anyhow, Context, Result};
use std::env;
use std::ffi::OsString;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
#[cfg(unix)]
use std::process::Child;
use std::process::{Command, Output, Stdio};
#[cfg(unix)]
use std::sync::Mutex;

#[cfg(windows)]
const DEFAULT_WINDOWS_EXECUTABLE_EXTENSIONS: [&str; 4] = [".exe", ".cmd", ".bat", ".com"];

#[cfg(unix)]
const LOGIN_SHELL_ENV_MARKER: &[u8] = b"__OPENDUCKTOR_ENV_START__\0";

#[cfg(unix)]
static LOGIN_SHELL_PATH_CACHE: Mutex<Option<LoginShellPathCacheEntry>> = Mutex::new(None);

#[cfg(unix)]
#[derive(Clone, Eq, PartialEq)]
struct LoginShellPathCacheKey {
    shell: Option<OsString>,
    home: Option<OsString>,
    user: Option<OsString>,
    logname: Option<OsString>,
}

#[cfg(unix)]
#[derive(Clone)]
struct LoginShellPathCacheEntry {
    key: LoginShellPathCacheKey,
    path: Option<OsString>,
}

#[cfg(unix)]
fn login_shell_path_cache_key() -> LoginShellPathCacheKey {
    LoginShellPathCacheKey {
        shell: env::var_os("SHELL"),
        home: env::var_os("HOME"),
        user: env::var_os("USER"),
        logname: env::var_os("LOGNAME"),
    }
}

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
    let Some(raw_path) = env::var_os(&override_name) else {
        return Ok(None);
    };
    let explicit_path = parse_user_path_os(&raw_path)
        .with_context(|| format!("Invalid {override_name} path override"))?;

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

fn existing_file_path(path: PathBuf) -> Option<String> {
    is_executable_file(path.as_path()).then(|| path.to_string_lossy().to_string())
}

#[cfg(unix)]
fn is_executable_file(path: &Path) -> bool {
    path.metadata()
        .map(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable_file(path: &Path) -> bool {
    path.is_file()
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

#[cfg(unix)]
fn standard_search_directories() -> Vec<PathBuf> {
    let mut directories = vec![
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/bin"),
        PathBuf::from("/bin"),
        PathBuf::from("/usr/sbin"),
        PathBuf::from("/sbin"),
    ];

    if let Some(home) = env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(dirs::home_dir)
    {
        directories.push(home.join(".local/bin"));
        directories.push(home.join(".cargo/bin"));
        directories.push(home.join(".bun/bin"));
    }

    unique_path_entries(directories)
}

#[cfg(not(unix))]
fn standard_search_directories() -> Vec<PathBuf> {
    Vec::new()
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

fn explicit_command_override_directories() -> Vec<PathBuf> {
    let directories = env::vars_os()
        .filter_map(|(key, value)| {
            let key = key.to_string_lossy();
            if !key.starts_with("OPENDUCKTOR_") || !key.ends_with("_PATH") {
                return None;
            }

            let path = parse_user_path_os(&value).ok()?;
            if !path.is_file() {
                return None;
            }

            path.parent().map(Path::to_path_buf)
        })
        .collect::<Vec<_>>();
    unique_path_entries(directories)
}

fn current_executable_directory() -> Option<PathBuf> {
    env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf))
}

#[cfg(unix)]
fn current_user_shell() -> Option<PathBuf> {
    use std::ffi::CStr;
    use std::os::unix::ffi::OsStringExt;

    if let Some(shell) = env::var_os("SHELL") {
        let shell = PathBuf::from(shell);
        if shell.is_absolute() {
            return Some(shell);
        }
    }

    let uid = unsafe { libc::geteuid() };
    let mut passwd = unsafe { std::mem::zeroed::<libc::passwd>() };
    let mut result = std::ptr::null_mut();
    let mut buffer = vec![0_u8; 4096];
    let status = unsafe {
        libc::getpwuid_r(
            uid,
            &mut passwd,
            buffer.as_mut_ptr() as *mut libc::c_char,
            buffer.len(),
            &mut result,
        )
    };
    if status != 0 || result.is_null() || passwd.pw_shell.is_null() {
        return None;
    }

    let shell = unsafe { CStr::from_ptr(passwd.pw_shell) };
    let shell = shell.to_bytes();
    if shell.is_empty() {
        return None;
    }

    Some(PathBuf::from(OsString::from_vec(shell.to_vec())))
}

#[cfg(unix)]
fn parse_login_shell_environment(stdout: &[u8]) -> Option<Vec<(OsString, OsString)>> {
    use std::os::unix::ffi::OsStringExt;

    let start = stdout
        .windows(LOGIN_SHELL_ENV_MARKER.len())
        .position(|window| window == LOGIN_SHELL_ENV_MARKER)?;
    let payload = &stdout[start + LOGIN_SHELL_ENV_MARKER.len()..];

    let mut environment = Vec::new();
    for entry in payload.split(|byte| *byte == 0) {
        if entry.is_empty() {
            continue;
        }
        let separator = entry.iter().position(|byte| *byte == b'=')?;
        let key = OsString::from_vec(entry[..separator].to_vec());
        let value = OsString::from_vec(entry[separator + 1..].to_vec());
        environment.push((key, value));
    }
    Some(environment)
}

#[cfg(unix)]
fn terminate_login_shell_probe(child: &mut Child) {
    let pid = child.id() as i32;
    let killed_group = if pid > 0 {
        unsafe { libc::killpg(pid, libc::SIGKILL) == 0 }
    } else {
        false
    };
    if !killed_group {
        let _ = child.kill();
    }
    let _ = child.wait();
}

#[cfg(unix)]
fn read_login_shell_path() -> Option<OsString> {
    use std::os::unix::process::CommandExt;

    let shell = current_user_shell()?;
    let shell_name = shell.file_name()?.to_string_lossy().to_string();
    let mut command = Command::new(&shell);
    command
        .arg("-i")
        .arg("-c")
        .arg("printf '__OPENDUCKTOR_ENV_START__\\0'; /usr/bin/env -0")
        .arg0(format!("-{shell_name}"))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .env_clear()
        .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
        .env("TERM", "dumb")
        .env("SHELL", &shell);

    if let Some(home) = env::var_os("HOME") {
        command.env("HOME", home);
    }
    if let Some(user) = env::var_os("USER") {
        command.env("USER", &user);
        command.env("LOGNAME", user);
    } else if let Some(logname) = env::var_os("LOGNAME") {
        command.env("LOGNAME", logname);
    }

    command.process_group(0);

    let mut child = command.spawn().ok()?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    let output = loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    return None;
                }
                break child.wait_with_output().ok()?;
            }
            Ok(None) => {
                if std::time::Instant::now() >= deadline {
                    terminate_login_shell_probe(&mut child);
                    return env::var_os("PATH");
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            Err(_) => {
                terminate_login_shell_probe(&mut child);
                return None;
            }
        }
    };

    if !output.status.success() {
        return None;
    }

    parse_login_shell_environment(&output.stdout).and_then(|environment| {
        environment
            .into_iter()
            .find_map(|(key, value)| (key == "PATH").then_some(value))
    })
}

#[cfg(unix)]
fn login_shell_path() -> Option<OsString> {
    let key = login_shell_path_cache_key();

    if let Ok(cache) = LOGIN_SHELL_PATH_CACHE.lock() {
        if let Some(entry) = cache.as_ref() {
            if entry.key == key {
                return entry.path.clone();
            }
        }
    }

    let path = read_login_shell_path();

    if let Ok(mut cache) = LOGIN_SHELL_PATH_CACHE.lock() {
        *cache = Some(LoginShellPathCacheEntry {
            key,
            path: path.clone(),
        });
    }

    path
}

#[cfg(not(unix))]
fn login_shell_path() -> Option<OsString> {
    None
}

fn process_path_with_order(
    path_override: Option<&str>,
    bundled_dir_first: bool,
) -> Option<OsString> {
    let explicit_override_directories = explicit_command_override_directories();
    let bundled_dir = current_executable_directory();
    let (login_shell_entries, inherited_entries, standard_entries) =
        if let Some(path_override) = path_override {
            (
                Vec::new(),
                path_entries_from_value(Some(OsString::from(path_override))),
                standard_search_directories(),
            )
        } else {
            (
                path_entries_from_value(login_shell_path()),
                path_entries_from_value(env::var_os("PATH")),
                standard_search_directories(),
            )
        };

    let entries = if bundled_dir_first {
        unique_path_entries(
            bundled_dir
                .into_iter()
                .chain(explicit_override_directories)
                .chain(inherited_entries)
                .chain(login_shell_entries)
                .chain(standard_entries),
        )
    } else {
        unique_path_entries(
            explicit_override_directories
                .into_iter()
                .chain(inherited_entries)
                .chain(login_shell_entries)
                .chain(standard_entries)
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

    let resolved = command_path_from_directories(
        program,
        &path_entries_from_value(augmented_process_path(path_override)),
    );
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

pub fn command_path(program: &str) -> Option<String> {
    resolve_command_path(program).ok().flatten()
}

pub fn command_exists(program: &str) -> bool {
    command_path(program).is_some()
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
        path::{Path, PathBuf},
        time::{SystemTime, UNIX_EPOCH},
    };

    fn unique_temp_path(prefix: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("{prefix}-{nonce}"))
    }

    #[cfg(unix)]
    fn write_executable(path: &Path, body: &str) {
        use std::os::unix::fs::PermissionsExt;

        fs::write(path, body).expect("script should be writable");
        let mut permissions = fs::metadata(path)
            .expect("script metadata should exist")
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(path, permissions).expect("script should be executable");
    }

    #[cfg(unix)]
    fn write_fake_login_shell(shell_path: &Path, login_path: &Path) {
        write_executable(
            shell_path,
            format!(
                "#!/bin/sh\nprintf 'shell startup noise\\n'\nprintf '__OPENDUCKTOR_ENV_START__\\0PATH={}\\0'\n",
                login_path.display()
            )
            .as_str(),
        );
    }

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
        let marker = unique_temp_path("odt-command-path-marker");
        let payload = format!("definitely_not_real_$(touch {})", marker.display());

        assert!(command_path(payload.as_str()).is_none());
        assert!(
            !marker.exists(),
            "payload should not be able to execute touch via shell expansion"
        );
    }

    #[test]
    fn bundled_command_path_resolves_sibling_binary() {
        let root = unique_temp_path("odt-bundled-command");
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
        let _env_lock = lock_env();
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        let program = format!("bd-override-{nonce}");
        let root = unique_temp_path("odt-command-override");
        fs::create_dir_all(&root).expect("temp dir should be created");
        let script = root.join(format!("fake-{program}"));
        write_executable(&script, "#!/bin/sh\nprintf 'override-ok'");

        let env_name = command_env_override_name(program.as_str());
        let _override_guard = EnvVarGuard::set(&env_name, script.to_string_lossy().as_ref());
        let output = run_command(&program, &[], None).expect("override command should execute");

        assert_eq!(output, "override-ok");
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn run_command_prefers_tilde_expanded_env_override_for_command_lookup() {
        let _env_lock = lock_env();
        let root = unique_temp_path("odt-command-override-home");
        let home = root.join("home");
        let script_dir = home.join("bin");
        fs::create_dir_all(&script_dir).expect("script dir should be created");
        let program = "bd-override-home";
        let script = script_dir.join(format!("fake-{program}"));
        write_executable(&script, "#!/bin/sh\nprintf 'override-home-ok'");

        let env_name = command_env_override_name(program);
        let _home_guard = EnvVarGuard::set("HOME", home.to_string_lossy().as_ref());
        let _override_guard = EnvVarGuard::set(&env_name, format!("~/bin/fake-{program}").as_str());
        let output = run_command(program, &[], None).expect("override command should execute");

        assert_eq!(output, "override-home-ok");
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn run_command_with_env_prefers_supplied_path_for_lookup() {
        let program = "bd-path-test";
        let root = unique_temp_path("odt-command-path-override");
        fs::create_dir_all(&root).expect("temp dir should be created");
        let script = root.join(program);
        write_executable(&script, "#!/bin/sh\nprintf 'path-override-ok'");

        let output = run_command_with_env(
            program,
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
    fn run_command_uses_standard_user_toolchain_dirs_when_login_shell_lookup_fails() {
        let _env_lock = lock_env();
        let root = unique_temp_path("odt-standard-user-path");
        let home = root.join("home");
        let bun_bin = home.join(".bun").join("bin");
        fs::create_dir_all(&bun_bin).expect("standard bun directory should exist");
        let program = "odt-standard-path-cli";
        let script = bun_bin.join(program);
        write_executable(&script, "#!/bin/sh\nprintf 'standard-path-ok'");

        let _shell_guard = EnvVarGuard::set("SHELL", "/tmp/odt-missing-shell");
        let _path_guard = EnvVarGuard::set("PATH", "/usr/bin:/bin");
        let _home_guard = EnvVarGuard::set("HOME", home.to_string_lossy().as_ref());
        let _user_guard = EnvVarGuard::set("USER", "odt-test");
        let _logname_guard = EnvVarGuard::set("LOGNAME", "odt-test");

        let output = run_command(program, &[], None)
            .expect("standard toolchain directories should be used for lookup");

        assert_eq!(output, "standard-path-ok");
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn run_command_uses_login_shell_path_for_lookup() {
        let _env_lock = lock_env();
        let root = unique_temp_path("odt-login-shell-command");
        let login_bin = root.join("login-bin");
        fs::create_dir_all(&login_bin).expect("login path should exist");
        let shell = root.join("fake-shell");
        let program = "node";
        let script = login_bin.join(program);
        write_executable(&script, "#!/bin/sh\nprintf 'login-shell-ok'");
        write_fake_login_shell(&shell, &login_bin);

        let _shell_guard = EnvVarGuard::set("SHELL", shell.to_string_lossy().as_ref());
        let _path_guard = EnvVarGuard::set("PATH", "/usr/bin:/bin");
        let _home_guard = EnvVarGuard::set("HOME", root.to_string_lossy().as_ref());
        let _user_guard = EnvVarGuard::set("USER", "odt-test");
        let _logname_guard = EnvVarGuard::set("LOGNAME", "odt-test");

        let output =
            run_command(program, &[], None).expect("login shell path should resolve command");

        assert_eq!(output, "login-shell-ok");

        fs::remove_file(&shell).expect("fake shell should be removable after first lookup");
        let cached_output =
            run_command(program, &[], None).expect("cached login shell path should be reused");

        assert_eq!(cached_output, "login-shell-ok");
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn run_command_falls_back_to_inherited_path_when_login_shell_probe_times_out() {
        let _env_lock = lock_env();
        let root = unique_temp_path("odt-login-shell-timeout");
        let inherited_bin = root.join("inherited-bin");
        fs::create_dir_all(&inherited_bin).expect("inherited path should exist");

        let shell = root.join("slow-shell");
        write_executable(&shell, "#!/bin/sh\nsleep 6\n");

        let program = "odt-login-timeout-cli";
        let script = inherited_bin.join(program);
        write_executable(&script, "#!/bin/sh\nprintf 'timeout-fallback-ok'");

        let _shell_guard = EnvVarGuard::set("SHELL", shell.to_string_lossy().as_ref());
        let inherited_path = format!("{}:/usr/bin:/bin", inherited_bin.display());
        let _path_guard = EnvVarGuard::set("PATH", inherited_path.as_str());
        let _home_guard = EnvVarGuard::set("HOME", root.to_string_lossy().as_ref());
        let _user_guard = EnvVarGuard::set("USER", "odt-test");
        let _logname_guard = EnvVarGuard::set("LOGNAME", "odt-test");

        let output = run_command(program, &[], None)
            .expect("inherited PATH should be used when login shell probe times out");

        assert_eq!(output, "timeout-fallback-ok");
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn subprocess_path_env_combines_override_login_shell_inherited_and_bundled_dirs() {
        let _env_lock = lock_env();
        let root = unique_temp_path("odt-subprocess-path");
        let override_dir = root.join("override-bin");
        let login_dir = root.join("login-bin");
        let inherited_dir = root.join("inherited-bin");
        let standard_cargo_dir = root.join(".cargo").join("bin");
        let standard_bun_dir = root.join(".bun").join("bin");
        let standard_local_dir = root.join(".local").join("bin");
        fs::create_dir_all(&override_dir).expect("override dir should exist");
        fs::create_dir_all(&login_dir).expect("login dir should exist");
        fs::create_dir_all(&inherited_dir).expect("inherited dir should exist");
        fs::create_dir_all(&standard_cargo_dir).expect("standard cargo dir should exist");
        fs::create_dir_all(&standard_bun_dir).expect("standard bun dir should exist");
        fs::create_dir_all(&standard_local_dir).expect("standard local dir should exist");

        let override_file = override_dir.join("custom-bun");
        fs::write(&override_file, "").expect("override file should exist");

        let shell = root.join("fake-shell");
        write_fake_login_shell(&shell, &login_dir);

        let _override_guard = EnvVarGuard::set(
            "OPENDUCKTOR_BUN_PATH",
            override_file.to_string_lossy().as_ref(),
        );
        let _shell_guard = EnvVarGuard::set("SHELL", shell.to_string_lossy().as_ref());
        let inherited_path = format!("{}:/usr/bin:/bin", inherited_dir.display());
        let _path_guard = EnvVarGuard::set("PATH", inherited_path.as_str());
        let _home_guard = EnvVarGuard::set("HOME", root.to_string_lossy().as_ref());
        let _user_guard = EnvVarGuard::set("USER", "odt-test");
        let _logname_guard = EnvVarGuard::set("LOGNAME", "odt-test");

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
        let login_index = entries
            .iter()
            .position(|entry| entry == &login_dir)
            .expect("login shell path should be included");
        let inherited_index = entries
            .iter()
            .position(|entry| entry == &inherited_dir)
            .expect("inherited path should be included");
        let standard_local_index = entries
            .iter()
            .position(|entry| entry == &standard_local_dir)
            .expect("standard local bin should be included");
        let standard_cargo_index = entries
            .iter()
            .position(|entry| entry == &standard_cargo_dir)
            .expect("standard cargo bin should be included");
        let standard_bun_index = entries
            .iter()
            .position(|entry| entry == &standard_bun_dir)
            .expect("standard bun bin should be included");
        let bundled_index = entries
            .iter()
            .position(|entry| entry == &bundled_dir)
            .expect("bundled directory should be included");

        assert!(override_index < inherited_index);
        assert!(inherited_index < login_index);
        assert!(inherited_index < standard_local_index);
        assert!(standard_local_index <= standard_cargo_index);
        assert!(standard_cargo_index <= standard_bun_index);
        assert!(inherited_index < bundled_index);
        assert!(standard_bun_index < bundled_index);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn explicit_command_override_reports_invalid_path() {
        let _env_lock = lock_env();
        let program = format!("bd-missing-{}", unique_temp_path("nonce").display());
        let env_name = command_env_override_name(program.as_str());
        let _override_guard = EnvVarGuard::set(&env_name, "/tmp/odt-missing-command-override");

        let error =
            explicit_command_override(program.as_str()).expect_err("invalid override should fail");

        assert!(error.to_string().contains("Configured command override"));
    }

    #[test]
    fn resolve_command_path_requires_explicit_paths_to_exist() {
        let missing = unique_temp_path("odt-missing-explicit-command");
        let missing_str = missing.to_string_lossy().to_string();

        let resolved =
            resolve_command_path(missing_str.as_str()).expect("path resolution should succeed");

        assert!(resolved.is_none());
        assert!(!command_exists(missing_str.as_str()));
    }
}
