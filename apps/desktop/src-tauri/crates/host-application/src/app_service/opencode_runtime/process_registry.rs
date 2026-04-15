use crate::app_service::{
    opencode_server_parent_pid, process_exists, terminate_process_by_pid,
    wait_for_process_exit_by_pid, RuntimeProcessGuard,
};
use anyhow::{anyhow, Context, Result};
use fs2::FileExt;
use host_infra_system::AppConfigStore;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

pub(crate) const OPENCODE_PROCESS_REGISTRY_RELATIVE_PATH: &str = "runtime/opencode-processes.json";

#[derive(Clone, Default)]
pub(crate) struct OpenCodeProcessTracker {
    tracked_processes: Arc<Mutex<HashMap<u32, usize>>>,
    termination_gate: Arc<Mutex<()>>,
    terminating: Arc<AtomicBool>,
}

impl OpenCodeProcessTracker {
    pub(crate) fn track_process(
        &self,
        registry_path: &Path,
        instance_pid: u32,
        pid: u32,
    ) -> Result<RuntimeProcessGuard> {
        let _termination_gate = self
            .termination_gate
            .lock()
            .map_err(|_| anyhow!("OpenCode process tracker shutdown gate lock poisoned"))?;
        if self.terminating.load(Ordering::Acquire) {
            return Err(anyhow!("OpenCode process tracker is shutting down"));
        }
        track_pending_opencode_process(&self.tracked_processes, registry_path, instance_pid, pid)
    }

