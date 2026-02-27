use super::*;

impl BeadsTaskStore {
    pub(super) fn default_metadata_namespace_resolver() -> MetadataNamespaceResolver {
        Arc::new(|| {
            let config_store = AppConfigStore::new()?;
            config_store.task_metadata_namespace()
        })
    }

    pub(super) fn normalize_metadata_namespace(namespace: &str) -> String {
        let trimmed = namespace.trim();
        if trimmed.is_empty() {
            DEFAULT_METADATA_NAMESPACE.to_string()
        } else {
            trimmed.to_string()
        }
    }

    pub(super) fn metadata_namespace_snapshot(&self) -> String {
        match self.metadata_namespace.lock() {
            Ok(guard) => guard.clone(),
            Err(poisoned) => poisoned.into_inner().clone(),
        }
    }

    fn set_metadata_namespace(&self, namespace: &str) {
        let normalized = Self::normalize_metadata_namespace(namespace);
        match self.metadata_namespace.lock() {
            Ok(mut guard) => *guard = normalized,
            Err(poisoned) => {
                let mut guard = poisoned.into_inner();
                *guard = normalized;
            }
        }
    }

    fn refresh_metadata_namespace(&self) {
        let Some(resolve_namespace) = &self.metadata_namespace_resolver else {
            return;
        };

        let Ok(namespace) = resolve_namespace() else {
            return;
        };

        self.set_metadata_namespace(&namespace);
    }

    pub(crate) fn current_metadata_namespace(&self) -> String {
        self.refresh_metadata_namespace();
        self.metadata_namespace_snapshot()
    }
}
