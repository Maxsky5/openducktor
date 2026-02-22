use anyhow::{anyhow, Result};
use serde_json::{Map, Value};
use std::path::Path;

use crate::metadata::parse_metadata_root;
use crate::model::RawIssue;
use crate::store::BeadsTaskStore;

impl BeadsTaskStore {
    pub(crate) fn write_metadata(
        &self,
        repo_path: &Path,
        task_id: &str,
        metadata: &Map<String, Value>,
    ) -> Result<()> {
        let payload = serde_json::to_string(&Value::Object(metadata.clone()))?;
        self.run_bd_json(
            repo_path,
            &["update", task_id, "--metadata", payload.as_str()],
        )?;
        Ok(())
    }

    pub(crate) fn load_namespace(
        &self,
        repo_path: &Path,
        task_id: &str,
    ) -> Result<(RawIssue, Map<String, Value>, Map<String, Value>)> {
        let issue = self.show_raw_issue(repo_path, task_id)?;
        let mut root = parse_metadata_root(issue.metadata.clone());

        let namespace = root
            .entry(self.metadata_namespace.clone())
            .or_insert_with(|| Value::Object(Map::new()));
        if !namespace.is_object() {
            *namespace = Value::Object(Map::new());
        }

        let namespace_map = namespace
            .as_object()
            .cloned()
            .ok_or_else(|| anyhow!("Invalid metadata namespace payload"))?;

        Ok((issue, root, namespace_map))
    }

    pub(crate) fn persist_namespace(
        &self,
        repo_path: &Path,
        task_id: &str,
        root: &mut Map<String, Value>,
        namespace_map: Map<String, Value>,
    ) -> Result<()> {
        root.insert(
            self.metadata_namespace.clone(),
            Value::Object(namespace_map),
        );
        self.write_metadata(repo_path, task_id, root)
    }
}
