use super::*;

pub(crate) const OPENCODE_PROCESS_REGISTRY_RELATIVE_PATH: &str = "runtime/opencode-processes.json";

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

impl AppService {
    pub(super) fn opencode_process_registry_path(config_store: &AppConfigStore) -> PathBuf {
        let base = config_store
            .path()
            .parent()
            .map(|entry| entry.to_path_buf())
            .unwrap_or_else(|| PathBuf::from("."));
        base.join(OPENCODE_PROCESS_REGISTRY_RELATIVE_PATH)
    }

    pub(super) fn reconcile_opencode_process_registry_on_startup(&self) -> Result<()> {
        with_locked_opencode_process_registry(
            self.opencode_process_registry_path.as_path(),
            |instances| {
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
                        if parent_pid == self.instance_pid {
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
            },
        )
    }

    pub(crate) fn track_pending_opencode_process(
        &self,
        pid: u32,
    ) -> Result<TrackedOpencodeProcessGuard> {
        let mut tracked = self
            .tracked_opencode_processes
            .lock()
            .map_err(|_| anyhow!("Tracked OpenCode process state lock poisoned"))?;
        *tracked.entry(pid).or_insert(0) += 1;
        if let Err(error) = with_locked_opencode_process_registry(
            self.opencode_process_registry_path.as_path(),
            |instances| {
                if let Some(instance) = instances
                    .iter_mut()
                    .find(|entry| entry.parent_pid == self.instance_pid)
                {
                    instance.child_pids.push(pid);
                } else {
                    instances.push(OpencodeProcessRegistryInstance::with_child(
                        self.instance_pid,
                        pid,
                    ));
                }
                Ok(())
            },
        ) {
            if let Some(count) = tracked.get_mut(&pid) {
                if *count > 1 {
                    *count -= 1;
                } else {
                    tracked.remove(&pid);
                }
            }
            return Err(error);
        }

        Ok(TrackedOpencodeProcessGuard {
            tracked_opencode_processes: self.tracked_opencode_processes.clone(),
            opencode_process_registry_path: self.opencode_process_registry_path.clone(),
            parent_pid: self.instance_pid,
            child_pid: pid,
        })
    }

    pub(crate) fn terminate_pending_opencode_processes(&self) -> Result<()> {
        let tracked_processes = self
            .tracked_opencode_processes
            .lock()
            .map_err(|_| anyhow!("Tracked OpenCode process state lock poisoned"))?
            .iter()
            .map(|(pid, count)| (*pid, *count))
            .collect::<Vec<_>>();

        let mut surviving_processes = HashMap::new();
        for (pid, count) in tracked_processes {
            let Some(parent_pid) = opencode_server_parent_pid(pid) else {
                continue;
            };
            if parent_pid != self.instance_pid {
                continue;
            }
            terminate_process_by_pid(pid);
            if opencode_server_parent_pid(pid) == Some(self.instance_pid) {
                surviving_processes.insert(pid, count);
            }
        }

        {
            let mut tracked = self
                .tracked_opencode_processes
                .lock()
                .map_err(|_| anyhow!("Tracked OpenCode process state lock poisoned"))?;
            *tracked = surviving_processes.clone();
        }

        let surviving_pids_vec = surviving_processes.keys().copied().collect::<Vec<_>>();
        with_locked_opencode_process_registry(
            self.opencode_process_registry_path.as_path(),
            |instances| {
                instances.retain(|instance| instance.parent_pid != self.instance_pid);
                if !surviving_pids_vec.is_empty() {
                    instances.push(OpencodeProcessRegistryInstance::with_children(
                        self.instance_pid,
                        surviving_pids_vec.clone(),
                    ));
                }
                Ok(())
            },
        )?;

        Ok(())
    }
}
