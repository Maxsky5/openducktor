use anyhow::{anyhow, Context, Result};
use host_infra_system::compute_beads_database_name;
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

enum SharedDatabaseProbe {
    Available,
    Missing { database_name: String },
    Unavailable { reason: String },
}

impl BeadsLifecycle {
    pub(crate) fn verify_repo_initialized(
        &self,
        repo_path: &Path,
        beads_dir: &Path,
    ) -> Result<RepoReadiness> {
        if !attachment_dir_exists(beads_dir)? {
            return Ok(RepoReadiness::MissingAttachment);
        }

        let env = self.build_bd_env(repo_path)?;
        if let Err(error) = self.verify_repo_attachment_contract(repo_path, beads_dir, &env) {
            return Ok(RepoReadiness::BrokenAttachmentContract {
                reason: error.to_string(),
            });
        }

        match self.probe_shared_database_presence(repo_path, &env)? {
            SharedDatabaseProbe::Available => {}
            SharedDatabaseProbe::Missing { database_name } => {
                return Ok(RepoReadiness::MissingSharedDatabase { database_name });
            }
            SharedDatabaseProbe::Unavailable { reason } => {
                return Ok(RepoReadiness::SharedDoltUnavailable { reason });
            }
        }

        let env_refs = env
            .iter()
            .map(|(key, value)| (key.as_str(), value.as_str()))
            .collect::<Vec<_>>();
        let working_dir = self.ensure_beads_working_dir(repo_path)?;
        let (ok, stdout, stderr) = self.command_runner().run_allow_failure_with_env(
            "bd",
            &["where", "--json"],
            Some(&working_dir),
            &env_refs,
        )?;

        let json_payload = Self::extract_json_payload(&stdout, &stderr);

        if !json_payload.is_empty() {
            let where_payload: BeadsWherePayload = serde_json::from_str(json_payload)
                .context("Failed to decode `bd where --json` payload")?;
            if let Some(path) = where_payload.path.as_deref() {
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
            if let Some(error) = where_payload.error.as_deref() {
                let reason = error.trim();
                if reason.is_empty() {
                    return Err(anyhow!("bd where returned empty error payload"));
                }
                return Ok(RepoReadiness::AttachmentVerificationFailed {
                    reason: reason.to_string(),
                });
            }

            return Err(anyhow!("bd where returned malformed payload"));
        }

        if !ok {
            return Err(anyhow!("bd where failed without a decodable JSON payload"));
        }

        Err(anyhow!("bd where returned empty payload"))
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

        let object_index = trimmed_stderr.find('{');
        let array_index = trimmed_stderr.find('[');
        let start_index = [object_index, array_index].into_iter().flatten().min();
        if let Some(index) = start_index {
            return &trimmed_stderr[index..];
        }

        ""
    }

    fn probe_shared_database_presence(
        &self,
        repo_path: &Path,
        env: &[(String, String)],
    ) -> Result<SharedDatabaseProbe> {
        let expected_database = compute_beads_database_name(repo_path)?;
        let host = Self::required_env_value(env, "BEADS_DOLT_SERVER_HOST")?;
        let port = Self::required_env_value(env, "BEADS_DOLT_SERVER_PORT")?;
        let user = Self::required_env_value(env, "BEADS_DOLT_SERVER_USER")?;
        let args = [
            "--host",
            host.as_str(),
            "--port",
            port.as_str(),
            "--no-tls",
            "-u",
            user.as_str(),
            "-p",
            "",
            "sql",
            "-q",
            "show databases",
        ];
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

        let expected_database = compute_beads_database_name(repo_path)?;
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
        let actual = fs::canonicalize(actual_path).unwrap_or_else(|_| actual_path.into());
        let expected =
            fs::canonicalize(expected_path).unwrap_or_else(|_| expected_path.to_path_buf());
        Ok(actual == expected)
    }

    fn command_failure_reason(default_message: &str, stdout: &str, stderr: &str) -> String {
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
            line.split(|character: char| {
                character.is_whitespace() || matches!(character, '|' | '+' | '-')
            })
            .any(|token| token == expected_database)
        })
    }
}

fn attachment_dir_exists(beads_dir: &Path) -> Result<bool> {
    match fs::metadata(beads_dir) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error).with_context(|| {
            format!(
                "Failed to inspect Beads attachment path {}",
                beads_dir.display()
            )
        }),
    }
}
