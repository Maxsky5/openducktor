use anyhow::{anyhow, Context, Result};
use chrono::Utc;
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
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
use url::Url;

use crate::{resolve_command_path, subprocess_path_env};

use super::repo_paths::{
    canonical_or_absolute, resolve_dolt_config_dir, resolve_dolt_config_file,
    resolve_server_lock_file, resolve_server_state_file, resolve_shared_dolt_root,
    resolve_shared_server_root,
};

pub const SHARED_DOLT_SERVER_HOST: &str = "127.0.0.1";
pub const SHARED_DOLT_SERVER_USER: &str = "root";

pub(crate) const SHARED_DOLT_PORT_RANGE_START: u16 = 36_000;
pub(crate) const SHARED_DOLT_PORT_RANGE_LEN: u16 = 10_000;
const SHARED_DOLT_HEALTH_TIMEOUT: Duration = Duration::from_secs(5);
const SHARED_DOLT_HEALTH_POLL_INTERVAL: Duration = Duration::from_millis(100);
const SHARED_DOLT_TCP_TIMEOUT: Duration = Duration::from_millis(250);

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

        let owner_alive = is_process_alive(existing.owner_pid);
        let server_alive = is_process_alive(existing.pid);
        let server_matches =
            process_matches_expected_dolt_server(existing.pid, &shared_server_root)?;

        if server_alive && server_matches {
            if existing.owner_pid == owner_pid || !owner_alive {
                terminate_process_by_pid(existing.pid, &shared_server_root).with_context(|| {
                    format!(
                        "Failed terminating stale shared Dolt server pid {} for {}",
                        existing.pid,
                        shared_server_root.display()
                    )
                })?;
            } else {
                return Err(anyhow!(
                    "Shared Dolt server for {} is unhealthy but still owned by live pid {}",
                    shared_server_root.display(),
                    existing.owner_pid
                ));
            }
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

        let backup_url = Url::from_file_path(backup_dir).map_err(|()| {
            anyhow!(
                "Failed converting backup path {} into file URL",
                backup_dir.display()
            )
        })?;
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
    let parent = path.parent().ok_or_else(|| {
        anyhow!(
            "Shared Dolt server state path has no parent: {}",
            path.display()
        )
    })?;
    fs::create_dir_all(parent)
        .with_context(|| format!("Failed creating shared state parent {}", parent.display()))?;
    let temp_file = parent.join(format!(
        ".server.json.tmp-{}-{}",
        std::process::id(),
        Utc::now().timestamp_nanos_opt().unwrap_or_default()
    ));
    fs::write(&temp_file, payload)
        .with_context(|| format!("Failed writing temp shared state {}", temp_file.display()))?;
    replace_file(&temp_file, path).with_context(|| {
        format!(
            "Failed replacing shared Dolt server state {} with {}",
            path.display(),
            temp_file.display()
        )
    })
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

pub(crate) fn deterministic_shared_dolt_port_candidate() -> Result<u16> {
    let base_dir = canonical_or_absolute(&crate::config::resolve_openducktor_base_dir()?)?;
    let digest = Sha256::digest(base_dir.to_string_lossy().as_bytes());
    let offset = u16::from_be_bytes([digest[0], digest[1]]) % SHARED_DOLT_PORT_RANGE_LEN;
    Ok(SHARED_DOLT_PORT_RANGE_START + offset)
}

pub(crate) fn wrap_port_candidate(base: u16, offset: u32) -> u16 {
    let normalized_base = base - SHARED_DOLT_PORT_RANGE_START;
    SHARED_DOLT_PORT_RANGE_START
        + (((u32::from(normalized_base) + offset) % u32::from(SHARED_DOLT_PORT_RANGE_LEN)) as u16)
}

fn is_port_available(port: u16) -> bool {
    TcpListener::bind((SHARED_DOLT_SERVER_HOST, port)).is_ok()
}

pub(crate) fn write_dolt_config_file(port: u16) -> Result<()> {
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
    replace_file(&temp_file, &config_file).with_context(|| {
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
        .write(true)
        .truncate(true)
        .open(&stdout_log)
        .with_context(|| format!("Failed opening {}", stdout_log.display()))?;
    let stderr = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
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

    let ready = wait_for_server_ready(port);
    if matches!(&ready, Ok(true)) {
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

    cleanup_spawned_child(&mut child)?;
    ready?;

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

fn replace_file(temp_file: &Path, destination: &Path) -> Result<()> {
    #[cfg(windows)]
    {
        remove_if_exists(destination)?;
        fs::rename(temp_file, destination)?;
        Ok(())
    }

    #[cfg(not(windows))]
    {
        fs::rename(temp_file, destination)?;
        Ok(())
    }
}

fn cleanup_spawned_child(child: &mut std::process::Child) -> Result<()> {
    let status = child
        .try_wait()
        .context("Failed checking shared Dolt server process state")?;
    if status.is_none() {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
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
        let terminated_after_term = wait_for_process_exit(pid, Duration::from_secs(3));
        if is_process_alive(pid) {
            let kill_status = unsafe { libc::kill(raw_pid, libc::SIGKILL) };
            if kill_status != 0 {
                return Err(std::io::Error::last_os_error())
                    .with_context(|| format!("Failed sending SIGKILL to Dolt pid {pid}"));
            }
            if !wait_for_process_exit(pid, Duration::from_secs(2)) {
                return Err(anyhow!(
                    "Dolt pid {} is still alive after SIGKILL timeout",
                    pid
                ));
            }
        } else if !terminated_after_term {
            return Err(anyhow!(
                "Dolt pid {} is still alive after SIGTERM timeout",
                pid
            ));
        }
        Ok(())
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
        if !wait_for_process_exit(pid, Duration::from_secs(3)) {
            return Err(anyhow!(
                "Dolt pid {} is still alive after termination timeout",
                pid
            ));
        }
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

pub(crate) fn is_process_alive(pid: u32) -> bool {
    let mut system = System::new_all();
    system.refresh_processes(ProcessesToUpdate::All, true);
    system.process(Pid::from_u32(pid)).is_some()
}

pub(crate) fn process_matches_expected_dolt_server(
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
