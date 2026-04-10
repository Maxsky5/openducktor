use std::path::PathBuf;

use thiserror::Error;

#[derive(Debug, Error)]
pub(crate) enum LifecycleError {
    #[error(
        "Shared Dolt server state is missing for {repo_path}; reinitialize the repo store",
        repo_path = .repo_path.display()
    )]
    SharedDoltStateMissing { repo_path: PathBuf },

    #[error("Missing required Beads lifecycle environment value: {key}")]
    MissingRequiredEnv { key: String },

    #[error("BEADS_DOLT_SERVER_PORT is not a valid port: {value}")]
    InvalidServerPort { value: String },

    #[error(
        "Shared Dolt database is missing for {beads_dir} and no attachment backup exists at {backup_dir}",
        beads_dir = .beads_dir.display(),
        backup_dir = .backup_dir.display()
    )]
    MissingAttachmentBackup {
        beads_dir: PathBuf,
        backup_dir: PathBuf,
    },

    #[error(
        "Failed to initialize Beads at {beads_dir}: {details}",
        beads_dir = .beads_dir.display()
    )]
    InitFailed { beads_dir: PathBuf, details: String },

    #[error(
        "Beads {recovery_step} completed but store is still not ready at {beads_dir}: {reason}",
        beads_dir = .beads_dir.display()
    )]
    StoreStillNotReady {
        beads_dir: PathBuf,
        recovery_step: &'static str,
        reason: String,
    },
}
