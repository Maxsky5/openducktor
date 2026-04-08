use anyhow::{anyhow, Context, Result};
use host_infra_system::{compute_beads_database_name, ensure_shared_dolt_server_running};
use serde::Deserialize;
use serde_json::Value;
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};

use crate::constants::CUSTOM_STATUS_VALUES;
use crate::store::BeadsTaskStore;

#[derive(Debug, Deserialize)]
struct BeadsAttachmentMetadata {
    backend: Option<String>,
    dolt_mode: Option<String>,
    dolt_server_host: Option<String>,
    dolt_server_port: Option<u16>,
    dolt_server_user: Option<String>,
    dolt_database: Option<String>,
}

#[derive(Debug, Deserialize)]
struct BeadsWherePayload {
    path: Option<String>,
    error: Option<String>,
}

impl BeadsTaskStore {
    pub(crate) fn repo_key(repo_path: &Path) -> String {
        fs::canonicalize(repo_path)
            .unwrap_or_else(|_| repo_path.to_path_buf())
            .to_string_lossy()
            .to_string()
    }

    pub(crate) fn repo_lock(&self, repo_key: &str) -> Result<Arc<Mutex<()>>> {
        let mut lock_map = self
            .init_locks
            .lock()
            .map_err(|_| anyhow!("Beads init lock poisoned"))?;
        Ok(lock_map
            .entry(repo_key.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone())
    }

    pub(crate) fn is_repo_cached_initialized(&self, repo_key: &str) -> Result<bool> {
        let cache = self
            .initialized_repos
            .lock()
            .map_err(|_| anyhow!("Beads init cache lock poisoned"))?;
        Ok(cache.contains(repo_key))
    }

    pub(crate) fn mark_repo_initialized(&self, repo_key: &str) -> Result<()> {
        let mut cache = self
            .initialized_repos
            .lock()
            .map_err(|_| anyhow!("Beads init cache lock poisoned"))?;
        cache.insert(repo_key.to_string());
        Ok(())
    }

    pub(crate) fn verify_repo_initialized(
        &self,
        repo_path: &Path,
        beads_dir: &Path,
    ) -> Result<(bool, String)> {
        let env = self.build_bd_env(repo_path, true)?;
        if let Err(error) = self.verify_repo_attachment_contract(repo_path, beads_dir, &env) {
            return Ok((false, error.to_string()));
        }
        let env_refs = env
            .iter()
            .map(|(key, value)| (key.as_str(), value.as_str()))
            .collect::<Vec<_>>();
        let working_dir = self.ensure_beads_working_dir(repo_path)?;
        let (ok, stdout, stderr) = self.command_runner.run_allow_failure_with_env(
            "bd",
            &["where", "--json"],
            Some(&working_dir),
            &env_refs,
        )?;

        let json_payload = Self::extract_json_payload(&stdout, &stderr);

        if !json_payload.is_empty() {
            // Treat malformed JSON as a hard failure: the CLI contract for
            // `bd where --json` is broken in that case, so attempting repair
            // would mask an unexpected protocol error.
            let payload: Value = serde_json::from_str(json_payload)
                .context("Failed to parse `bd where --json` output")?;
            let where_payload: BeadsWherePayload = serde_json::from_value(payload.clone())
                .context("Failed to decode `bd where --json` payload")?;
            if let Some(path) = where_payload.path.as_deref() {
                if self.attachment_paths_match(path, beads_dir)? {
                    return Ok((true, String::new()));
                }

                return Ok((
                    false,
                    format!(
                        "Beads attachment resolves to {}, expected {}",
                        path,
                        beads_dir.display()
                    ),
                ));
            }
            if let Some(error) = where_payload.error.as_deref() {
                return Ok((false, error.trim().to_string()));
            }
            if payload.get("path").and_then(Value::as_str).is_some() {
                return Ok((true, String::new()));
            }
            if let Some(error) = payload.get("error").and_then(Value::as_str) {
                return Ok((false, error.trim().to_string()));
            }

            return Ok((false, "bd where returned malformed payload".to_string()));
        }

        if !ok {
            let error = if stderr.trim().is_empty() {
                "bd where failed".to_string()
            } else {
                stderr.trim().to_string()
            };
            return Ok((false, error));
        }

        Ok((false, "bd where returned empty payload".to_string()))
    }

    fn extract_json_payload<'a>(stdout: &'a str, stderr: &'a str) -> &'a str {
        let trimmed_stdout = stdout.trim();
        if !trimmed_stdout.is_empty() {
            return trimmed_stdout;
        }

        let trimmed_stderr = stderr.trim();
        if trimmed_stderr.is_empty() {
            return "";
        }

        if let Some(index) = trimmed_stderr.find('{') {
            return &trimmed_stderr[index..];
        }

        ""
    }

    fn verify_repo_attachment_contract(
        &self,
        repo_path: &Path,
        beads_dir: &Path,
        env: &[(String, String)],
    ) -> Result<()> {
        let metadata_path = beads_dir.join("metadata.json");
        if !metadata_path.is_file() {
            if !self.command_runner.uses_real_processes() {
                return Ok(());
            }
            return Err(anyhow!(
                "Beads attachment metadata is missing at {}",
                metadata_path.display()
            ));
        }

        let metadata_raw = fs::read_to_string(&metadata_path).with_context(|| {
            format!(
                "Failed reading Beads attachment metadata {}",
                metadata_path.display()
            )
        })?;
        let metadata: BeadsAttachmentMetadata =
            serde_json::from_str(&metadata_raw).with_context(|| {
                format!(
                    "Failed parsing Beads attachment metadata {}",
                    metadata_path.display()
                )
            })?;

        let expected_database = compute_beads_database_name(repo_path)?;
        let expected_host = Self::required_env_value(env, "BEADS_DOLT_SERVER_HOST")?;
        let expected_port = Self::required_env_value(env, "BEADS_DOLT_SERVER_PORT")?
            .parse::<u16>()
            .context("BEADS_DOLT_SERVER_PORT is not a valid port")?;
        let expected_user = Self::required_env_value(env, "BEADS_DOLT_SERVER_USER")?;

        if metadata.backend.as_deref() != Some("dolt") {
            return Err(anyhow!(
                "Beads attachment backend is {:?}, expected dolt",
                metadata.backend
            ));
        }
        if metadata.dolt_mode.as_deref() != Some("server") {
            return Err(anyhow!(
                "Beads attachment mode is {:?}, expected server",
                metadata.dolt_mode
            ));
        }
        if let Some(host) = metadata.dolt_server_host.as_deref() {
            if host != expected_host.as_str() {
                return Err(anyhow!(
                    "Beads attachment host is {:?}, expected {}",
                    metadata.dolt_server_host,
                    expected_host
                ));
            }
        }
        if let Some(port) = metadata.dolt_server_port {
            if port != expected_port {
                return Err(anyhow!(
                    "Beads attachment port is {:?}, expected {}",
                    metadata.dolt_server_port,
                    expected_port
                ));
            }
        }
        if let Some(user) = metadata.dolt_server_user.as_deref() {
            if user != expected_user.as_str() {
                return Err(anyhow!(
                    "Beads attachment user is {:?}, expected {}",
                    metadata.dolt_server_user,
                    expected_user
                ));
            }
        }
        if metadata.dolt_database.as_deref() != Some(expected_database.as_str()) {
            return Err(anyhow!(
                "Beads attachment database is {:?}, expected {}",
                metadata.dolt_database,
                expected_database
            ));
        }

        Ok(())
    }

    fn required_env_value(env: &[(String, String)], key: &str) -> Result<String> {
        env.iter()
            .find_map(|(env_key, value)| (env_key == key).then_some(value.clone()))
            .ok_or_else(|| anyhow!("Missing required environment value: {key}"))
    }

    fn attachment_paths_match(&self, actual_path: &str, expected_path: &Path) -> Result<bool> {
        let actual = fs::canonicalize(actual_path).unwrap_or_else(|_| actual_path.into());
        let expected =
            fs::canonicalize(expected_path).unwrap_or_else(|_| expected_path.to_path_buf());
        Ok(actual == expected)
    }

    pub(crate) fn repair_repo_store(&self, repo_path: &Path) -> Result<()> {
        self.run_bd(repo_path, &["doctor", "--fix", "--yes"])
            .with_context(|| {
                format!(
                    "Failed to repair Beads store attachment for {}",
                    repo_path.display()
                )
            })?;
        Ok(())
    }

    pub(crate) fn ensure_custom_statuses(&self, repo_path: &Path) -> Result<()> {
        self.run_bd(
            repo_path,
            &["config", "set", "status.custom", CUSTOM_STATUS_VALUES],
        )
        .with_context(|| {
            format!(
                "Failed to configure custom statuses in {}",
                repo_path.display()
            )
        })?;
        Ok(())
    }

    pub(crate) fn ensure_dolt_server_running(&self, repo_path: &Path) -> Result<()> {
        if !self.command_runner.uses_real_processes() {
            return Ok(());
        }

        ensure_shared_dolt_server_running(std::process::id()).with_context(|| {
            format!(
                "Failed to ensure shared Dolt server is running for {}",
                repo_path.display()
            )
        })?;
        Ok(())
    }
}
