use super::*;

impl AppService {
    pub(super) fn repo_key(repo_path: &str) -> String {
        fs::canonicalize(repo_path)
            .unwrap_or_else(|_| Path::new(repo_path).to_path_buf())
            .to_string_lossy()
            .to_string()
    }

    pub fn resolve_authorized_repo_path(&self, repo_path: &str) -> Result<String> {
        let repo_key = Self::repo_key(repo_path);
        if !self.enforce_repo_allowlist {
            return Ok(repo_key);
        }

        let is_allowed = self.config_store.repo_config_optional(repo_path)?.is_some();
        if !is_allowed {
            return Err(anyhow!(
                "Repository path is not in the configured workspace allowlist: {repo_path}"
            ));
        }

        Ok(repo_key)
    }

    pub(super) fn resolve_initialized_repo_path(&self, repo_path: &str) -> Result<String> {
        let repo_key = self.resolve_authorized_repo_path(repo_path)?;
        {
            let cache = self
                .initialized_repos
                .lock()
                .map_err(|_| anyhow!("Initialized repo cache lock poisoned"))?;
            if cache.contains(&repo_key) {
                return Ok(repo_key);
            }
        }

        self.task_store
            .ensure_repo_initialized(Path::new(&repo_key))
            .with_context(|| format!("Failed to initialize task store for {}", repo_key))?;

        let mut cache = self
            .initialized_repos
            .lock()
            .map_err(|_| anyhow!("Initialized repo cache lock poisoned"))?;
        cache.insert(repo_key.clone());

        Ok(repo_key)
    }

    pub(super) fn ensure_repo_initialized(&self, repo_path: &str) -> Result<()> {
        self.resolve_initialized_repo_path(repo_path).map(|_| ())
    }
}
