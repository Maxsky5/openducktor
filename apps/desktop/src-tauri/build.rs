use std::env;
use std::fs;
use std::path::{Path, PathBuf};

fn copy_sidecar_binary(source: &Path, destination: &Path) -> std::io::Result<()> {
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::copy(source, destination)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        let mut permissions = fs::metadata(destination)?.permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(destination, permissions)?;
    }
    Ok(())
}

fn resolve_bd_source() -> Result<PathBuf, String> {
    if let Some(explicit) = env::var_os("OPENDUCKTOR_BD_BINARY").map(PathBuf::from) {
        return explicit.is_file().then_some(explicit.clone()).ok_or_else(|| {
            format!(
                "OPENDUCKTOR_BD_BINARY points to a missing file: {}",
                explicit.display()
            )
        });
    }

    [
        PathBuf::from("/opt/homebrew/opt/beads/bin/bd"),
        PathBuf::from("/opt/homebrew/bin/bd"),
        PathBuf::from("/usr/local/opt/beads/bin/bd"),
        PathBuf::from("/usr/local/bin/bd"),
    ]
    .into_iter()
    .find(|path| path.is_file())
    .ok_or_else(|| "Unable to locate the Beads CLI binary in the standard install paths.".to_string())
}

fn prepare_bd_sidecar() -> Result<(), String> {
    let manifest_dir = PathBuf::from(
        env::var("CARGO_MANIFEST_DIR").map_err(|error| format!("missing CARGO_MANIFEST_DIR: {error}"))?,
    );
    let target_triple =
        env::var("TARGET").map_err(|error| format!("missing TARGET environment variable: {error}"))?;
    let sidecar_dir = manifest_dir.join("binaries");
    let sidecar_path = sidecar_dir.join(format!("bd-{target_triple}"));
    println!("cargo:rerun-if-env-changed=OPENDUCKTOR_BD_BINARY");

    let source = resolve_bd_source().map_err(|source_error| {
        format!(
            "{source_error} Set OPENDUCKTOR_BD_BINARY or install beads so one of the standard paths exists (expected target sidecar: {}).",
            sidecar_path.display(),
        )
    })?;

    println!("cargo:rerun-if-changed={}", source.display());
    copy_sidecar_binary(&source, &sidecar_path).map_err(|error| {
        format!(
            "Failed to stage Beads sidecar from {} to {}: {error}",
            source.display(),
            sidecar_path.display()
        )
    })
}

fn main() {
    prepare_bd_sidecar().expect("failed to prepare Beads sidecar");
    tauri_build::build()
}
