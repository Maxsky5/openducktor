use std::env;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::{Map, Value};

const PREPARE_SIDECARS_ENV: &str = "OPENDUCKTOR_PREPARE_SIDECARS";

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
    fn is_workspace_root_candidate(path: &Path) -> bool {
        path.join("bun.lock").is_file()
            && path.join("package.json").is_file()
            && path.join("apps").is_dir()
            && path.join("packages").is_dir()
    }

    manifest_dir
        .ancestors()
        .find(|candidate| is_workspace_root_candidate(candidate))
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

fn command_file_name(program: &str) -> OsString {
    #[cfg(windows)]
    {
        OsString::from(format!("{program}.exe"))
    }
    #[cfg(not(windows))]
    {
        OsString::from(program)
    }
}

fn staged_sidecar_name(program: &str, target_triple: &str) -> OsString {
    let mut file_name = OsString::from(format!("{program}-{target_triple}"));
    if target_triple.contains("windows") {
        file_name.push(".exe");
    }
    file_name
}

fn path_entries_from_env() -> Vec<PathBuf> {
    env::var_os("PATH")
        .as_ref()
        .map(env::split_paths)
        .into_iter()
        .flatten()
        .collect()
}

fn standard_search_directories() -> Vec<PathBuf> {
    let mut directories = Vec::new();

    #[cfg(target_os = "macos")]
    {
        directories.push(PathBuf::from("/opt/homebrew/bin"));
        directories.push(PathBuf::from("/usr/local/bin"));
    }

    #[cfg(target_os = "linux")]
    {
        directories.push(PathBuf::from("/usr/local/bin"));
        directories.push(PathBuf::from("/usr/bin"));
        directories.push(PathBuf::from("/snap/bin"));
        if let Some(home) = env::var_os("HOME") {
            directories.push(PathBuf::from(home).join(".local").join("bin"));
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
            directories.push(PathBuf::from(local_app_data).join("Programs"));
        }
        if let Some(program_files) = env::var_os("ProgramFiles") {
            directories.push(PathBuf::from(program_files));
        }
        if let Some(program_files_x86) = env::var_os("ProgramFiles(x86)") {
            directories.push(PathBuf::from(program_files_x86));
        }
    }

    directories
}

fn standard_program_directories(program: &str) -> Vec<PathBuf> {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    let mut directories = standard_search_directories();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let directories = standard_search_directories();

    #[cfg(target_os = "macos")]
    {
        directories.push(PathBuf::from(format!("/opt/homebrew/opt/{program}/bin")));
        directories.push(PathBuf::from(format!("/usr/local/opt/{program}/bin")));
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
            directories.push(PathBuf::from(local_app_data).join("Programs").join(program));
        }
        if let Some(program_files) = env::var_os("ProgramFiles") {
            directories.push(PathBuf::from(program_files).join(program));
        }
        if let Some(program_files_x86) = env::var_os("ProgramFiles(x86)") {
            directories.push(PathBuf::from(program_files_x86).join(program));
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let _ = program;

    directories
}

fn resolve_binary_source(program: &str, env_var: &str) -> Result<PathBuf, String> {
    if let Some(explicit) = env::var_os(env_var).map(PathBuf::from) {
        return explicit
            .is_file()
            .then_some(explicit.clone())
            .ok_or_else(|| format!("{env_var} points to a missing file: {}", explicit.display()));
    }

    let file_name = command_file_name(program);
    let candidates = standard_program_directories(program)
        .into_iter()
        .chain(path_entries_from_env())
        .map(|directory| directory.join(&file_name))
        .collect::<Vec<_>>();

    candidates
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| {
            format!(
            "Unable to locate the {program} binary in PATH or the standard install directories."
        )
        })
}

fn prepare_sidecar_binary(
    manifest_dir: &Path,
    target_triple: &str,
    program: &str,
    env_var: &str,
) -> Result<(), String> {
    let sidecar_path = manifest_dir
        .join("binaries")
        .join(staged_sidecar_name(program, target_triple));
    println!("cargo:rerun-if-env-changed={env_var}");

    let source = resolve_binary_source(program, env_var).map_err(|source_error| {
        format!(
            "{source_error} Set {env_var} or install {program} so it is available during packaging (expected target sidecar: {}).",
            sidecar_path.display(),
        )
    })?;

    println!("cargo:rerun-if-changed={}", source.display());
    copy_sidecar_binary(&source, &sidecar_path).map_err(|error| {
        format!(
            "Failed to stage {program} sidecar from {} to {}: {error}",
            source.display(),
            sidecar_path.display()
        )
    })
}

