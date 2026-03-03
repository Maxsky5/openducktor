use super::*;

impl BeadsTaskStore {
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

    pub(crate) fn current_metadata_namespace(&self) -> String {
        self.metadata_namespace_snapshot()
    }
}
