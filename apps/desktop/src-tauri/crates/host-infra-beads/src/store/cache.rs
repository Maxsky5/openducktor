use super::*;
use host_domain::{is_syncable_pull_request_state, is_terminal_task_status};

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
    pub(super) cached_at: Instant,
    pub(super) metadata_namespace: String,
    pub(super) done_visible_days: i32,
}

#[derive(Default)]
pub(super) struct KanbanTaskListCacheState {
    pub(super) generation: u64,
    pub(super) entry: Option<KanbanTaskListCacheEntry>,
}

#[derive(Clone)]
pub(super) struct PullRequestSyncCandidateCacheEntry {
    pub(super) tasks: Vec<TaskCard>,
    pub(super) cached_at: Instant,
    pub(super) metadata_namespace: String,
}

#[derive(Default)]
pub(super) struct PullRequestSyncCandidateCacheState {
    pub(super) generation: u64,
    pub(super) entry: Option<PullRequestSyncCandidateCacheEntry>,
}

impl BeadsTaskStore {
    fn task_list_cache_ttl() -> Duration {
        Duration::from_millis(TASK_LIST_CACHE_TTL_MS)
    }

    fn pull_request_sync_candidate_cache_ttl() -> Duration {
        Duration::from_millis(PULL_REQUEST_SYNC_CANDIDATE_CACHE_TTL_MS)
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
            cached_at: Instant::now(),
            metadata_namespace: metadata_namespace.to_string(),
            done_visible_days,
        });
        Ok(())
    }

    pub(super) fn cached_pull_request_sync_candidates_and_generation(
        &self,
        repo_key: &str,
        metadata_namespace: &str,
    ) -> Result<(Option<Vec<TaskCard>>, u64)> {
        let mut cache = self
            .pull_request_sync_candidate_cache
            .lock()
            .map_err(|_| anyhow!("Beads PR-sync candidate cache lock poisoned"))?;
        let state = cache.entry(repo_key.to_string()).or_default();
        let generation = state.generation;

        if let Some(entry) = state.entry.as_ref() {
            let is_fresh =
                entry.cached_at.elapsed() <= Self::pull_request_sync_candidate_cache_ttl();
            let namespace_matches = entry.metadata_namespace == metadata_namespace;
            if is_fresh && namespace_matches {
                return Ok((Some(entry.tasks.clone()), generation));
            }
        }

        state.entry = None;
        Ok((None, generation))
    }

    pub(super) fn cache_pull_request_sync_candidates_if_generation(
        &self,
        repo_key: &str,
        metadata_namespace: &str,
        generation: u64,
        tasks: &[TaskCard],
    ) -> Result<()> {
        let mut cache = self
            .pull_request_sync_candidate_cache
            .lock()
            .map_err(|_| anyhow!("Beads PR-sync candidate cache lock poisoned"))?;
        let state = cache.entry(repo_key.to_string()).or_default();
        if state.generation != generation {
            return Ok(());
        }

        state.entry = Some(PullRequestSyncCandidateCacheEntry {
            tasks: tasks.to_vec(),
            cached_at: Instant::now(),
            metadata_namespace: metadata_namespace.to_string(),
        });
        Ok(())
    }

    fn update_pull_request_sync_candidate_entry(tasks: &mut Vec<TaskCard>, task: TaskCard) {
        tasks.retain(|entry| entry.id != task.id);
        if Self::is_pull_request_sync_candidate(&task) {
            tasks.push(task);
            tasks.sort_by(|left, right| left.id.cmp(&right.id));
        }
    }

    pub(super) fn is_pull_request_sync_candidate(task: &TaskCard) -> bool {
        !is_terminal_task_status(&task.status)
            && task.pull_request.as_ref().is_some_and(|pull_request| {
                is_syncable_pull_request_state(pull_request.state.as_str())
            })
    }

    pub(super) fn refresh_cached_pull_request_sync_candidate(
        &self,
        repo_path: &Path,
        task: TaskCard,
    ) -> Result<()> {
        let metadata_namespace = self.current_metadata_namespace();
        let repo_key = Self::repo_key(repo_path);
        let mut cache = self
            .pull_request_sync_candidate_cache
            .lock()
            .map_err(|_| anyhow!("Beads PR-sync candidate cache lock poisoned"))?;
        let state = cache.entry(repo_key).or_default();
        state.generation = state.generation.saturating_add(1);
        let Some(entry) = state.entry.as_mut() else {
            return Ok(());
        };
        if entry.metadata_namespace != metadata_namespace {
            state.entry = None;
            return Ok(());
        }

        Self::update_pull_request_sync_candidate_entry(&mut entry.tasks, task);
        entry.cached_at = Instant::now();
        Ok(())
    }

    pub(super) fn refresh_cached_pull_request_sync_candidate_from_store(
        &self,
        repo_path: &Path,
        task_id: &str,
    ) -> Result<()> {
        let metadata_namespace = self.current_metadata_namespace();
        let repo_key = Self::repo_key(repo_path);
        let has_cached_entry = {
            let mut cache = self
                .pull_request_sync_candidate_cache
                .lock()
                .map_err(|_| anyhow!("Beads PR-sync candidate cache lock poisoned"))?;
            let state = cache.entry(repo_key).or_default();
            state.generation = state.generation.saturating_add(1);

            match state.entry.as_ref() {
                Some(entry) if entry.metadata_namespace == metadata_namespace => true,
                _ => {
                    state.entry = None;
                    false
                }
            }
        };
        if !has_cached_entry {
            return Ok(());
        }

        let task = self.show_task(repo_path, task_id)?;
        self.refresh_cached_pull_request_sync_candidate(repo_path, task)
    }

    pub(super) fn remove_cached_pull_request_sync_candidate(
        &self,
        repo_path: &Path,
        task_id: &str,
    ) -> Result<()> {
        let repo_key = Self::repo_key(repo_path);
        let mut cache = self
            .pull_request_sync_candidate_cache
            .lock()
            .map_err(|_| anyhow!("Beads PR-sync candidate cache lock poisoned"))?;
        let state = cache.entry(repo_key).or_default();
        state.generation = state.generation.saturating_add(1);
        if let Some(entry) = state.entry.as_mut() {
            entry.tasks.retain(|task| task.id != task_id);
            entry.cached_at = Instant::now();
        }
        Ok(())
    }

    pub(super) fn clear_cached_pull_request_sync_candidates(&self, repo_path: &Path) -> Result<()> {
        let repo_key = Self::repo_key(repo_path);
        let mut cache = self
            .pull_request_sync_candidate_cache
            .lock()
            .map_err(|_| anyhow!("Beads PR-sync candidate cache lock poisoned"))?;
        let state = cache.entry(repo_key).or_default();
        state.generation = state.generation.saturating_add(1);
        state.entry = None;
        Ok(())
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

    #[cfg(test)]
    pub(crate) fn pull_request_sync_candidate_cache_generation_for_repo(
        &self,
        repo_path: &Path,
    ) -> Result<u64> {
        let repo_key = Self::repo_key(repo_path);
        let mut cache = self
            .pull_request_sync_candidate_cache
            .lock()
            .map_err(|_| anyhow!("Beads PR-sync candidate cache lock poisoned"))?;
        let state = cache.entry(repo_key).or_default();
        Ok(state.generation)
    }

    #[cfg(test)]
    pub(crate) fn cache_pull_request_sync_candidates_for_repo_if_generation(
        &self,
        repo_path: &Path,
        metadata_namespace: &str,
        generation: u64,
        tasks: &[TaskCard],
    ) -> Result<()> {
        let repo_key = Self::repo_key(repo_path);
        self.cache_pull_request_sync_candidates_if_generation(
            &repo_key,
            metadata_namespace,
            generation,
            tasks,
        )?;
        Ok(())
    }
}
