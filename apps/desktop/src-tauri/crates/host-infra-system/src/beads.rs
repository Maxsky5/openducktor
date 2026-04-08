use anyhow::{anyhow, Context, Result};
use chrono::Utc;
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::env;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::net::{TcpListener, TcpStream};
#[cfg(unix)]
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};
#[cfg(not(unix))]
use sysinfo::Signal;
use sysinfo::{Pid, ProcessesToUpdate, System};

use crate::{
    config::resolve_openducktor_base_dir, parse_user_path, resolve_command_path,
    subprocess_path_env,
};

pub const SHARED_DOLT_SERVER_HOST: &str = "127.0.0.1";
pub const SHARED_DOLT_SERVER_USER: &str = "root";

const SHARED_DOLT_PORT_RANGE_START: u16 = 36_000;
const SHARED_DOLT_PORT_RANGE_LEN: u16 = 10_000;
const SHARED_DOLT_HEALTH_TIMEOUT: Duration = Duration::from_secs(5);
const SHARED_DOLT_HEALTH_POLL_INTERVAL: Duration = Duration::from_millis(100);
const SHARED_DOLT_TCP_TIMEOUT: Duration = Duration::from_millis(250);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepoBeadsPaths {
    pub repo_id: String,
    pub attachment_root: PathBuf,
    pub attachment_dir: PathBuf,
    pub database_name: String,
    pub live_database_dir: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SharedDoltServerState {
    pub pid: u32,
    pub owner_pid: u32,
    pub host: String,
    pub user: String,
    pub port: u16,
    pub shared_server_root: PathBuf,
    pub dolt_data_dir: PathBuf,
    pub started_at: String,
}

pub fn compute_repo_slug(repo_path: &Path) -> String {
    let candidate = repo_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("repo");
    sanitize_slug(candidate)
}

pub fn compute_repo_id(repo_path: &Path) -> Result<String> {
    let resolved = canonical_or_absolute(repo_path)?;
    let canonical_string = resolved.to_string_lossy().to_string();
    let slug = compute_repo_slug(&resolved);

    let mut hasher = Sha256::new();
    hasher.update(canonical_string.as_bytes());
    let digest = format!("{:x}", hasher.finalize());
    let short_hash = &digest[..8];

    Ok(format!("{slug}-{short_hash}"))
}

pub fn compute_beads_database_name(repo_path: &Path) -> Result<String> {
    let resolved_repo_path = canonical_or_absolute(repo_path)?;
    let slug = sanitize_database_identifier(&compute_repo_slug(&resolved_repo_path));
    let digest = Sha256::digest(resolved_repo_path.to_string_lossy().as_bytes());
    let hash_suffix = format!("{digest:x}");
    let hash_suffix = &hash_suffix[..12];
    let max_slug_len = 64usize.saturating_sub("odt__".len() + hash_suffix.len());
    let truncated_slug = if slug.len() > max_slug_len {
        &slug[..max_slug_len]
    } else {
        slug.as_str()
    };

    Ok(format!("odt_{truncated_slug}_{hash_suffix}"))
}

pub fn resolve_beads_root() -> Result<PathBuf> {
    Ok(resolve_openducktor_base_dir()?.join("beads"))
}

pub fn resolve_shared_server_root() -> Result<PathBuf> {
    Ok(resolve_beads_root()?.join("shared-server"))
}

pub fn resolve_shared_dolt_root() -> Result<PathBuf> {
    Ok(resolve_shared_server_root()?.join("dolt"))
}

pub fn resolve_dolt_config_dir() -> Result<PathBuf> {
    Ok(resolve_shared_server_root()?.join(".doltcfg"))
}

pub fn resolve_dolt_config_file() -> Result<PathBuf> {
    Ok(resolve_shared_server_root()?.join("dolt-config.yaml"))
}

pub fn resolve_server_state_file() -> Result<PathBuf> {
    Ok(resolve_shared_server_root()?.join("server.json"))
}

pub fn resolve_server_lock_file() -> Result<PathBuf> {
    Ok(resolve_shared_server_root()?.join("server.lock"))
}

pub fn resolve_repo_beads_attachment_root(repo_path: &Path) -> Result<PathBuf> {
    Ok(resolve_beads_root()?.join(compute_repo_id(repo_path)?))
}

pub fn resolve_repo_beads_attachment_dir(repo_path: &Path) -> Result<PathBuf> {
    Ok(resolve_repo_beads_attachment_root(repo_path)?.join(".beads"))
}

pub fn resolve_repo_live_database_dir(repo_path: &Path) -> Result<PathBuf> {
    Ok(resolve_shared_dolt_root()?.join(compute_beads_database_name(repo_path)?))
}

pub fn resolve_repo_beads_paths(repo_path: &Path) -> Result<RepoBeadsPaths> {
    let repo_id = compute_repo_id(repo_path)?;
    let attachment_root = resolve_beads_root()?.join(&repo_id);
    let attachment_dir = attachment_root.join(".beads");
    let database_name = compute_beads_database_name(repo_path)?;
    let live_database_dir = resolve_shared_dolt_root()?.join(&database_name);

    Ok(RepoBeadsPaths {
        repo_id,
        attachment_root,
        attachment_dir,
        database_name,
        live_database_dir,
    })
}

pub fn read_shared_dolt_server_state() -> Result<Option<SharedDoltServerState>> {
    let state_file = resolve_server_state_file()?;
    read_server_state_from_path(&state_file)
}

pub fn ensure_shared_dolt_server_running(owner_pid: u32) -> Result<SharedDoltServerState> {
    let shared_server_root = resolve_shared_server_root()?;
    let dolt_root = resolve_shared_dolt_root()?;
    let cfg_dir = resolve_dolt_config_dir()?;
    fs::create_dir_all(&shared_server_root).with_context(|| {
        format!(
            "Failed creating shared Dolt server root {}",
            shared_server_root.display()
        )
    })?;
    fs::create_dir_all(&dolt_root)
        .with_context(|| format!("Failed creating Dolt data root {}", dolt_root.display()))?;
    fs::create_dir_all(&cfg_dir)
        .with_context(|| format!("Failed creating Dolt config dir {}", cfg_dir.display()))?;

    let _lock = lock_shared_server_state()?;
    let state_file = resolve_server_state_file()?;
    if let Some(existing) = read_server_state_from_path(&state_file)? {
        if is_server_state_healthy(&existing, &shared_server_root, &dolt_root)? {
            if existing.owner_pid != owner_pid && !is_process_alive(existing.owner_pid) {
                let adopted = SharedDoltServerState {
                    owner_pid,
                    ..existing.clone()
                };
                write_server_state(&state_file, &adopted)?;
                return Ok(adopted);
            }
            return Ok(existing);
        }

        if !is_process_alive(existing.owner_pid)
            && is_process_alive(existing.pid)
            && process_matches_expected_dolt_server(existing.pid, &shared_server_root)?
        {
            terminate_process_by_pid(existing.pid, &shared_server_root).with_context(|| {
                format!(
                    "Failed terminating stale shared Dolt server pid {} for {}",
                    existing.pid,
                    shared_server_root.display()
                )
            })?;
        }

        remove_if_exists(&state_file).with_context(|| {
            format!(
                "Failed removing stale server state {}",
                state_file.display()
            )
        })?;
    }

    let base_port = deterministic_shared_dolt_port_candidate()?;
    for offset in 0..u32::from(SHARED_DOLT_PORT_RANGE_LEN) {
        let port = wrap_port_candidate(base_port, offset);
        if !is_port_available(port) {
            continue;
        }

        write_dolt_config_file(port)?;
        match spawn_shared_dolt_server(owner_pid, port, &shared_server_root, &dolt_root) {
            Ok(state) => {
                write_server_state(&state_file, &state)?;
                return Ok(state);
            }
            Err(error) if error_should_continue_to_next_port(&error) => continue,
            Err(error) => return Err(error),
        }
    }

    Err(anyhow!(
        "Failed to start a shared Dolt server for {}; no available port in {}-{}",
        shared_server_root.display(),
        SHARED_DOLT_PORT_RANGE_START,
        SHARED_DOLT_PORT_RANGE_START + SHARED_DOLT_PORT_RANGE_LEN - 1
    ))
}

pub fn stop_shared_dolt_server_for_current_owner(owner_pid: u32) -> Result<bool> {
    let state_file = resolve_server_state_file()?;
    if !state_file.exists() {
        return Ok(false);
    }

    let _lock = lock_shared_server_state()?;
    let Some(state) = read_server_state_from_path(&state_file)? else {
        return Ok(false);
    };

    if state.owner_pid != owner_pid {
        return Ok(false);
    }

    terminate_process_by_pid(state.pid, &state.shared_server_root)?;
    remove_if_exists(&state_file)
        .with_context(|| format!("Failed removing shared Dolt state {}", state_file.display()))?;
    Ok(true)
}

pub fn restore_shared_dolt_database_from_backup(
    owner_pid: u32,
    database_name: &str,
    backup_dir: &Path,
) -> Result<()> {
    let shared_server_root = resolve_shared_server_root()?;
    let shared_dolt_root = resolve_shared_dolt_root()?;
    fs::create_dir_all(&shared_dolt_root).with_context(|| {
        format!(
            "Failed creating Dolt data root {}",
            shared_dolt_root.display()
        )
    })?;

    let restart_server = {
        let _lock = lock_shared_server_state()?;
        let state_file = resolve_server_state_file()?;
        let mut restart_server = false;
        if let Some(existing) = read_server_state_from_path(&state_file)? {
            let process_alive = is_process_alive(existing.pid);
            let process_matches =
                process_matches_expected_dolt_server(existing.pid, &shared_server_root)?;
            if process_alive && process_matches {
                if existing.owner_pid != owner_pid {
                    return Err(anyhow!(
                        "Shared Dolt server for {} is running under owner pid {} and cannot be stopped for restore by pid {}",
                        shared_server_root.display(),
                        existing.owner_pid,
                        owner_pid
                    ));
                }

                terminate_process_by_pid(existing.pid, &existing.shared_server_root)?;
                restart_server = true;
            }

            remove_if_exists(&state_file).with_context(|| {
                format!(
                    "Failed removing shared Dolt state {} before restore",
                    state_file.display()
                )
            })?;
        }

        let backup_url = format!("file://{}", backup_dir.display());
        crate::run_command(
            "dolt",
            &["backup", "restore", backup_url.as_str(), database_name],
            Some(&shared_dolt_root),
        )
        .with_context(|| {
            format!(
                "Failed restoring shared Dolt database {database_name} from {}",
                backup_dir.display()
            )
        })?;
        restart_server
    };

    if restart_server {
        ensure_shared_dolt_server_running(owner_pid)?;
    }

    Ok(())
}

pub fn resolve_default_worktree_base_dir(repo_path: &Path) -> Result<PathBuf> {
    resolve_repo_scoped_openducktor_dir(repo_path, "worktrees")
}

pub fn resolve_effective_worktree_base_dir(
    repo_path: &Path,
    configured_worktree_base_path: Option<&str>,
) -> Result<PathBuf> {
    match configured_worktree_base_path {
        Some(configured_path) => parse_user_path(configured_path),
        None => resolve_default_worktree_base_dir(repo_path),
    }
}

fn resolve_repo_scoped_openducktor_dir(repo_path: &Path, namespace: &str) -> Result<PathBuf> {
    let base_dir = resolve_openducktor_base_dir()?;
    let repo_id = compute_repo_id(repo_path)?;
    Ok(base_dir.join(namespace).join(repo_id))
}

fn read_server_state_from_path(path: &Path) -> Result<Option<SharedDoltServerState>> {
    if !path.exists() {
        return Ok(None);
    }

    let payload = fs::read_to_string(path)
        .with_context(|| format!("Failed reading shared Dolt server state {}", path.display()))?;
    let state = serde_json::from_str(&payload)
        .with_context(|| format!("Failed parsing shared Dolt server state {}", path.display()))?;
    Ok(Some(state))
}

fn write_server_state(path: &Path, state: &SharedDoltServerState) -> Result<()> {
    let payload = serde_json::to_string_pretty(state).context("Failed serializing server state")?;
    fs::write(path, payload)
        .with_context(|| format!("Failed writing shared Dolt server state {}", path.display()))
}

fn lock_shared_server_state() -> Result<File> {
    let lock_file = resolve_server_lock_file()?;
    if let Some(parent) = lock_file.parent() {
        fs::create_dir_all(parent).with_context(|| {
            format!(
                "Failed creating shared Dolt lock parent {}",
                parent.display()
            )
        })?;
    }
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(&lock_file)
        .with_context(|| {
            format!(
                "Failed opening shared Dolt lock file {}",
                lock_file.display()
            )
        })?;
    file.lock_exclusive()
        .with_context(|| format!("Failed locking shared Dolt state {}", lock_file.display()))?;
    Ok(file)
}

fn is_server_state_healthy(
    state: &SharedDoltServerState,
    expected_shared_server_root: &Path,
    expected_dolt_root: &Path,
) -> Result<bool> {
    if state.host != SHARED_DOLT_SERVER_HOST || state.user != SHARED_DOLT_SERVER_USER {
        return Ok(false);
    }
    if !paths_match(&state.shared_server_root, expected_shared_server_root)?
        || !paths_match(&state.dolt_data_dir, expected_dolt_root)?
    {
        return Ok(false);
    }
    if !is_process_alive(state.pid)
        || !process_matches_expected_dolt_server(state.pid, expected_shared_server_root)?
    {
        return Ok(false);
    }
    if !tcp_probe(state.port) {
        return Ok(false);
    }
    sql_probe(state.port)
}

fn paths_match(left: &Path, right: &Path) -> Result<bool> {
    Ok(canonical_or_absolute(left)? == canonical_or_absolute(right)?)
}

fn deterministic_shared_dolt_port_candidate() -> Result<u16> {
    let base_dir = canonical_or_absolute(&resolve_openducktor_base_dir()?)?;
    let digest = Sha256::digest(base_dir.to_string_lossy().as_bytes());
    let offset = u16::from_be_bytes([digest[0], digest[1]]) % SHARED_DOLT_PORT_RANGE_LEN;
    Ok(SHARED_DOLT_PORT_RANGE_START + offset)
}

fn wrap_port_candidate(base: u16, offset: u32) -> u16 {
    let normalized_base = base - SHARED_DOLT_PORT_RANGE_START;
    SHARED_DOLT_PORT_RANGE_START
        + (((u32::from(normalized_base) + offset) % u32::from(SHARED_DOLT_PORT_RANGE_LEN)) as u16)
}

fn is_port_available(port: u16) -> bool {
    TcpListener::bind((SHARED_DOLT_SERVER_HOST, port)).is_ok()
}

fn write_dolt_config_file(port: u16) -> Result<()> {
    let shared_server_root = resolve_shared_server_root()?;
    let config_file = resolve_dolt_config_file()?;
    let dolt_root = resolve_shared_dolt_root()?;
    let cfg_dir = resolve_dolt_config_dir()?;
    let privilege_file = cfg_dir.join("privileges.db");
    let branch_control_file = cfg_dir.join("branch_control.db");

    fs::create_dir_all(&shared_server_root)
        .with_context(|| format!("Failed creating {}", shared_server_root.display()))?;

    let config = format!(
        "log_level: info\nbehavior:\n  autocommit: true\nlistener:\n  host: {host}\n  port: {port}\ndata_dir: {data_dir}\ncfg_dir: {cfg_dir}\nprivilege_file: {privilege_file}\nbranch_control_file: {branch_control_file}\n",
        host = SHARED_DOLT_SERVER_HOST,
        port = port,
        data_dir = yaml_quote_path(&dolt_root),
        cfg_dir = yaml_quote_path(&cfg_dir),
        privilege_file = yaml_quote_path(&privilege_file),
        branch_control_file = yaml_quote_path(&branch_control_file),
    );

    let temp_file = config_file.with_extension(format!("yaml.tmp-{}", std::process::id()));
    let mut file = File::create(&temp_file).with_context(|| {
        format!(
            "Failed creating Dolt config temp file {}",
            temp_file.display()
        )
    })?;
    file.write_all(config.as_bytes()).with_context(|| {
        format!(
            "Failed writing Dolt config temp file {}",
            temp_file.display()
        )
    })?;
    fs::rename(&temp_file, &config_file).with_context(|| {
        format!(
            "Failed replacing Dolt config {} from {}",
            config_file.display(),
            temp_file.display()
        )
    })?;
    Ok(())
}

fn yaml_quote_path(path: &Path) -> String {
    format!("'{}'", path.display().to_string().replace('\'', "''"))
}

fn spawn_shared_dolt_server(
    owner_pid: u32,
    port: u16,
    shared_server_root: &Path,
    dolt_root: &Path,
) -> Result<SharedDoltServerState> {
    let config_file = resolve_dolt_config_file()?;
    let stderr_log = shared_server_root.join("server.stderr.log");
    let stdout_log = shared_server_root.join("server.stdout.log");
    let stdout = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&stdout_log)
        .with_context(|| format!("Failed opening {}", stdout_log.display()))?;
    let stderr = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&stderr_log)
        .with_context(|| format!("Failed opening {}", stderr_log.display()))?;
    let dolt_binary = resolve_command_path("dolt")?.ok_or_else(|| {
        anyhow!("dolt not found in bundled locations, standard install locations, or PATH")
    })?;

    let mut command = Command::new(&dolt_binary);
    command
        .arg("sql-server")
        .arg("--config")
        .arg(&config_file)
        .current_dir(shared_server_root)
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr));
    if let Some(path_value) = subprocess_path_env() {
        command.env("PATH", path_value);
    }
    #[cfg(unix)]
    command.process_group(0);

    let mut child = command.spawn().with_context(|| {
        format!(
            "Failed starting shared Dolt server with config {}",
            config_file.display()
        )
    })?;

    if wait_for_server_ready(port)? {
        return Ok(SharedDoltServerState {
            pid: child.id(),
            owner_pid,
            host: SHARED_DOLT_SERVER_HOST.to_string(),
            user: SHARED_DOLT_SERVER_USER.to_string(),
            port,
            shared_server_root: shared_server_root.to_path_buf(),
            dolt_data_dir: dolt_root.to_path_buf(),
            started_at: Utc::now().to_rfc3339(),
        });
    }

    let status = child
        .try_wait()
        .context("Failed checking shared Dolt server process state")?;
    if status.is_none() {
        let _ = child.kill();
        let _ = child.wait();
    }

    let stderr_output = fs::read_to_string(&stderr_log).unwrap_or_default();
    let stderr_output = stderr_output.trim();
    let error_message = if stderr_output.is_empty() {
        format!(
            "Shared Dolt server on port {port} failed to become ready within {}ms",
            SHARED_DOLT_HEALTH_TIMEOUT.as_millis()
        )
    } else {
        format!("Shared Dolt server on port {port} failed to become ready: {stderr_output}")
    };

    Err(anyhow!(error_message))
}

