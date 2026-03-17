use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

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

fn workspace_root(manifest_dir: &Path) -> Result<PathBuf, String> {
    manifest_dir
        .ancestors()
        .nth(3)
        .map(Path::to_path_buf)
        .ok_or_else(|| {
            format!(
                "Unable to resolve workspace root from manifest directory {}",
                manifest_dir.display()
            )
        })
}

fn track_dir_recursive(path: &Path) -> Result<(), String> {
    println!("cargo:rerun-if-changed={}", path.display());
    let entries = fs::read_dir(path)
        .map_err(|error| format!("Failed to read directory {}: {error}", path.display()))?;
    for entry in entries {
        let entry = entry.map_err(|error| {
            format!(
                "Failed to read directory entry under {}: {error}",
                path.display()
            )
        })?;
        let entry_path = entry.path();
        if entry_path.is_dir() {
            track_dir_recursive(&entry_path)?;
        } else {
            println!("cargo:rerun-if-changed={}", entry_path.display());
        }
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

fn prepare_mcp_sidecar(manifest_dir: &Path, target_triple: &str) -> Result<(), String> {
    let workspace_root = workspace_root(manifest_dir)?;
    let package_dir = workspace_root.join("packages").join("openducktor-mcp");
    let entrypoint = package_dir.join("src").join("index.ts");
    let sidecar_path = manifest_dir
        .join("binaries")
        .join(format!("openducktor-mcp-{target_triple}"));

    if !entrypoint.is_file() {
        return Err(format!(
            "Missing MCP entrypoint at {}",
            entrypoint.display()
        ));
    }

    println!("cargo:rerun-if-env-changed=PATH");
    println!("cargo:rerun-if-changed={}", package_dir.join("package.json").display());
    println!("cargo:rerun-if-changed={}", package_dir.join("tsconfig.json").display());
    track_dir_recursive(&package_dir.join("src"))?;

    if let Some(parent) = sidecar_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Failed to create MCP sidecar directory {}: {error}",
                parent.display()
            )
        })?;
    }

    let output = Command::new("bun")
        .current_dir(&workspace_root)
        .arg("build")
        .arg(&entrypoint)
        .arg("--compile")
        .arg("--outfile")
        .arg(&sidecar_path)
        .output()
        .map_err(|error| {
            format!(
                "Failed to spawn bun while compiling MCP sidecar to {}: {error}",
                sidecar_path.display()
            )
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let details = if stderr.is_empty() { stdout } else { stderr };
        return Err(format!(
            "Failed to compile MCP sidecar to {}: {}",
            sidecar_path.display(),
            details
        ));
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        let mut permissions = fs::metadata(&sidecar_path)
            .map_err(|error| {
                format!(
                    "Failed to read MCP sidecar metadata {}: {error}",
                    sidecar_path.display()
                )
            })?
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&sidecar_path, permissions).map_err(|error| {
            format!(
                "Failed to mark MCP sidecar executable at {}: {error}",
                sidecar_path.display()
            )
        })?;
    }

    Ok(())
}

fn main() {
    let manifest_dir = PathBuf::from(
        env::var("CARGO_MANIFEST_DIR").expect("missing CARGO_MANIFEST_DIR"),
    );
    let target_triple = env::var("TARGET").expect("missing TARGET environment variable");

    prepare_bd_sidecar().expect("failed to prepare Beads sidecar");
    prepare_mcp_sidecar(&manifest_dir, &target_triple).expect("failed to prepare MCP sidecar");
    tauri_build::build()
}
