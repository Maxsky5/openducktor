use anyhow::{anyhow, Context, Result};
use host_domain::{
    RepoStoreAttachmentHealth, RepoStoreHealth, RepoStoreHealthCategory, RepoStoreHealthStatus,
    RepoStoreSharedServerHealth, RepoStoreSharedServerOwnershipState,
};
use host_infra_system::{
    compute_beads_database_name, compute_beads_database_name_for_workspace, is_process_alive,
    read_shared_dolt_server_state, resolve_repo_beads_attachment_dir,
    resolve_workspace_beads_attachment_dir, SharedDoltServerAcquisition, SHARED_DOLT_SERVER_HOST,
};
use serde::Deserialize;
use std::fs;
use std::path::Path;

use super::{BeadsLifecycle, LifecycleError};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum RepoReadiness {
    Ready,
    MissingAttachment,
    BrokenAttachmentContract { reason: String },
    SharedDoltUnavailable { reason: String },
    MissingSharedDatabase { database_name: String },
    AttachmentVerificationFailed { reason: String },
}

impl RepoReadiness {
    pub(crate) fn description(&self) -> String {
        match self {
            Self::Ready => "ready".to_string(),
            Self::MissingAttachment => "Beads attachment is missing".to_string(),
            Self::BrokenAttachmentContract { reason } => reason.clone(),
            Self::SharedDoltUnavailable { reason } => reason.clone(),
            Self::MissingSharedDatabase { database_name } => {
                format!("Shared Dolt database {database_name} is missing")
            }
            Self::AttachmentVerificationFailed { reason } => reason.clone(),
        }
    }
}

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

#[derive(Debug)]
struct SharedDoltConnection {
    host: String,
    port: String,
    user: String,
}

#[derive(Debug, Clone)]
struct SharedServerSnapshot {
    host: Option<String>,
    port: Option<u16>,
    owner_pid: Option<u32>,
    acquisition: Option<SharedDoltServerAcquisition>,
}

type DiagnosticsEnv = (Vec<(String, String)>, SharedServerSnapshot, bool);

impl SharedDoltConnection {
    fn from_env(env: &[(String, String)]) -> Result<Self> {
        Ok(Self {
            host: BeadsLifecycle::required_env_value(env, "BEADS_DOLT_SERVER_HOST")?,
            port: BeadsLifecycle::required_env_value(env, "BEADS_DOLT_SERVER_PORT")?,
            user: BeadsLifecycle::required_env_value(env, "BEADS_DOLT_SERVER_USER")?,
        })
    }

    fn show_databases_args(&self) -> [&str; 11] {
        [
            "--host",
            self.host.as_str(),
            "--port",
            self.port.as_str(),
            "--no-tls",
            "-u",
            self.user.as_str(),
            "-p",
            "",
            "sql",
            "-q",
        ]
    }
}

enum SharedDatabaseProbe {
    Available,
    Missing { database_name: String },
    Unavailable { reason: String },
}

enum BdWhereCommandOutput<'a> {
    Json(&'a str),
    EmptySuccess,
    MissingJsonFailure,
}