fn wait_for_server_ready(port: u16) -> Result<bool> {
    let deadline = Instant::now() + SHARED_DOLT_HEALTH_TIMEOUT;
    while Instant::now() < deadline {
        if tcp_probe(port) && sql_probe(port)? {
            return Ok(true);
        }
        thread::sleep(SHARED_DOLT_HEALTH_POLL_INTERVAL);
    }
    Ok(false)
}

fn tcp_probe(port: u16) -> bool {
    let address = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&address, SHARED_DOLT_TCP_TIMEOUT).is_ok()
}

fn sql_probe(port: u16) -> Result<bool> {
    let port_string = port.to_string();
    let args = [
        "--host",
        SHARED_DOLT_SERVER_HOST,
        "--port",
        port_string.as_str(),
        "--no-tls",
        "-u",
        SHARED_DOLT_SERVER_USER,
        "-p",
        "",
        "sql",
        "-q",
        "show databases",
    ];
    let (ok, _, _) = crate::run_command_allow_failure("dolt", &args, None)?;
    Ok(ok)
}

fn error_should_continue_to_next_port(error: &anyhow::Error) -> bool {
    let message = error.to_string().to_ascii_lowercase();
    message.contains("address already in use")
        || message.contains("bind")
        || message.contains("listen tcp")
}

