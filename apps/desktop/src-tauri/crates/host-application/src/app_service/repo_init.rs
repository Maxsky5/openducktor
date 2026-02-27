use super::*;

impl AppService {
    pub(super) fn repo_key(repo_path: &str) -> String {
        fs::canonicalize(repo_path)
            .unwrap_or_else(|_| Path::new(repo_path).to_path_buf())
            .to_string_lossy()
            .to_string()
    }

    pub(super) fn ensure_repo_initialized(&self, repo_path: &str) -> Result<()> {
        let repo_key = Self::repo_key(repo_path);
        {
            let cache = self
                .initialized_repos
                .lock()
                .map_err(|_| anyhow!("Initialized repo cache lock poisoned"))?;
            if cache.contains(&repo_key) {
                return Ok(());
            }
        }

        self.task_store
            .ensure_repo_initialized(Path::new(repo_path))
            .with_context(|| format!("Failed to initialize task store for {repo_path}"))?;

        let mut cache = self
            .initialized_repos
            .lock()
            .map_err(|_| anyhow!("Initialized repo cache lock poisoned"))?;
        cache.insert(repo_key);

        Ok(())
    }
}