impl BeadsLifecycle {
    pub(crate) fn diagnose_repo_store_for_identity(
        &self,
        repo_path: &Path,
        repo_key_override: Option<&str>,
        workspace_id: Option<&str>,
    ) -> Result<RepoStoreHealth> {
        let repo_key = repo_key_override
            .map(|value| value.to_string())
            .unwrap_or_else(|| Self::repo_key(repo_path));
        let beads_dir = match workspace_id {
            Some(workspace_id) => resolve_workspace_beads_attachment_dir(workspace_id)?,
            None => resolve_repo_beads_attachment_dir(repo_path)?,
        };
        let attachment_path = beads_dir.to_string_lossy().to_string();
        let database_name = match workspace_id {
            Some(workspace_id) => compute_beads_database_name_for_workspace(workspace_id)?,
            None => compute_beads_database_name(repo_path)?,
        };
        let base_shared_server = self.repo_store_shared_server_snapshot()?;

        if self.is_repo_initializing(&repo_key)? {
            return Ok(self.build_repo_store_health(
                RepoStoreHealthCategory::Initializing,
                RepoStoreHealthStatus::Initializing,
                Some(format!(
                    "Beads task store initialization is in progress for {}",
                    repo_path.display()
                )),
                attachment_path,
                database_name,
                &base_shared_server,
            ));
        }

        if !attachment_dir_exists(&beads_dir)? {
            return Ok(self.build_repo_store_health(
                RepoStoreHealthCategory::MissingAttachment,
                RepoStoreHealthStatus::Blocking,
                Some(format!("Beads attachment is missing at {attachment_path}")),
                attachment_path,
                database_name,
                &base_shared_server,
            ));
        }

        let (env, shared_server, verify_contract) = match self.diagnostics_env_for_repo_store(
            repo_path,
            &beads_dir,
            &base_shared_server,
            workspace_id,
        ) {
            Ok(Some(values)) => values,
            Ok(None) => {
                let detail = LifecycleError::SharedDoltStateMissing {
                    repo_path: repo_path.to_path_buf(),
                }
                .to_string();
                return Ok(self.build_repo_store_health(
                    RepoStoreHealthCategory::SharedServerUnavailable,
                    RepoStoreHealthStatus::Blocking,
                    Some(detail),
                    attachment_path,
                    database_name,
                    &base_shared_server,
                ));
            }
            Err(error) => {
                return Ok(self.build_repo_store_health(
                    RepoStoreHealthCategory::AttachmentContractInvalid,
                    RepoStoreHealthStatus::Blocking,
                    Some(error.to_string()),
                    attachment_path,
                    database_name,
                    &base_shared_server,
                ));
            }
        };

        let detail_from_readiness = |readiness: &RepoReadiness| match readiness {
            RepoReadiness::Ready => {
                Some("Beads attachment and shared Dolt server are healthy.".to_string())
            }
            RepoReadiness::MissingAttachment => {
                Some(format!("Beads attachment is missing at {attachment_path}"))
            }
            RepoReadiness::BrokenAttachmentContract { reason }
            | RepoReadiness::SharedDoltUnavailable { reason }
            | RepoReadiness::AttachmentVerificationFailed { reason } => Some(reason.clone()),
            RepoReadiness::MissingSharedDatabase { database_name } => Some(format!(
                "Shared Dolt database {database_name} is missing and restore is required"
            )),
        };

        match self.verify_repo_initialized_with_env(
            repo_path,
            &beads_dir,
            &env,
            verify_contract,
            workspace_id,
        ) {
            Ok(readiness) => {
                let (category, status) = match &readiness {
                    RepoReadiness::Ready => (
                        RepoStoreHealthCategory::Healthy,
                        RepoStoreHealthStatus::Ready,
                    ),
                    RepoReadiness::MissingAttachment => (
                        RepoStoreHealthCategory::MissingAttachment,
                        RepoStoreHealthStatus::Blocking,
                    ),
                    RepoReadiness::BrokenAttachmentContract { .. } => (
                        RepoStoreHealthCategory::AttachmentContractInvalid,
                        RepoStoreHealthStatus::Blocking,
                    ),
                    RepoReadiness::SharedDoltUnavailable { .. } => (
                        RepoStoreHealthCategory::SharedServerUnavailable,
                        RepoStoreHealthStatus::Blocking,
                    ),
                    RepoReadiness::MissingSharedDatabase { .. } => (
                        RepoStoreHealthCategory::MissingSharedDatabase,
                        RepoStoreHealthStatus::RestoreNeeded,
                    ),
                    RepoReadiness::AttachmentVerificationFailed { .. } => (
                        RepoStoreHealthCategory::AttachmentVerificationFailed,
                        RepoStoreHealthStatus::Degraded,
                    ),
                };

                Ok(self.build_repo_store_health(
                    category,
                    status,
                    detail_from_readiness(&readiness),
                    attachment_path,
                    database_name,
                    &shared_server,
                ))
            }
            Err(error) => Ok(self.build_repo_store_health(
                RepoStoreHealthCategory::AttachmentVerificationFailed,
                RepoStoreHealthStatus::Degraded,
                Some(error.to_string()),
                attachment_path,
                database_name,
                &shared_server,
            )),
        }
    }