fn prepare_bd_sidecar() -> Result<(), String> {
    let manifest_dir = PathBuf::from(
        env::var("CARGO_MANIFEST_DIR")
            .map_err(|error| format!("missing CARGO_MANIFEST_DIR: {error}"))?,
    );
    let target_triple = env::var("TARGET")
        .map_err(|error| format!("missing TARGET environment variable: {error}"))?;
    prepare_sidecar_binary(&manifest_dir, &target_triple, "bd", "OPENDUCKTOR_BD_BINARY")
}

fn prepare_dolt_sidecar() -> Result<(), String> {
    let manifest_dir = PathBuf::from(
        env::var("CARGO_MANIFEST_DIR")
            .map_err(|error| format!("missing CARGO_MANIFEST_DIR: {error}"))?,
    );
    let target_triple = env::var("TARGET")
        .map_err(|error| format!("missing TARGET environment variable: {error}"))?;
    prepare_sidecar_binary(
        &manifest_dir,
        &target_triple,
        "dolt",
        "OPENDUCKTOR_DOLT_BINARY",
    )
}

fn prepare_mcp_sidecar(manifest_dir: &Path, target_triple: &str) -> Result<(), String> {
    let workspace_root = workspace_root(manifest_dir)?;
    let package_dir = workspace_root.join("packages").join("openducktor-mcp");
    let entrypoint = package_dir.join("src").join("index.ts");
    let sidecar_path = manifest_dir
        .join("binaries")
        .join(staged_sidecar_name("openducktor-mcp", target_triple));

    if !entrypoint.is_file() {
        return Err(format!(
            "Missing MCP entrypoint at {}",
            entrypoint.display()
        ));
    }

    println!("cargo:rerun-if-env-changed=PATH");
    println!(
        "cargo:rerun-if-changed={}",
        workspace_root.join("package.json").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        workspace_root.join("bun.lock").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        package_dir.join("package.json").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        package_dir.join("tsconfig.json").display()
    );
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

fn should_prepare_sidecars() -> bool {
    println!("cargo:rerun-if-env-changed={PREPARE_SIDECARS_ENV}");
    matches!(
        env::var(PREPARE_SIDECARS_ENV)
            .ok()
            .as_deref()
            .map(str::trim)
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("1" | "true")
    )
}

fn sanitize_tauri_config_for_non_packaged_builds() -> Result<(), String> {
    let mut tauri_config = env::var("TAURI_CONFIG")
        .ok()
        .map(|raw| serde_json::from_str::<Value>(&raw))
        .transpose()
        .map_err(|error| format!("invalid TAURI_CONFIG JSON: {error}"))?
        .unwrap_or_else(|| Value::Object(Map::new()));

    let Some(root) = tauri_config.as_object_mut() else {
        return Err("TAURI_CONFIG must be a JSON object".to_string());
    };

    let bundle = root
        .entry("bundle")
        .or_insert_with(|| Value::Object(Map::new()));
    let Some(bundle_object) = bundle.as_object_mut() else {
        return Err("TAURI_CONFIG.bundle must be a JSON object".to_string());
    };

    bundle_object.insert("externalBin".to_string(), Value::Null);
    env::set_var("TAURI_CONFIG", tauri_config.to_string());
    Ok(())
}

fn main() {
    let manifest_dir =
        PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("missing CARGO_MANIFEST_DIR"));
    let target_triple = env::var("TARGET").expect("missing TARGET environment variable");

    // Sidecars are only needed for packaged desktop bundles. Cargo check/clippy/test
    // should compile the Tauri crate without requiring packaged runtime binaries.
    if should_prepare_sidecars() {
        prepare_bd_sidecar().expect("failed to prepare Beads sidecar");
        prepare_dolt_sidecar().expect("failed to prepare Dolt sidecar");
        prepare_mcp_sidecar(&manifest_dir, &target_triple).expect("failed to prepare MCP sidecar");
    } else {
        sanitize_tauri_config_for_non_packaged_builds()
            .expect("failed to sanitize non-packaged Tauri config");
    }
    tauri_build::build()
}