fn remove_if_exists(path: &Path) -> Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

fn terminate_process_by_pid(pid: u32, expected_shared_server_root: &Path) -> Result<()> {
    if !is_process_alive(pid) {
        return Ok(());
    }
    if !process_matches_expected_dolt_server(pid, expected_shared_server_root)? {
        return Err(anyhow!(
            "Refusing to terminate pid {} because it no longer matches the expected shared Dolt server under {}",
            pid,
            expected_shared_server_root.display()
        ));
    }

    #[cfg(unix)]
    {
        let raw_pid = pid as i32;
        let terminate_status = unsafe { libc::kill(raw_pid, libc::SIGTERM) };
        if terminate_status != 0 {
            return Err(std::io::Error::last_os_error())
                .with_context(|| format!("Failed sending SIGTERM to Dolt pid {pid}"));
        }
        wait_for_process_exit(pid, Duration::from_secs(3));
        if is_process_alive(pid) {
            let kill_status = unsafe { libc::kill(raw_pid, libc::SIGKILL) };
            if kill_status != 0 {
                return Err(std::io::Error::last_os_error())
                    .with_context(|| format!("Failed sending SIGKILL to Dolt pid {pid}"));
            }
            wait_for_process_exit(pid, Duration::from_secs(2));
        }
        return Ok(());
    }

    #[cfg(not(unix))]
    {
        let mut system = System::new_all();
        system.refresh_processes(ProcessesToUpdate::All, true);
        let Some(process) = system.process(Pid::from_u32(pid)) else {
            return Ok(());
        };

        if !process.kill_with(Signal::Term).unwrap_or(false) {
            if !process.kill() {
                return Err(anyhow!("Failed terminating Dolt pid {pid}"));
            }
        }
        wait_for_process_exit(pid, Duration::from_secs(3));
        Ok(())
    }
}