    #[cfg(test)]
    pub(crate) fn verify_repo_initialized(
        &self,
        repo_path: &Path,
        beads_dir: &Path,
    ) -> Result<RepoReadiness> {
        self.verify_repo_initialized_for_identity(repo_path, beads_dir, None)
    }

    pub(crate) fn verify_repo_initialized_for_identity(
        &self,
        repo_path: &Path,
        beads_dir: &Path,
        workspace_id: Option<&str>,
    ) -> Result<RepoReadiness> {
        if !attachment_dir_exists(beads_dir)? {
            return Ok(RepoReadiness::MissingAttachment);
        }

        let env = self.build_bd_env_for_identity(repo_path, workspace_id)?;
        self.verify_repo_initialized_with_env(repo_path, beads_dir, &env, true, workspace_id)
    }

    fn verify_repo_initialized_with_env(
        &self,
        repo_path: &Path,
        beads_dir: &Path,
        env: &[(String, String)],
        verify_contract: bool,
        workspace_id: Option<&str>,
    ) -> Result<RepoReadiness> {
        if verify_contract {
            if let Err(error) =
                self.verify_repo_attachment_contract(repo_path, beads_dir, env, workspace_id)
            {
                return Ok(RepoReadiness::BrokenAttachmentContract {
                    reason: error.to_string(),
                });
            }
        }

        let shared_dolt_connection = SharedDoltConnection::from_env(env)?;
        match self.probe_shared_database_presence(
            repo_path,
            &shared_dolt_connection,
            workspace_id,
        )? {
            SharedDatabaseProbe::Available => {}
            SharedDatabaseProbe::Missing { database_name } => {
                return Ok(RepoReadiness::MissingSharedDatabase { database_name });
            }
            SharedDatabaseProbe::Unavailable { reason } => {
                return Ok(RepoReadiness::SharedDoltUnavailable { reason });
            }
        }

        self.probe_beads_where(repo_path, beads_dir, env, workspace_id)
    }

    fn diagnostics_env_for_repo_store(
        &self,
        repo_path: &Path,
        beads_dir: &Path,
        shared_server: &SharedServerSnapshot,
        workspace_id: Option<&str>,
    ) -> Result<Option<DiagnosticsEnv>> {
        if shared_server.host.is_some() && shared_server.port.is_some() {
            return Ok(Some((
                self.build_bd_env_for_identity(repo_path, workspace_id)?,
                shared_server.clone(),
                true,
            )));
        }

        if !self.command_runner().uses_real_processes() {
            return Ok(Some((
                self.build_bd_env_for_identity(repo_path, workspace_id)?,
                shared_server.clone(),
                true,
            )));
        }

        let metadata = Self::read_attachment_metadata(beads_dir)?;
        Self::validate_attachment_metadata_for_diagnostics(repo_path, &metadata, workspace_id)?;
        Ok(None)
    }

    fn read_attachment_metadata(beads_dir: &Path) -> Result<BeadsAttachmentMetadata> {
        let metadata_path = beads_dir.join("metadata.json");
        if !metadata_path.is_file() {
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
        serde_json::from_str(&metadata_raw).with_context(|| {
            format!(
                "Failed parsing Beads attachment metadata {}",
                metadata_path.display()
            )
        })
    }

    fn validate_attachment_metadata_for_diagnostics(
        repo_path: &Path,
        metadata: &BeadsAttachmentMetadata,
        workspace_id: Option<&str>,
    ) -> Result<()> {
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

        metadata
            .dolt_server_host
            .clone()
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| anyhow!("Beads attachment host is missing from metadata"))?;
        metadata
            .dolt_server_port
            .ok_or_else(|| anyhow!("Beads attachment port is missing from metadata"))?
            .to_string();
        metadata
            .dolt_server_user
            .clone()
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| anyhow!("Beads attachment user is missing from metadata"))?;

        let expected_database = match workspace_id {
            Some(workspace_id) => compute_beads_database_name_for_workspace(workspace_id)?,
            None => compute_beads_database_name(repo_path)?,
        };
        if metadata.dolt_database.as_deref() != Some(expected_database.as_str()) {
            return Err(anyhow!(
                "Beads attachment database is {:?}, expected {}",
                metadata.dolt_database,
                expected_database
            ));
        }

