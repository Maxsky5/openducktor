use super::*;

#[derive(Clone)]
pub(super) struct TaskListCacheEntry {
    pub(super) tasks: Vec<TaskCard>,
    pub(super) cached_at: Instant,
    pub(super) metadata_namespace: String,
}

#[derive(Default)]
pub(super) struct TaskListCacheState {
    pub(super) generation: u64,
    pub(super) entry: Option<TaskListCacheEntry>,
}

#[derive(Clone)]
pub(super) struct KanbanTaskListCacheEntry {
    pub(super) tasks: Vec<TaskCard>,
    pub(super) metadata_by_task_id: HashMap<String, TaskMetadata>,
    pub(super) cached_at: Instant,
    pub(super) metadata_namespace: String,
    pub(super) done_visible_days: i32,
}

#[derive(Default)]
pub(super) struct KanbanTaskListCacheState {
    pub(super) generation: u64,
    pub(super) entry: Option<KanbanTaskListCacheEntry>,
}

impl BeadsTaskStore {
    fn task_list_cache_ttl() -> Duration {
        Duration::from_millis(TASK_LIST_CACHE_TTL_MS)
    }

    pub(super) fn cached_task_list_and_generation(
        &self,
        repo_key: &str,
        metadata_namespace: &str,
    ) -> Result<(Option<Vec<TaskCard>>, u64)> {
        let mut cache = self
            .task_list_cache
            .lock()
            .map_err(|_| anyhow!("Beads task-list cache lock poisoned"))?;
        let state = cache.entry(repo_key.to_string()).or_default();
        let generation = state.generation;

        if let Some(entry) = state.entry.as_ref() {
            let is_fresh = entry.cached_at.elapsed() <= Self::task_list_cache_ttl();
            let namespace_matches = entry.metadata_namespace == metadata_namespace;
            if is_fresh && namespace_matches {
                return Ok((Some(entry.tasks.clone()), generation));
            }
        }

        state.entry = None;
        Ok((None, generation))
    }

    pub(super) fn cache_task_list_if_generation(
        &self,
        repo_key: &str,
        metadata_namespace: &str,
        generation: u64,
        tasks: &[TaskCard],
    ) -> Result<()> {
        let mut cache = self
            .task_list_cache
            .lock()
            .map_err(|_| anyhow!("Beads task-list cache lock poisoned"))?;
        let state = cache.entry(repo_key.to_string()).or_default();
        if state.generation != generation {
            return Ok(());
        }

        state.entry = Some(TaskListCacheEntry {
            tasks: tasks.to_vec(),
            cached_at: Instant::now(),
            metadata_namespace: metadata_namespace.to_string(),
        });
        Ok(())
    }

    pub(super) fn cached_kanban_task_list_and_generation(
        &self,
        repo_key: &str,
        metadata_namespace: &str,
        done_visible_days: i32,
    ) -> Result<(Option<Vec<TaskCard>>, u64)> {
        let mut cache = self
            .kanban_task_list_cache
            .lock()
            .map_err(|_| anyhow!("Beads kanban task-list cache lock poisoned"))?;
        let state = cache.entry(repo_key.to_string()).or_default();
        let generation = state.generation;

        if let Some(entry) = state.entry.as_ref() {
            let is_fresh = entry.cached_at.elapsed() <= Self::task_list_cache_ttl();
            let namespace_matches = entry.metadata_namespace == metadata_namespace;
            let days_match = entry.done_visible_days == done_visible_days;
            if is_fresh && namespace_matches && days_match {
                return Ok((Some(entry.tasks.clone()), generation));
            }
        }

        state.entry = None;
        Ok((None, generation))
    }

    pub(super) fn cache_kanban_task_list_if_generation(
        &self,
        repo_key: &str,
        metadata_namespace: &str,
        done_visible_days: i32,
        generation: u64,
        tasks: &[TaskCard],
        metadata_by_task_id: &HashMap<String, TaskMetadata>,
    ) -> Result<()> {
        let mut cache = self
            .kanban_task_list_cache
            .lock()
            .map_err(|_| anyhow!("Beads kanban task-list cache lock poisoned"))?;
        let state = cache.entry(repo_key.to_string()).or_default();
        if state.generation != generation {
            return Ok(());
        }

        state.entry = Some(KanbanTaskListCacheEntry {
            tasks: tasks.to_vec(),
            metadata_by_task_id: metadata_by_task_id.clone(),
            cached_at: Instant::now(),
            metadata_namespace: metadata_namespace.to_string(),
            done_visible_days,
        });
        Ok(())
    }

    pub(super) fn cached_task_metadata(
        &self,
        repo_key: &str,
        metadata_namespace: &str,
        task_id: &str,
    ) -> Result<Option<TaskMetadata>> {
        {
            let mut cache = self
                .task_list_cache
                .lock()
                .map_err(|_| anyhow!("Beads task-list cache lock poisoned"))?;
            let state = cache.entry(repo_key.to_string()).or_default();

            if let Some(entry) = state.entry.as_ref() {
                let is_fresh = entry.cached_at.elapsed() <= Self::task_list_cache_ttl();
                let namespace_matches = entry.metadata_namespace == metadata_namespace;
                if is_fresh && namespace_matches {
                    if let Some(metadata) = entry.metadata_by_task_id.get(task_id) {
                        return Ok(Some(metadata.clone()));
                    }
                } else {
                    state.entry = None;
                }
            }
        }

        let mut kanban_cache = self
            .kanban_task_list_cache
            .lock()
            .map_err(|_| anyhow!("Beads kanban task-list cache lock poisoned"))?;
        let state = kanban_cache.entry(repo_key.to_string()).or_default();
        let Some(entry) = state.entry.as_ref() else {
            return Ok(None);
        };
        let is_fresh = entry.cached_at.elapsed() <= Self::task_list_cache_ttl();
        let namespace_matches = entry.metadata_namespace == metadata_namespace;
        if !is_fresh || !namespace_matches {
            state.entry = None;
            return Ok(None);
        }

        Ok(entry.metadata_by_task_id.get(task_id).cloned())
    }
    pub(crate) fn invalidate_task_list_cache(&self, repo_path: &Path) -> Result<()> {
        let repo_key = Self::repo_key(repo_path);
        {
            let mut cache = self
                .task_list_cache
                .lock()
                .map_err(|_| anyhow!("Beads task-list cache lock poisoned"))?;
            let state = cache.entry(repo_key.clone()).or_default();
            state.generation = state.generation.saturating_add(1);
            state.entry = None;
        }
        let mut kanban_cache = self
            .kanban_task_list_cache
            .lock()
            .map_err(|_| anyhow!("Beads kanban task-list cache lock poisoned"))?;
        let state = kanban_cache.entry(repo_key).or_default();
        state.generation = state.generation.saturating_add(1);
        state.entry = None;
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn task_list_cache_generation_for_repo(&self, repo_path: &Path) -> Result<u64> {
        let repo_key = Self::repo_key(repo_path);
        let mut cache = self
            .task_list_cache
            .lock()
            .map_err(|_| anyhow!("Beads task-list cache lock poisoned"))?;
        let state = cache.entry(repo_key).or_default();
        Ok(state.generation)
    }

    #[cfg(test)]
    pub(crate) fn cache_task_list_for_repo_if_generation(
        &self,
        repo_path: &Path,
        metadata_namespace: &str,
        generation: u64,
        tasks: &[TaskCard],
    ) -> Result<()> {
        let repo_key = Self::repo_key(repo_path);
        self.cache_task_list_if_generation(&repo_key, metadata_namespace, generation, tasks)?;
        Ok(())
    }
}