fn wait_for_process_exit(pid: u32, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if !is_process_alive(pid) {
            return true;
        }
        thread::sleep(Duration::from_millis(50));
    }
    !is_process_alive(pid)
}

fn is_process_alive(pid: u32) -> bool {
    let mut system = System::new_all();
    system.refresh_processes(ProcessesToUpdate::All, true);
    system.process(Pid::from_u32(pid)).is_some()
}

fn process_matches_expected_dolt_server(
    pid: u32,
    expected_shared_server_root: &Path,
) -> Result<bool> {
    let mut system = System::new_all();
    system.refresh_processes(ProcessesToUpdate::All, true);
    let Some(process) = system.process(Pid::from_u32(pid)) else {
        return Ok(false);
    };

    let process_name = process.name().to_string_lossy().to_ascii_lowercase();
    if !process_name.contains("dolt") {
        return Ok(false);
    }

    let command_line = process
        .cmd()
        .iter()
        .map(|value| value.to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    if !command_line.iter().any(|arg| arg == "sql-server") {
        return Ok(false);
    }

    if let Some(cwd) = process.cwd() {
        if paths_match(cwd, expected_shared_server_root)? {
            return Ok(true);
        }
    }

    let expected_config = expected_shared_server_root.join("dolt-config.yaml");
    for args in command_line.windows(2) {
        if args[0] == "--config" && paths_match(Path::new(&args[1]), &expected_config)? {
            return Ok(true);
        }
    }

    Ok(false)
}

fn canonical_or_absolute(repo_path: &Path) -> Result<PathBuf> {
    canonical_or_absolute_from(
        repo_path,
        &env::current_dir().context("Unable to resolve current working directory")?,
    )
}

fn canonical_or_absolute_from(path: &Path, base_dir: &Path) -> Result<PathBuf> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        base_dir.join(path)
    };

    Ok(fs::canonicalize(&absolute).unwrap_or(absolute))
}