        Ok(())
    }

    fn probe_beads_where(
        &self,
        repo_path: &Path,
        beads_dir: &Path,
        env: &[(String, String)],
        workspace_id: Option<&str>,
    ) -> Result<RepoReadiness> {
        let env_refs = env
            .iter()
            .map(|(key, value)| (key.as_str(), value.as_str()))
            .collect::<Vec<_>>();
        let working_dir = self.ensure_beads_working_dir_for_identity(repo_path, workspace_id)?;
        let (ok, stdout, stderr) = self.command_runner().run_allow_failure_with_env(
            "bd",
            &["where", "--json"],
            Some(&working_dir),
            &env_refs,
        )?;

        match Self::classify_bd_where_command_output(ok, &stdout, &stderr) {
            BdWhereCommandOutput::Json(json_payload) => {
                self.parse_bd_where_payload(json_payload, beads_dir)
            }
            BdWhereCommandOutput::EmptySuccess => Err(anyhow!(
                "bd where --json exited successfully but returned no JSON payload"
            )),
            BdWhereCommandOutput::MissingJsonFailure => Err(anyhow!(
                "bd where --json exited unsuccessfully without a decodable JSON payload"
            )),
        }
    }

    fn classify_bd_where_command_output<'a>(
        ok: bool,
        stdout: &'a str,
        stderr: &'a str,
    ) -> BdWhereCommandOutput<'a> {
        let stderr_payload = Self::extract_stderr_json_payload(stderr);
        if !stderr_payload.is_empty() {
            return BdWhereCommandOutput::Json(stderr_payload);
        }

        let stdout_payload = Self::extract_stdout_json_payload(stdout);
        if !stdout_payload.is_empty() {
            return BdWhereCommandOutput::Json(stdout_payload);
        }

        if ok {
            return BdWhereCommandOutput::EmptySuccess;
        }

        BdWhereCommandOutput::MissingJsonFailure
    }

    fn parse_bd_where_payload(
        &self,
        json_payload: &str,
        beads_dir: &Path,
    ) -> Result<RepoReadiness> {
        let where_payload: BeadsWherePayload = serde_json::from_str(json_payload)
            .context("Failed to decode `bd where --json` payload")?;
        let path = where_payload.path.as_deref().map(str::trim);
        let error = where_payload.error.as_deref().map(str::trim);

        if path.is_some() && error.is_some() {
            return Err(anyhow!("bd where --json returned both path and error"));
        }

        if let Some(path) = path {
            if path.is_empty() {
                return Err(anyhow!("bd where --json returned an empty path field"));
            }

            if self.attachment_paths_match(path, beads_dir)? {
                return Ok(RepoReadiness::Ready);
            }

            return Ok(RepoReadiness::AttachmentVerificationFailed {
                reason: format!(
                    "Beads attachment resolves to {}, expected {}",
                    path,
                    beads_dir.display()
                ),
            });
        }
        if let Some(reason) = error {
            if reason.is_empty() {
                return Err(anyhow!("bd where --json returned an empty error field"));
            }
            return Ok(RepoReadiness::AttachmentVerificationFailed {
                reason: reason.to_string(),
            });
        }

        Err(anyhow!(
            "bd where --json returned a JSON payload without path or error"
        ))
    }

    fn extract_stdout_json_payload(stdout: &str) -> &str {
        let trimmed_stdout = stdout.trim();
        if trimmed_stdout.is_empty() {
            return "";
        }

        if Self::payload_decodes_as_bd_where_payload(trimmed_stdout) {
            return trimmed_stdout;
        }

        if let Some(payload_start) = Self::locate_json_payload_start(trimmed_stdout) {
            let candidate = &trimmed_stdout[payload_start..];
            if Self::payload_decodes_as_bd_where_payload(candidate) {
                return candidate;
            }
        }

        trimmed_stdout
    }

    fn extract_stderr_json_payload(stderr: &str) -> &str {
        let trimmed_stderr = stderr.trim();
        if trimmed_stderr.is_empty() {
            return "";
        }

        if Self::payload_decodes_as_bd_where_payload(trimmed_stderr) {
            return trimmed_stderr;
        }

        if let Some(payload_start) = Self::locate_json_payload_start(trimmed_stderr) {
            let candidate = &trimmed_stderr[payload_start..];
            if Self::payload_decodes_as_bd_where_payload(candidate) {
                return candidate;
            }
        }

        ""
    }

    fn payload_decodes_as_bd_where_payload(payload: &str) -> bool {
        serde_json::from_str::<BeadsWherePayload>(payload)
            .ok()
            .map(|parsed| {
                parsed
                    .path
                    .as_deref()
                    .map(str::trim)
                    .is_some_and(|path| !path.is_empty())
                    || parsed
                        .error
                        .as_deref()
                        .map(str::trim)
                        .is_some_and(|error| !error.is_empty())
            })
            .unwrap_or(false)
    }

    fn locate_json_payload_start(payload: &str) -> Option<usize> {
        let object_index = payload.find('{');
        let array_index = payload.find('[');
        [object_index, array_index].into_iter().flatten().min()
    }

    fn repo_store_shared_server_snapshot(&self) -> Result<SharedServerSnapshot> {
        if let Some(server_state) = read_shared_dolt_server_state()? {
            let owner_pid = (server_state.owner_pid == std::process::id()
                || is_process_alive(server_state.owner_pid))
            .then_some(server_state.owner_pid);

            return Ok(SharedServerSnapshot {
                host: Some(server_state.host),
                port: Some(server_state.port),
                owner_pid,
                acquisition: Some(server_state.acquisition),
            });
        }

        if !self.command_runner().uses_real_processes() {
            return Ok(SharedServerSnapshot {
                host: Some(SHARED_DOLT_SERVER_HOST.to_string()),
                port: Some(3307),
                owner_pid: None,
                acquisition: None,
            });
        }

        Ok(SharedServerSnapshot {
            host: None,
            port: None,
            owner_pid: None,
            acquisition: None,
        })
    }

    fn build_repo_store_health(
        &self,
        category: RepoStoreHealthCategory,
        status: RepoStoreHealthStatus,
        detail: Option<String>,
        attachment_path: String,
        database_name: String,
        shared_server: &SharedServerSnapshot,
    ) -> RepoStoreHealth {
        let ownership_state = match shared_server.owner_pid {
            Some(owner_pid)
                if owner_pid != std::process::id()
                    && !matches!(
                        category,
                        RepoStoreHealthCategory::SharedServerUnavailable
                            | RepoStoreHealthCategory::Initializing
                    ) =>
            {
                RepoStoreSharedServerOwnershipState::ReusedExistingServer
            }
            Some(owner_pid) if owner_pid == std::process::id() => match shared_server.acquisition {
                Some(SharedDoltServerAcquisition::AdoptedOrphanedServer) => {
                    RepoStoreSharedServerOwnershipState::AdoptedOrphanedServer
                }
                _ => RepoStoreSharedServerOwnershipState::OwnedByCurrentProcess,
            },
            _ => RepoStoreSharedServerOwnershipState::Unavailable,
        };

        RepoStoreHealth {
            category,
            status: status.clone(),
            is_ready: matches!(status, RepoStoreHealthStatus::Ready),
            detail,
            attachment: RepoStoreAttachmentHealth {
                path: Some(attachment_path),
                database_name: Some(database_name),
            },
            shared_server: RepoStoreSharedServerHealth {
                host: shared_server.host.clone(),
                port: shared_server.port,
                ownership_state,
            },
        }
    }

    fn probe_shared_database_presence(
        &self,
        repo_path: &Path,
        shared_dolt_connection: &SharedDoltConnection,
        workspace_id: Option<&str>,
    ) -> Result<SharedDatabaseProbe> {
        let expected_database = match workspace_id {
            Some(workspace_id) => compute_beads_database_name_for_workspace(workspace_id)?,
            None => compute_beads_database_name(repo_path)?,
        };
        let mut args = shared_dolt_connection.show_databases_args().to_vec();
        args.push("show databases");
        let (ok, stdout, stderr) =
            self.command_runner()
                .run_allow_failure_with_env("dolt", &args, None, &[])?;

        if !ok {
            return Ok(SharedDatabaseProbe::Unavailable {
                reason: Self::command_failure_reason(
                    "Shared Dolt database probe failed",
                    &stdout,
                    &stderr,
                ),
            });
        }
        if stdout.trim().is_empty() {
            return Ok(SharedDatabaseProbe::Unavailable {
                reason: "Shared Dolt database probe returned empty output".to_string(),
            });
        }
        if Self::database_list_contains(&stdout, expected_database.as_str()) {
            return Ok(SharedDatabaseProbe::Available);
        }

        Ok(SharedDatabaseProbe::Missing {
            database_name: expected_database,
        })
    }

    fn verify_repo_attachment_contract(
        &self,
        repo_path: &Path,
        beads_dir: &Path,
        env: &[(String, String)],
        workspace_id: Option<&str>,
    ) -> Result<()> {
        let metadata_path = beads_dir.join("metadata.json");
        if !metadata_path.is_file() {
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

        let expected_database = match workspace_id {
            Some(workspace_id) => compute_beads_database_name_for_workspace(workspace_id)?,
            None => compute_beads_database_name(repo_path)?,
        };
        let expected_host = Self::required_env_value(env, "BEADS_DOLT_SERVER_HOST")?;
        let expected_port_value = Self::required_env_value(env, "BEADS_DOLT_SERVER_PORT")?;
        let expected_port =
            expected_port_value
                .parse::<u16>()
                .map_err(|_| LifecycleError::InvalidServerPort {
                    value: expected_port_value.clone(),
                })?;
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
        if metadata.dolt_server_host.as_deref() != Some(expected_host.as_str()) {
            return Err(anyhow!(
                "Beads attachment host is {:?}, expected {}",
                metadata.dolt_server_host,
                expected_host
            ));
        }
        if metadata.dolt_server_port != Some(expected_port) {
            return Err(anyhow!(
                "Beads attachment port is {:?}, expected {}",
                metadata.dolt_server_port,
                expected_port
            ));
        }
        if metadata.dolt_server_user.as_deref() != Some(expected_user.as_str()) {
            return Err(anyhow!(
                "Beads attachment user is {:?}, expected {}",
                metadata.dolt_server_user,
                expected_user
            ));
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
        match env
            .iter()
            .find_map(|(env_key, value)| (env_key == key).then_some(value.clone()))
        {
            Some(value) => Ok(value),
            None => Err(LifecycleError::MissingRequiredEnv {
                key: key.to_string(),
            }
            .into()),
        }
    }

    fn attachment_paths_match(&self, actual_path: &str, expected_path: &Path) -> Result<bool> {
        let actual = fs::canonicalize(actual_path).with_context(|| {
            format!(
                "Failed to canonicalize Beads attachment path reported by `bd where --json`: {actual_path}"
            )
        })?;
        let expected = fs::canonicalize(expected_path).with_context(|| {
            format!(
                "Failed to canonicalize expected Beads attachment path {}",
                expected_path.display()
            )
        })?;
        Ok(actual == expected)
    }

    pub(super) fn command_failure_reason(
        default_message: &str,
        stdout: &str,
        stderr: &str,
    ) -> String {
        let stderr = stderr.trim();
        if !stderr.is_empty() {
            return stderr.to_string();
        }

        let stdout = stdout.trim();
        if !stdout.is_empty() {
            return stdout.to_string();
        }

        default_message.to_string()
    }

    fn database_list_contains(output: &str, expected_database: &str) -> bool {
        output.lines().any(|line| {
            let trimmed = line.trim();
            trimmed == expected_database
                || trimmed
                    .split('|')
                    .map(str::trim)
                    .any(|cell| cell == expected_database)
        })
    }
}

fn attachment_dir_exists(beads_dir: &Path) -> Result<bool> {
    match fs::metadata(beads_dir) {
        Ok(metadata) => Ok(metadata.is_dir()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error).with_context(|| {
            format!(
                "Failed to inspect Beads attachment path {}",
                beads_dir.display()
            )
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::BeadsLifecycle;

    #[test]
    fn database_list_contains_matches_hyphenated_database_names() {
        let output = "+------------------+\n| Database         |\n+------------------+\n| repo-my-feature  |\n+------------------+";

        assert!(BeadsLifecycle::database_list_contains(
            output,
            "repo-my-feature"
        ));
    }
}