    pub(crate) fn terminate_tracked_processes(
        &self,
        registry_path: &Path,
        instance_pid: u32,
    ) -> Result<()> {
        {
            let _termination_gate = self
                .termination_gate
                .lock()
                .map_err(|_| anyhow!("OpenCode process tracker shutdown gate lock poisoned"))?;
            self.terminating.store(true, Ordering::Release);
        }
        terminate_pending_opencode_processes(&self.tracked_processes, registry_path, instance_pid)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct OpencodeProcessRegistryInstance {
    pub(crate) parent_pid: u32,
    #[serde(default)]
    pub(crate) child_pids: Vec<u32>,
}

impl OpencodeProcessRegistryInstance {
    pub(crate) fn with_child(parent_pid: u32, child_pid: u32) -> Self {
        Self {
            parent_pid,
            child_pids: vec![child_pid],
        }
    }

    pub(crate) fn with_children(parent_pid: u32, child_pids: Vec<u32>) -> Self {
        Self {
            parent_pid,
            child_pids,
        }
    }
}

pub(crate) struct TrackedOpencodeProcessGuard {
    pub(crate) tracked_opencode_processes: Arc<Mutex<HashMap<u32, usize>>>,
    pub(crate) opencode_process_registry_path: PathBuf,
    pub(crate) parent_pid: u32,
    pub(crate) child_pid: u32,
}

impl Drop for TrackedOpencodeProcessGuard {
    fn drop(&mut self) {
        let mut should_remove_from_registry = false;
        if let Ok(mut tracked_processes) = self.tracked_opencode_processes.lock() {
            if let Some(count) = tracked_processes.get_mut(&self.child_pid) {
                if *count > 1 {
                    *count -= 1;
                } else {
                    tracked_processes.remove(&self.child_pid);
                    should_remove_from_registry = true;
                }
            }
        }
        if !should_remove_from_registry {
            return;
        }

        let _ = with_locked_opencode_process_registry(
            self.opencode_process_registry_path.as_path(),
            |instances| {
                for instance in instances.iter_mut() {
                    if instance.parent_pid == self.parent_pid {
                        instance.child_pids.retain(|pid| *pid != self.child_pid);
                    }
                }
                Ok(())
            },
        );
    }
}

#[cfg(test)]
impl TrackedOpencodeProcessGuard {
    pub(crate) fn new_for_test(
        tracked_processes: Arc<Mutex<HashMap<u32, usize>>>,
        opencode_process_registry_path: PathBuf,
        parent_pid: u32,
        child_pid: u32,
    ) -> Self {
        Self {
            tracked_opencode_processes: tracked_processes,
            opencode_process_registry_path,
            parent_pid,
            child_pid,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct OpencodeProcessRegistryFile {
    #[serde(default)]
    instances: Vec<OpencodeProcessRegistryInstance>,
}

fn normalize_opencode_process_registry_instances(
    instances: &mut Vec<OpencodeProcessRegistryInstance>,
) {
    for instance in instances.iter_mut() {
        instance.child_pids.sort_unstable();
        instance.child_pids.dedup();
    }

    instances.sort_by_key(|instance| instance.parent_pid);
    let mut merged: Vec<OpencodeProcessRegistryInstance> = Vec::with_capacity(instances.len());
    for instance in instances.drain(..) {
        if let Some(previous) = merged
            .last_mut()
            .filter(|entry| entry.parent_pid == instance.parent_pid)
        {
            previous.child_pids.extend(instance.child_pids);
        } else {
            merged.push(instance);
        }
    }

    for instance in merged.iter_mut() {
        instance.child_pids.sort_unstable();
        instance.child_pids.dedup();
    }
    merged.retain(|instance| !instance.child_pids.is_empty());
    *instances = merged;
}

pub(crate) fn with_locked_opencode_process_registry<T>(
    path: &Path,
    mutator: impl FnOnce(&mut Vec<OpencodeProcessRegistryInstance>) -> Result<T>,
) -> Result<T> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).with_context(|| {
            format!(
                "Failed creating OpenCode process registry directory {}",
                parent.display()
            )
        })?;
    }

    let mut file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(path)
        .with_context(|| {
            format!(
                "Failed opening OpenCode process registry {}",
                path.display()
            )
        })?;
    file.lock_exclusive().with_context(|| {
        format!(
            "Failed acquiring lock for OpenCode process registry {}",
            path.display()
        )
    })?;

    let mut data = String::new();
    file.read_to_string(&mut data).with_context(|| {
        format!(
            "Failed reading OpenCode process registry {}",
            path.display()
        )
    })?;

    let mut parsed = if data.trim().is_empty() {
        OpencodeProcessRegistryFile::default()
    } else {
        serde_json::from_str::<OpencodeProcessRegistryFile>(&data).with_context(|| {
            format!(
                "Failed parsing OpenCode process registry payload {}",
                path.display()
            )
        })?
    };
    normalize_opencode_process_registry_instances(&mut parsed.instances);

    let output = mutator(&mut parsed.instances)?;
    normalize_opencode_process_registry_instances(&mut parsed.instances);

    let payload = serde_json::to_string_pretty(&parsed)
        .context("Failed serializing OpenCode process registry payload")?;
    file.set_len(0).with_context(|| {
        format!(
            "Failed truncating OpenCode process registry {}",
            path.display()
        )
    })?;
    file.seek(SeekFrom::Start(0)).with_context(|| {
        format!(
            "Failed seeking OpenCode process registry {}",
            path.display()
        )
    })?;
    file.write_all(payload.as_bytes()).with_context(|| {
        format!(
            "Failed writing OpenCode process registry {}",
            path.display()
        )
    })?;
    file.flush().with_context(|| {
        format!(
            "Failed flushing OpenCode process registry {}",
            path.display()
        )
    })?;

    Ok(output)
}

#[cfg(test)]
pub(crate) fn read_opencode_process_registry(
    path: &Path,
) -> Result<Vec<OpencodeProcessRegistryInstance>> {
    with_locked_opencode_process_registry(path, |instances| Ok(instances.clone()))
}

pub(crate) fn opencode_process_registry_path(config_store: &AppConfigStore) -> PathBuf {
    let base = config_store
        .path()
        .parent()
        .map(|entry| entry.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));
    base.join(OPENCODE_PROCESS_REGISTRY_RELATIVE_PATH)
}

pub(crate) fn reconcile_opencode_process_registry_on_startup(
    registry_path: &Path,
    instance_pid: u32,
) -> Result<()> {
    with_locked_opencode_process_registry(registry_path, |instances| {
        let mut retained_instances = Vec::new();
        for instance in instances.iter() {
            let parent_pid = instance.parent_pid;
            let mut retained_child_pids = Vec::new();
            let parent_is_alive = process_exists(parent_pid);
            for child_pid in instance.child_pids.iter().copied() {
                let Some(child_parent_pid) = opencode_server_parent_pid(child_pid) else {
                    continue;
                };

                // Never trust records that claim ownership by the current PID; they can only
                // come from a stale file after PID reuse.
                if parent_pid == instance_pid {
                    if child_parent_pid == 1 {
                        terminate_process_by_pid(child_pid);
                    }
                    continue;
                }

                if child_parent_pid == 1 {
                    terminate_process_by_pid(child_pid);
                    continue;
                }

                if child_parent_pid != parent_pid {
                    continue;
                }

                if parent_is_alive {
                    retained_child_pids.push(child_pid);
                    continue;
                }

                terminate_process_by_pid(child_pid);
            }

            if !retained_child_pids.is_empty() {
                retained_instances.push(OpencodeProcessRegistryInstance::with_children(
                    parent_pid,
                    retained_child_pids,
                ));
            }
        }

        *instances = retained_instances;
        Ok(())
    })
}

pub(crate) fn track_pending_opencode_process(
    tracked_processes: &Arc<Mutex<HashMap<u32, usize>>>,
    registry_path: &Path,
    instance_pid: u32,
    pid: u32,
) -> Result<RuntimeProcessGuard> {
    let mut tracked = tracked_processes
        .lock()
        .map_err(|_| anyhow!("Tracked OpenCode process state lock poisoned"))?;
    *tracked.entry(pid).or_insert(0) += 1;
    if let Err(error) = with_locked_opencode_process_registry(registry_path, |instances| {
        if let Some(instance) = instances
            .iter_mut()
            .find(|entry| entry.parent_pid == instance_pid)
        {
            instance.child_pids.push(pid);
        } else {
            instances.push(OpencodeProcessRegistryInstance::with_child(
                instance_pid,
                pid,
            ));
        }
        Ok(())
    }) {
        if let Some(count) = tracked.get_mut(&pid) {
            if *count > 1 {
                *count -= 1;
            } else {
                tracked.remove(&pid);
            }
        }
        return Err(error);
    }

    Ok(RuntimeProcessGuard::new(TrackedOpencodeProcessGuard {
        tracked_opencode_processes: Arc::clone(tracked_processes),
        opencode_process_registry_path: registry_path.to_path_buf(),
        parent_pid: instance_pid,
        child_pid: pid,
    }))
}

pub(crate) fn terminate_pending_opencode_processes(
    tracked_processes: &Arc<Mutex<HashMap<u32, usize>>>,
    registry_path: &Path,
    instance_pid: u32,
) -> Result<()> {
    let tracked_snapshot = tracked_processes
        .lock()
        .map_err(|_| anyhow!("Tracked OpenCode process state lock poisoned"))?
        .iter()
        .map(|(pid, count)| (*pid, *count))
        .collect::<Vec<_>>();

    let mut surviving_processes = HashMap::new();
    for (pid, count) in tracked_snapshot {
        let Some(parent_pid) = opencode_server_parent_pid(pid) else {
            continue;
        };
        if parent_pid != instance_pid {
            continue;
        }
        terminate_process_by_pid(pid);
        if !wait_for_process_exit_by_pid(pid, std::time::Duration::from_secs(2))
            && opencode_server_parent_pid(pid) == Some(instance_pid)
        {
            surviving_processes.insert(pid, count);
        }
    }

    {
        let mut tracked = tracked_processes
            .lock()
            .map_err(|_| anyhow!("Tracked OpenCode process state lock poisoned"))?;
        *tracked = surviving_processes.clone();
    }

    let surviving_pids_vec = surviving_processes.keys().copied().collect::<Vec<_>>();
    with_locked_opencode_process_registry(registry_path, |instances| {
        instances.retain(|instance| instance.parent_pid != instance_pid);
        if !surviving_pids_vec.is_empty() {
            instances.push(OpencodeProcessRegistryInstance::with_children(
                instance_pid,
                surviving_pids_vec.clone(),
            ));
        }
        Ok(())
    })?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app_service::test_support::{lock_env, set_env_var, unique_temp_path};
    use host_test_support::EnvVarGuard;

    #[test]
    fn opencode_process_registry_path_uses_expanded_config_dir_override() {
        let _env_lock = lock_env();
        let home = unique_temp_path("process-registry-home");
        let _home_guard = set_env_var("HOME", home.to_string_lossy().as_ref());
        let _config_dir_guard = EnvVarGuard::set("OPENDUCKTOR_CONFIG_DIR", "~/.openducktor-local");

        let config_store = AppConfigStore::new().expect("config store should resolve");
        let registry_path = opencode_process_registry_path(&config_store);

        let base_dir = home.join(".openducktor-local");
        let expected = base_dir.join(PathBuf::from(OPENCODE_PROCESS_REGISTRY_RELATIVE_PATH));
        assert_eq!(config_store.path(), base_dir.join("config.json"));
        assert_eq!(registry_path, expected);
    }

    #[test]
    fn opencode_process_registry_path_uses_expanded_quoted_config_dir_override() {
        let _env_lock = lock_env();
        let home = unique_temp_path("process-registry-quoted-home");
        let _home_guard = set_env_var("HOME", home.to_string_lossy().as_ref());
        let _config_dir_guard =
            EnvVarGuard::set("OPENDUCKTOR_CONFIG_DIR", "\"~/.openducktor-local\"");

        let config_store = AppConfigStore::new().expect("config store should resolve");
        let registry_path = opencode_process_registry_path(&config_store);

        let expected = home
            .join(".openducktor-local")
            .join(PathBuf::from(OPENCODE_PROCESS_REGISTRY_RELATIVE_PATH));
        assert_eq!(registry_path, expected);
    }

    #[test]
    fn open_code_process_tracker_rejects_new_tracks_after_termination_begins() -> Result<()> {
        let tracker = OpenCodeProcessTracker::default();
        let root = unique_temp_path("process-tracker-shutdown-gate");
        let registry_path = root.join(OPENCODE_PROCESS_REGISTRY_RELATIVE_PATH);

        tracker.terminate_tracked_processes(registry_path.as_path(), 42)?;

        let error = tracker
            .track_process(registry_path.as_path(), 42, 99)
            .err()
            .expect("tracker should reject new processes after shutdown begins");
        assert!(error.to_string().contains("shutting down"));

        let _ = fs::remove_dir_all(root);
        Ok(())
    }
}