fn sanitize_slug(input: &str) -> String {
    let mut slug = String::new();
    let mut last_dash = false;

    for char in input.chars() {
        let lower = char.to_ascii_lowercase();
        if lower.is_ascii_alphanumeric() {
            slug.push(lower);
            last_dash = false;
            continue;
        }

        if !last_dash {
            slug.push('-');
            last_dash = true;
        }
    }

    while slug.starts_with('-') {
        slug.remove(0);
    }
    while slug.ends_with('-') {
        slug.pop();
    }

    if slug.is_empty() {
        "repo".to_string()
    } else {
        slug
    }
}

fn sanitize_database_identifier(input: &str) -> String {
    let sanitized = input
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect::<String>();
    let trimmed = sanitized.trim_matches('_').to_string();
    if trimmed.is_empty() {
        "repo".to_string()
    } else {
        trimmed
    }
}

#[cfg(test)]
mod tests {
    use super::{
        compute_beads_database_name, compute_repo_id, compute_repo_slug,
        deterministic_shared_dolt_port_candidate, ensure_shared_dolt_server_running,
        is_process_alive, process_matches_expected_dolt_server, read_shared_dolt_server_state,
        resolve_beads_root, resolve_default_worktree_base_dir, resolve_dolt_config_dir,
        resolve_dolt_config_file, resolve_effective_worktree_base_dir,
        resolve_repo_beads_attachment_dir, resolve_repo_beads_attachment_root,
        resolve_repo_beads_paths, resolve_repo_live_database_dir, resolve_server_lock_file,
        resolve_server_state_file, resolve_shared_dolt_root, resolve_shared_server_root,
        stop_shared_dolt_server_for_current_owner, wrap_port_candidate, write_dolt_config_file,
        SharedDoltServerState, SHARED_DOLT_PORT_RANGE_LEN, SHARED_DOLT_PORT_RANGE_START,
    };
    use anyhow::Result;
    use host_test_support::{lock_env, EnvVarGuard};
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_config_root(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time should be after epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("odt-shared-dolt-{label}-{nanos}"))
    }

    fn skip_if_dolt_unavailable() -> bool {
        crate::resolve_command_path("dolt")
            .expect("dolt resolution should not fail")
            .is_none()
    }

    #[test]
    fn slug_sanitizes_to_ascii_and_collapses_separators() {
        let slug = compute_repo_slug(Path::new("/tmp/___My Repo___"));
        assert_eq!(slug, "my-repo");
    }

    #[test]
    fn slug_falls_back_to_repo_when_empty() {
        let slug = compute_repo_slug(Path::new("///"));
        assert_eq!(slug, "repo");
    }

    #[test]
    fn repo_id_is_stable_for_same_path() {
        let path = Path::new("/tmp/example-project");
        let first = compute_repo_id(path).expect("first id");
        let second = compute_repo_id(path).expect("second id");
        assert_eq!(first, second);
    }

    #[test]
    fn repo_id_differs_for_different_paths_with_same_basename() {
        let first = compute_repo_id(Path::new("/tmp/a/project")).expect("first id");
        let second = compute_repo_id(Path::new("/tmp/b/project")).expect("second id");
        assert_ne!(first, second);
    }

    #[test]
    fn beads_database_name_is_stable_for_same_repo() {
        let repo_path = Path::new("/tmp/OpenDucktor Repo");
        let first = compute_beads_database_name(repo_path).expect("first database name");
        let second = compute_beads_database_name(repo_path).expect("second database name");

        assert_eq!(first, second);
        assert_eq!(first, "odt_openducktor_repo_d03d54c7be05");
        assert!(first.len() <= 64);
    }

    #[test]
    fn beads_database_name_differs_for_distinct_repo_paths_with_same_basename() {
        let first =
            compute_beads_database_name(Path::new("/tmp/a/project")).expect("first database name");
        let second =
            compute_beads_database_name(Path::new("/tmp/b/project")).expect("second database name");

        assert_eq!(first, "odt_project_ee5494991388");
        assert_eq!(second, "odt_project_11c79766e587");
        assert_ne!(first, second);
    }

    #[test]
    fn shared_beads_helpers_use_expected_layouts() {
        let _env_lock = lock_env();
        let _override_guard = EnvVarGuard::remove("OPENDUCKTOR_CONFIG_DIR");

        let beads_root = resolve_beads_root().expect("beads root");
        let shared_root = resolve_shared_server_root().expect("shared root");
        let dolt_root = resolve_shared_dolt_root().expect("dolt root");
        let cfg_dir = resolve_dolt_config_dir().expect("cfg dir");
        let config_file = resolve_dolt_config_file().expect("config file");
        let state_file = resolve_server_state_file().expect("state file");
        let lock_file = resolve_server_lock_file().expect("lock file");

        assert!(beads_root
            .to_string_lossy()
            .ends_with("/.openducktor/beads"));
        assert!(shared_root
            .to_string_lossy()
            .ends_with("/.openducktor/beads/shared-server"));
        assert!(dolt_root
            .to_string_lossy()
            .ends_with("/.openducktor/beads/shared-server/dolt"));
        assert!(cfg_dir
            .to_string_lossy()
            .ends_with("/.openducktor/beads/shared-server/.doltcfg"));
        assert!(config_file
            .to_string_lossy()
            .ends_with("/.openducktor/beads/shared-server/dolt-config.yaml"));
        assert!(state_file
            .to_string_lossy()
            .ends_with("/.openducktor/beads/shared-server/server.json"));
        assert!(lock_file
            .to_string_lossy()
            .ends_with("/.openducktor/beads/shared-server/server.lock"));
    }

    #[test]
    fn repo_attachment_helpers_use_expected_layouts() {
        let _env_lock = lock_env();
        let _override_guard = EnvVarGuard::set("OPENDUCKTOR_CONFIG_DIR", "/tmp/odt-config-root");
        let repo_path = Path::new("/tmp/openducktor-test/repo");
        let repo_id = compute_repo_id(repo_path).expect("repo id");

        let attachment_root =
            resolve_repo_beads_attachment_root(repo_path).expect("attachment root should resolve");
        let attachment_dir =
            resolve_repo_beads_attachment_dir(repo_path).expect("attachment dir should resolve");
        let live_db_dir =
            resolve_repo_live_database_dir(repo_path).expect("live db dir should resolve");
        let paths = resolve_repo_beads_paths(repo_path).expect("repo paths should resolve");

        assert_eq!(
            attachment_root,
            PathBuf::from("/tmp/odt-config-root/beads").join(&repo_id)
        );
        assert_eq!(attachment_dir, attachment_root.join(".beads"));
        assert_eq!(
            live_db_dir,
            PathBuf::from("/tmp/odt-config-root/beads/shared-server/dolt")
                .join(&paths.database_name)
        );
        assert_eq!(paths.attachment_dir, attachment_dir);
        assert_eq!(paths.live_database_dir, live_db_dir);
    }

    #[test]
    fn server_state_round_trip_reads_serialized_file() {
        let _env_lock = lock_env();
        let temp_root = std::env::temp_dir().join("odt-shared-dolt-state-test");
        let _override_guard = EnvVarGuard::set(
            "OPENDUCKTOR_CONFIG_DIR",
            temp_root.to_string_lossy().as_ref(),
        );
        let state_path = resolve_server_state_file().expect("state file should resolve");
        fs::create_dir_all(state_path.parent().expect("state parent")).expect("create state dir");
        let payload = SharedDoltServerState {
            pid: 12,
            owner_pid: 34,
            host: "127.0.0.1".to_string(),
            user: "root".to_string(),
            port: 36123,
            shared_server_root: resolve_shared_server_root().expect("shared root"),
            dolt_data_dir: resolve_shared_dolt_root().expect("dolt root"),
            started_at: "2026-04-08T00:00:00Z".to_string(),
        };
        fs::write(
            &state_path,
            serde_json::to_string(&payload).expect("serialize payload"),
        )
        .expect("write state payload");

        let loaded = read_shared_dolt_server_state()
            .expect("state should load")
            .expect("state should exist");
        assert_eq!(loaded, payload);

        let _ = fs::remove_dir_all(temp_root);
    }

    #[test]
    fn deterministic_port_candidate_stays_in_reserved_range() {
        let _env_lock = lock_env();
        let _override_guard = EnvVarGuard::set("OPENDUCKTOR_CONFIG_DIR", "/tmp/odt-config-root");

        let port = deterministic_shared_dolt_port_candidate().expect("port candidate");
        assert!((SHARED_DOLT_PORT_RANGE_START
            ..(SHARED_DOLT_PORT_RANGE_START + SHARED_DOLT_PORT_RANGE_LEN))
            .contains(&port));
        assert_eq!(
            wrap_port_candidate(port, u32::from(SHARED_DOLT_PORT_RANGE_LEN)),
            port
        );
    }

    #[test]
    fn process_liveness_detects_current_process() {
        assert!(is_process_alive(std::process::id()));
    }

    #[test]
    fn current_process_is_not_mistaken_for_shared_dolt_server() {
        let temp_root = temp_config_root("process-identity");
        let matches = process_matches_expected_dolt_server(std::process::id(), &temp_root)
            .expect("process identity check should succeed");
        assert!(!matches);
    }

    #[test]
    fn shared_dolt_config_quotes_paths_with_spaces() {
        let _env_lock = lock_env();
        let config_root = temp_config_root("config with spaces");
        let _override_guard = EnvVarGuard::set(
            "OPENDUCKTOR_CONFIG_DIR",
            config_root.to_string_lossy().as_ref(),
        );

        write_dolt_config_file(39280).expect("config file should be written");
        let config_file = resolve_dolt_config_file().expect("config file path should resolve");
        let contents = fs::read_to_string(config_file).expect("config file should be readable");

        assert!(contents.contains("data_dir: '"));
        assert!(contents.contains("cfg_dir: '"));
        assert!(contents.contains("privilege_file: '"));
        assert!(contents.contains("branch_control_file: '"));

        let _ = fs::remove_dir_all(config_root);
    }

    #[test]
    fn default_worktree_base_dir_uses_expected_layout() {
        let _env_lock = lock_env();
        let _override_guard = EnvVarGuard::remove("OPENDUCKTOR_CONFIG_DIR");
        let resolved = resolve_default_worktree_base_dir(Path::new("/tmp/openducktor-test/repo"))
            .expect("worktree base dir");
        let as_string = resolved.to_string_lossy();
        assert!(as_string.contains(".openducktor/worktrees/"));
        assert!(!as_string.ends_with("/.beads"));
    }

    #[test]
    fn effective_worktree_base_dir_prefers_configured_override() {
        let override_path = "/tmp/custom-worktrees";
        let resolved = resolve_effective_worktree_base_dir(
            Path::new("/tmp/openducktor-test/repo"),
            Some(override_path),
        )
        .expect("effective worktree base dir");
        assert_eq!(resolved, PathBuf::from(override_path));
    }

    #[test]
    fn effective_worktree_base_dir_uses_default_when_override_missing() {
        let _env_lock = lock_env();
        let resolved =
            resolve_effective_worktree_base_dir(Path::new("/tmp/openducktor-test/repo"), None)
                .expect("effective worktree base dir");
        let expected = resolve_default_worktree_base_dir(Path::new("/tmp/openducktor-test/repo"))
            .expect("default worktree base dir");
        assert_eq!(resolved, expected);
    }

    #[test]
    fn effective_worktree_base_dir_expands_home_shorthand_override() {
        let _env_lock = lock_env();
        let home = std::env::temp_dir().join("odt-worktree-home");
        let _home_guard = EnvVarGuard::set("HOME", home.to_string_lossy().as_ref());

        let resolved = resolve_effective_worktree_base_dir(
            Path::new("/tmp/openducktor-test/repo"),
            Some("~/custom-worktrees"),
        )
        .expect("effective worktree base dir");

        assert_eq!(resolved, home.join("custom-worktrees"));
    }

    #[test]
    fn shared_dolt_server_reuses_healthy_state_for_same_root() -> Result<()> {
        if skip_if_dolt_unavailable() {
            return Ok(());
        }

        let _env_lock = lock_env();
        let config_root = temp_config_root("reuse");
        let _override_guard = EnvVarGuard::set(
            "OPENDUCKTOR_CONFIG_DIR",
            config_root.to_string_lossy().as_ref(),
        );

        let first = ensure_shared_dolt_server_running(1001)?;
        let second = ensure_shared_dolt_server_running(1001)?;

        assert_eq!(first.pid, second.pid);
        assert_eq!(first.port, second.port);
        assert!(is_process_alive(first.pid));

        assert!(stop_shared_dolt_server_for_current_owner(1001)?);
        let _ = fs::remove_dir_all(config_root);
        Ok(())
    }

    #[test]
    fn shared_dolt_server_replaces_stale_state_files() -> Result<()> {
        if skip_if_dolt_unavailable() {
            return Ok(());
        }

        let _env_lock = lock_env();
        let config_root = temp_config_root("stale-state");
        let _override_guard = EnvVarGuard::set(
            "OPENDUCKTOR_CONFIG_DIR",
            config_root.to_string_lossy().as_ref(),
        );

        let shared_root = resolve_shared_server_root()?;
        let dolt_root = resolve_shared_dolt_root()?;
        let state_file = resolve_server_state_file()?;
        fs::create_dir_all(&shared_root)?;
        fs::write(
            &state_file,
            serde_json::to_string(&SharedDoltServerState {
                pid: 999_999,
                owner_pid: 2002,
                host: "127.0.0.1".to_string(),
                user: "root".to_string(),
                port: 39999,
                shared_server_root: shared_root.clone(),
                dolt_data_dir: dolt_root,
                started_at: "2026-04-08T00:00:00Z".to_string(),
            })?,
        )?;

        let replacement = ensure_shared_dolt_server_running(2002)?;
        assert_ne!(replacement.pid, 999_999);
        assert_ne!(replacement.port, 39999);
        assert!(is_process_alive(replacement.pid));

        assert!(stop_shared_dolt_server_for_current_owner(2002)?);
        let _ = fs::remove_dir_all(config_root);
        Ok(())
    }

    #[test]
    fn shared_dolt_shutdown_only_stops_matching_owner() -> Result<()> {
        if skip_if_dolt_unavailable() {
            return Ok(());
        }

        let _env_lock = lock_env();
        let config_root = temp_config_root("owner");
        let _override_guard = EnvVarGuard::set(
            "OPENDUCKTOR_CONFIG_DIR",
            config_root.to_string_lossy().as_ref(),
        );

        let state = ensure_shared_dolt_server_running(3003)?;
        assert!(!stop_shared_dolt_server_for_current_owner(4004)?);
        assert!(is_process_alive(state.pid));
        assert!(stop_shared_dolt_server_for_current_owner(3003)?);

        let _ = fs::remove_dir_all(config_root);
        Ok(())
    }

    #[test]
    fn shared_dolt_server_adopts_healthy_state_when_previous_owner_is_gone() -> Result<()> {
        if skip_if_dolt_unavailable() {
            return Ok(());
        }

        let _env_lock = lock_env();
        let config_root = temp_config_root("adopt-owner");
        let _override_guard = EnvVarGuard::set(
            "OPENDUCKTOR_CONFIG_DIR",
            config_root.to_string_lossy().as_ref(),
        );

        let first = ensure_shared_dolt_server_running(6006)?;
        let state_file = resolve_server_state_file()?;
        fs::write(
            &state_file,
            serde_json::to_string(&SharedDoltServerState {
                owner_pid: 999_999,
                ..first.clone()
            })?,
        )?;

        let adopted = ensure_shared_dolt_server_running(7007)?;
        let persisted = read_shared_dolt_server_state()?.expect("expected persisted shared state");

        assert_eq!(adopted.pid, first.pid);
        assert_eq!(adopted.port, first.port);
        assert_eq!(adopted.owner_pid, 7007);
        assert_eq!(persisted.owner_pid, 7007);

        assert!(stop_shared_dolt_server_for_current_owner(7007)?);
        let _ = fs::remove_dir_all(config_root);
        Ok(())
    }

    #[test]
    fn shared_dolt_server_replaces_unhealthy_process_from_dead_owner() -> Result<()> {
        if skip_if_dolt_unavailable() {
            return Ok(());
        }

        let _env_lock = lock_env();
        let config_root = temp_config_root("replace-dead-owner");
        let _override_guard = EnvVarGuard::set(
            "OPENDUCKTOR_CONFIG_DIR",
            config_root.to_string_lossy().as_ref(),
        );

        let first = ensure_shared_dolt_server_running(8008)?;
        let state_file = resolve_server_state_file()?;
        fs::write(
            &state_file,
            serde_json::to_string(&SharedDoltServerState {
                owner_pid: 999_999,
                port: first.port.saturating_add(1),
                ..first.clone()
            })?,
        )?;

        let replacement = ensure_shared_dolt_server_running(9009)?;
        let persisted = read_shared_dolt_server_state()?.expect("expected persisted shared state");

        assert_ne!(replacement.pid, first.pid);
        assert_eq!(replacement.owner_pid, 9009);
        assert_eq!(persisted.pid, replacement.pid);
        assert_eq!(persisted.owner_pid, 9009);
        assert!(stop_shared_dolt_server_for_current_owner(9009)?);

        let _ = fs::remove_dir_all(config_root);
        Ok(())
    }

    #[test]
    fn shared_dolt_server_keeps_roots_and_ports_separate_per_config_dir() -> Result<()> {
        if skip_if_dolt_unavailable() {
            return Ok(());
        }

        let _env_lock = lock_env();
        let root_one = temp_config_root("root-one");
        let root_two = temp_config_root("root-two");

        let first = {
            let _guard = EnvVarGuard::set(
                "OPENDUCKTOR_CONFIG_DIR",
                root_one.to_string_lossy().as_ref(),
            );
            ensure_shared_dolt_server_running(5005)?
        };
        let second = {
            let _guard = EnvVarGuard::set(
                "OPENDUCKTOR_CONFIG_DIR",
                root_two.to_string_lossy().as_ref(),
            );
            ensure_shared_dolt_server_running(5005)?
        };

        assert_ne!(first.shared_server_root, second.shared_server_root);
        assert_ne!(first.dolt_data_dir, second.dolt_data_dir);
        assert_ne!(first.port, second.port);

        {
            let _guard = EnvVarGuard::set(
                "OPENDUCKTOR_CONFIG_DIR",
                root_one.to_string_lossy().as_ref(),
            );
            assert!(stop_shared_dolt_server_for_current_owner(5005)?);
        }
        {
            let _guard = EnvVarGuard::set(
                "OPENDUCKTOR_CONFIG_DIR",
                root_two.to_string_lossy().as_ref(),
            );
            assert!(stop_shared_dolt_server_for_current_owner(5005)?);
        }

        let _ = fs::remove_dir_all(root_one);
        let _ = fs::remove_dir_all(root_two);
        Ok(())
    }
}
