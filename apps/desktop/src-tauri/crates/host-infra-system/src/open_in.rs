use anyhow::{anyhow, Result};
use host_domain::{SystemOpenInToolId, SystemOpenInToolInfo};
use std::path::Path;

#[cfg(target_os = "macos")]
use crate::{resolve_command_path, run_command_allow_failure};
#[cfg(target_os = "macos")]
use anyhow::Context;
#[cfg(target_os = "macos")]
use base64::{engine::general_purpose, Engine as _};
#[cfg(target_os = "macos")]
use std::env;
#[cfg(target_os = "macos")]
use std::fs;
#[cfg(target_os = "macos")]
use std::path::PathBuf;
#[cfg(target_os = "macos")]
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(target_os = "macos")]
#[derive(Clone, Copy)]
struct OpenInToolMetadata {
    id: SystemOpenInToolId,
    label: &'static str,
    app_names: &'static [&'static str],
    launch_strategy: OpenInLaunchStrategy,
    cli_command: Option<&'static str>,
    cli_new_window_arg: Option<&'static str>,
}

#[cfg(target_os = "macos")]
#[derive(Clone)]
struct OpenInLaunchSpec {
    program: String,
    args: Vec<String>,
}

#[cfg(target_os = "macos")]
#[derive(Clone, Copy)]
enum OpenInLaunchStrategy {
    OpenDirectory,
    Editor,
    Jetbrains,
}

#[cfg(target_os = "macos")]
const OPEN_IN_TOOL_CATALOG: [OpenInToolMetadata; 14] = [
    OpenInToolMetadata {
        id: SystemOpenInToolId::Finder,
        label: "Finder",
        app_names: &["Finder"],
        launch_strategy: OpenInLaunchStrategy::OpenDirectory,
        cli_command: None,
        cli_new_window_arg: None,
    },
    OpenInToolMetadata {
        id: SystemOpenInToolId::Terminal,
        label: "Terminal",
        app_names: &["Terminal"],
        launch_strategy: OpenInLaunchStrategy::OpenDirectory,
        cli_command: None,
        cli_new_window_arg: None,
    },
    OpenInToolMetadata {
        id: SystemOpenInToolId::Iterm2,
        label: "iTerm2",
        app_names: &["iTerm2", "iTerm"],
        launch_strategy: OpenInLaunchStrategy::OpenDirectory,
        cli_command: None,
        cli_new_window_arg: None,
    },
    OpenInToolMetadata {
        id: SystemOpenInToolId::Ghostty,
        label: "Ghostty",
        app_names: &["Ghostty"],
        launch_strategy: OpenInLaunchStrategy::OpenDirectory,
        cli_command: None,
        cli_new_window_arg: None,
    },
    OpenInToolMetadata {
        id: SystemOpenInToolId::Vscode,
        label: "VS Code",
        app_names: &["Visual Studio Code"],
        launch_strategy: OpenInLaunchStrategy::Editor,
        cli_command: Some("code"),
        cli_new_window_arg: Some("-n"),
    },
    OpenInToolMetadata {
        id: SystemOpenInToolId::Cursor,
        label: "Cursor",
        app_names: &["Cursor"],
        launch_strategy: OpenInLaunchStrategy::Editor,
        cli_command: Some("cursor"),
        cli_new_window_arg: Some("-n"),
    },
    OpenInToolMetadata {
        id: SystemOpenInToolId::Zed,
        label: "Zed",
        app_names: &["Zed"],
        launch_strategy: OpenInLaunchStrategy::Editor,
        cli_command: Some("zed"),
        cli_new_window_arg: None,
    },
    OpenInToolMetadata {
        id: SystemOpenInToolId::IntellijIdea,
        label: "IntelliJ IDEA",
        app_names: &["IntelliJ IDEA", "IntelliJ IDEA CE"],
        launch_strategy: OpenInLaunchStrategy::Jetbrains,
        cli_command: None,
        cli_new_window_arg: None,
    },
    OpenInToolMetadata {
        id: SystemOpenInToolId::Webstorm,
        label: "WebStorm",
        app_names: &["WebStorm"],
        launch_strategy: OpenInLaunchStrategy::Jetbrains,
        cli_command: None,
        cli_new_window_arg: None,
    },
    OpenInToolMetadata {
        id: SystemOpenInToolId::Pycharm,
        label: "PyCharm",
        app_names: &["PyCharm", "PyCharm CE"],
        launch_strategy: OpenInLaunchStrategy::Jetbrains,
        cli_command: None,
        cli_new_window_arg: None,
    },
    OpenInToolMetadata {
        id: SystemOpenInToolId::Phpstorm,
        label: "PhpStorm",
        app_names: &["PhpStorm"],
        launch_strategy: OpenInLaunchStrategy::Jetbrains,
        cli_command: None,
        cli_new_window_arg: None,
    },
    OpenInToolMetadata {
        id: SystemOpenInToolId::Rider,
        label: "Rider",
        app_names: &["Rider"],
        launch_strategy: OpenInLaunchStrategy::Jetbrains,
        cli_command: None,
        cli_new_window_arg: None,
    },
    OpenInToolMetadata {
        id: SystemOpenInToolId::Rustrover,
        label: "RustRover",
        app_names: &["RustRover"],
        launch_strategy: OpenInLaunchStrategy::Jetbrains,
        cli_command: None,
        cli_new_window_arg: None,
    },
    OpenInToolMetadata {
        id: SystemOpenInToolId::AndroidStudio,
        label: "Android Studio",
        app_names: &["Android Studio"],
        launch_strategy: OpenInLaunchStrategy::Jetbrains,
        cli_command: None,
        cli_new_window_arg: None,
    },
];

#[cfg(target_os = "macos")]
fn open_in_tool_metadata(tool_id: SystemOpenInToolId) -> Result<&'static OpenInToolMetadata> {
    OPEN_IN_TOOL_CATALOG
        .iter()
        .find(|metadata| metadata.id == tool_id)
        .ok_or_else(|| anyhow!("Unsupported Open In tool: {tool_id:?}"))
}

#[cfg(target_os = "macos")]
fn process_output_message(stdout: &str, stderr: &str) -> String {
    let trimmed_stdout = stdout.trim();
    let trimmed_stderr = stderr.trim();

    if trimmed_stdout.is_empty() {
        return trimmed_stderr.to_string();
    }
    if trimmed_stderr.is_empty() {
        return trimmed_stdout.to_string();
    }

    format!("{trimmed_stdout}\n{trimmed_stderr}")
}

#[cfg(target_os = "macos")]
enum TempCleanupKind {
    File,
    Directory,
}

#[cfg(target_os = "macos")]
struct TempPathCleanup {
    path: PathBuf,
    kind: TempCleanupKind,
}

#[cfg(target_os = "macos")]
impl TempPathCleanup {
    fn file(path: PathBuf) -> Self {
        Self {
            path,
            kind: TempCleanupKind::File,
        }
    }

    fn directory(path: PathBuf) -> Self {
        Self {
            path,
            kind: TempCleanupKind::Directory,
        }
    }
}

#[cfg(target_os = "macos")]
impl Drop for TempPathCleanup {
    fn drop(&mut self) {
        match self.kind {
            TempCleanupKind::File => {
                let _ = fs::remove_file(&self.path);
            }
            TempCleanupKind::Directory => {
                let _ = fs::remove_dir_all(&self.path);
            }
        }
    }
}

#[cfg(target_os = "macos")]
fn bundle_name_for_app(app_name: &str) -> String {
    if app_name.ends_with(".app") {
        app_name.to_string()
    } else {
        format!("{app_name}.app")
    }
}

#[cfg(target_os = "macos")]
fn resolve_application_path_by_name(app_name: &str) -> Option<PathBuf> {
    let bundle_name = bundle_name_for_app(app_name);
    let candidates = [
        format!("/Applications/{bundle_name}"),
        format!("/System/Applications/{bundle_name}"),
        format!("/System/Applications/Utilities/{bundle_name}"),
        format!("/System/Library/CoreServices/{bundle_name}"),
    ];

    for candidate in candidates {
        let path = PathBuf::from(&candidate);
        if path.exists() {
            return Some(path);
        }
    }

    if let Some(home) = dirs::home_dir() {
        let user_app_path = home.join("Applications").join(&bundle_name);
        if user_app_path.exists() {
            return Some(user_app_path);
        }
    }

    if let Ok((true, stdout, _stderr)) =
        run_command_allow_failure("mdfind", &["-name", &bundle_name], None)
    {
        for line in stdout.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }

            let path = PathBuf::from(trimmed);
            if path.is_dir()
                && path
                    .extension()
                    .and_then(|value| value.to_str())
                    .is_some_and(|value| value.eq_ignore_ascii_case("app"))
            {
                return Some(path);
            }
        }
    }

    None
}

#[cfg(target_os = "macos")]
fn resolve_application_path(metadata: &OpenInToolMetadata) -> Result<Option<PathBuf>> {
    for app_name in metadata.app_names {
        if let Some(app_path) = resolve_application_path_by_name(app_name) {
            return Ok(Some(app_path));
        }
    }

    Ok(None)
}

#[cfg(target_os = "macos")]
fn read_bundle_icon_file(app_path: &Path) -> Option<String> {
    let plist_path = app_path.join("Contents").join("Info.plist");
    if !plist_path.exists() {
        return None;
    }

    let plist_path_string = plist_path.to_string_lossy().to_string();
    let (ok, stdout, _stderr) = run_command_allow_failure(
        "defaults",
        &["read", plist_path_string.as_str(), "CFBundleIconFile"],
        None,
    )
    .ok()?;
    if !ok {
        return None;
    }

    let icon_name = stdout.trim();
    if icon_name.is_empty() {
        return None;
    }

    Some(if icon_name.ends_with(".icns") {
        icon_name.to_string()
    } else {
        format!("{icon_name}.icns")
    })
}

#[cfg(target_os = "macos")]
fn resolve_app_icon_path(app_path: &Path) -> Option<PathBuf> {
    if !app_path.exists() {
        return None;
    }

    if let Some(icon_file) = read_bundle_icon_file(app_path) {
        let icon_path = app_path.join("Contents").join("Resources").join(&icon_file);
        if icon_path.exists() {
            return Some(icon_path);
        }
    }

    let app_path_string = app_path.to_string_lossy().to_string();
    if let Ok((true, stdout, _stderr)) = run_command_allow_failure(
        "mdls",
        &["-name", "kMDItemIconFile", "-raw", app_path_string.as_str()],
        None,
    ) {
        let icon_name = stdout.trim();
        if !icon_name.is_empty() && icon_name != "(null)" {
            let icon_file = if icon_name.ends_with(".icns") {
                icon_name.to_string()
            } else {
                format!("{icon_name}.icns")
            };
            let icon_path = app_path.join("Contents").join("Resources").join(icon_file);
            if icon_path.exists() {
                return Some(icon_path);
            }
        }
    }

    let resources_path = app_path.join("Contents").join("Resources");
    if let Ok(entries) = fs::read_dir(resources_path) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Some(ext) = path.extension().and_then(|value| value.to_str()) {
                if ext.eq_ignore_ascii_case("icns") {
                    return Some(path);
                }
            }
        }
    }

    None
}

#[cfg(target_os = "macos")]
fn sanitized_temp_name(app_name: &str) -> String {
    let sanitized: String = app_name
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character
            } else {
                '_'
            }
        })
        .collect();

    if sanitized.is_empty() {
        "app".to_string()
    } else {
        sanitized
    }
}

#[cfg(target_os = "macos")]
fn temp_icon_output_path(app_name: &str, extension: &str) -> PathBuf {
    let sanitized = sanitized_temp_name(app_name);
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or(0);
    env::temp_dir().join(format!(
        "openducktor-open-in-icon-{sanitized}-{timestamp}.{extension}"
    ))
}

#[cfg(target_os = "macos")]
const MAX_OPEN_IN_ICON_DIMENSION: u32 = 256;

#[cfg(target_os = "macos")]
fn iconset_representation_score(icon_name: &str) -> Option<u32> {
    let stem = icon_name.strip_suffix(".png")?;
    let stem = stem.strip_prefix("icon_")?;
    let (dimensions, scale_suffix) = match stem.split_once('@') {
        Some((value, suffix)) => (value, Some(suffix)),
        None => (stem, None),
    };
    let (width, height) = dimensions.split_once('x')?;
    let width = width.parse::<u32>().ok()?;
    let height = height.parse::<u32>().ok()?;
    let scale = match scale_suffix {
        Some(suffix) => suffix.strip_suffix('x')?.parse::<u32>().ok()?,
        None => 1,
    };

    let effective_width = width * scale;
    let effective_height = height * scale;

    if effective_width > MAX_OPEN_IN_ICON_DIMENSION || effective_height > MAX_OPEN_IN_ICON_DIMENSION
    {
        return None;
    }

    Some(effective_width * effective_height)
}

#[cfg(target_os = "macos")]
fn resolve_best_iconset_representation(iconset_dir: &Path) -> Option<PathBuf> {
    let mut best_match: Option<(u32, PathBuf)> = None;

    for entry in fs::read_dir(iconset_dir).ok()? {
        let Ok(entry) = entry else {
            continue;
        };
        let path = entry.path();
        let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        let Some(score) = iconset_representation_score(file_name) else {
            continue;
        };

        match &best_match {
            Some((best_score, _)) if *best_score >= score => {}
            _ => {
                best_match = Some((score, path));
            }
        }
    }

    best_match.map(|(_, path)| path)
}

#[cfg(target_os = "macos")]
fn extract_best_png_from_iconset(icon_path: &Path, app_name: &str) -> Option<Vec<u8>> {
    let iconset_dir = temp_icon_output_path(app_name, "iconset");
    let _iconset_cleanup = TempPathCleanup::directory(iconset_dir.clone());
    let icon_path_string = icon_path.to_string_lossy().to_string();
    let iconset_dir_string = iconset_dir.to_string_lossy().to_string();
    let (ok, _stdout, _stderr) = run_command_allow_failure(
        "iconutil",
        &[
            "-c",
            "iconset",
            icon_path_string.as_str(),
            "-o",
            iconset_dir_string.as_str(),
        ],
        None,
    )
    .ok()?;
    if !ok {
        return None;
    }

    let best_icon_path = resolve_best_iconset_representation(&iconset_dir);
    let bytes = best_icon_path.and_then(|path| fs::read(path).ok());
    bytes.filter(|value| !value.is_empty())
}

#[cfg(target_os = "macos")]
fn convert_icon_to_png(icon_path: &Path, app_name: &str) -> Option<Vec<u8>> {
    let icon_path_string = icon_path.to_string_lossy().to_string();
    let temp_path = temp_icon_output_path(app_name, "png");
    let _temp_file_cleanup = TempPathCleanup::file(temp_path.clone());
    let temp_path_string = temp_path.to_string_lossy().to_string();
    let (ok, _stdout, _stderr) = run_command_allow_failure(
        "sips",
        &[
            "-s",
            "format",
            "png",
            "-Z",
            "256",
            icon_path_string.as_str(),
            "--out",
            temp_path_string.as_str(),
        ],
        None,
    )
    .ok()?;

    if !ok {
        return None;
    }

    let bytes = fs::read(&temp_path).ok();
    bytes.filter(|value| !value.is_empty())
}

#[cfg(target_os = "macos")]
fn icon_to_data_url(icon_path: &Path, app_name: &str) -> Option<String> {
    if !icon_path.exists() {
        return None;
    }

    let bytes = extract_best_png_from_iconset(icon_path, app_name)
        .or_else(|| convert_icon_to_png(icon_path, app_name))?;
    if bytes.is_empty() {
        return None;
    }

    let encoded = general_purpose::STANDARD.encode(bytes);
    Some(format!("data:image/png;base64,{encoded}"))
}

#[cfg(target_os = "macos")]
fn build_tool_info(metadata: &OpenInToolMetadata, app_path: &Path) -> SystemOpenInToolInfo {
    let icon_data_url = resolve_app_icon_path(app_path)
        .and_then(|icon_path| icon_to_data_url(&icon_path, metadata.label));

    SystemOpenInToolInfo {
        tool_id: metadata.id,
        icon_data_url,
    }
}

#[cfg(target_os = "macos")]
fn discover_open_in_tools_with_resolver<F>(mut resolver: F) -> Result<Vec<SystemOpenInToolInfo>>
where
    F: FnMut(&OpenInToolMetadata) -> Result<Option<PathBuf>>,
{
    let mut tools = Vec::new();

    for metadata in OPEN_IN_TOOL_CATALOG {
        if let Some(app_path) = resolver(&metadata)? {
            tools.push(build_tool_info(&metadata, &app_path));
        }
    }

    Ok(tools)
}

pub fn discover_open_in_tools() -> Result<Vec<SystemOpenInToolInfo>> {
    #[cfg(target_os = "macos")]
    {
        discover_open_in_tools_with_resolver(resolve_application_path)
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err(anyhow!(
            "Open In tool discovery is only supported on macOS."
        ))
    }
}

#[cfg(target_os = "macos")]
fn build_open_app_spec(
    app_path: &Path,
    directory_path: &Path,
    new_instance: bool,
) -> OpenInLaunchSpec {
    let mut args = Vec::new();
    if new_instance {
        args.push("-n".to_string());
    }
    args.push("-a".to_string());
    args.push(app_path.to_string_lossy().to_string());
    args.push(directory_path.to_string_lossy().to_string());
    OpenInLaunchSpec {
        program: "open".to_string(),
        args,
    }
}

#[cfg(target_os = "macos")]
fn build_cli_spec(
    command_path: &str,
    directory_path: &Path,
    new_window_arg: Option<&str>,
) -> OpenInLaunchSpec {
    let mut args = Vec::new();
    if let Some(flag) = new_window_arg {
        args.push(flag.to_string());
    }

    args.push(directory_path.to_string_lossy().to_string());

    OpenInLaunchSpec {
        program: command_path.to_string(),
        args,
    }
}

#[cfg(target_os = "macos")]
fn build_jetbrains_open_spec(app_path: &Path, directory_path: &Path) -> OpenInLaunchSpec {
    OpenInLaunchSpec {
        program: "open".to_string(),
        args: vec![
            "-na".to_string(),
            app_path.to_string_lossy().to_string(),
            "--args".to_string(),
            directory_path.to_string_lossy().to_string(),
        ],
    }
}

#[cfg(target_os = "macos")]
fn build_open_directory_launch_specs(
    metadata: &OpenInToolMetadata,
    app_path: &Path,
    directory_path: &Path,
) -> Vec<OpenInLaunchSpec> {
    let mut specs = Vec::new();

    match metadata.launch_strategy {
        OpenInLaunchStrategy::OpenDirectory => {
            specs.push(build_open_app_spec(app_path, directory_path, false));
        }
        OpenInLaunchStrategy::Editor => {
            if let Some(cli_path) = metadata
                .cli_command
                .and_then(|command| resolve_command_path(command).ok().flatten())
            {
                specs.push(build_cli_spec(
                    &cli_path,
                    directory_path,
                    metadata.cli_new_window_arg,
                ));
            }
            specs.push(build_open_app_spec(app_path, directory_path, false));
        }
        OpenInLaunchStrategy::Jetbrains => {
            specs.push(build_jetbrains_open_spec(app_path, directory_path));
            specs.push(build_open_app_spec(app_path, directory_path, true));
            specs.push(build_open_app_spec(app_path, directory_path, false));
        }
    }

    specs
}

#[cfg(target_os = "macos")]
fn execute_launch_specs(
    metadata: &OpenInToolMetadata,
    directory_path: &Path,
    specs: &[OpenInLaunchSpec],
) -> Result<()> {
    let mut failures = Vec::new();

    for spec in specs {
        let arg_refs = spec.args.iter().map(String::as_str).collect::<Vec<_>>();
        let (ok, stdout, stderr) =
            run_command_allow_failure(spec.program.as_str(), &arg_refs, None).with_context(
                || {
                    format!(
                        "Failed launching {} for {}",
                        metadata.label,
                        directory_path.display()
                    )
                },
            )?;

        if ok {
            return Ok(());
        }

        let failure_detail = process_output_message(stdout.as_str(), stderr.as_str());
        failures.push(if failure_detail.is_empty() {
            format!(
                "{} {} failed without additional details",
                spec.program,
                spec.args.join(" ")
            )
        } else {
            format!(
                "{} {} failed: {failure_detail}",
                spec.program,
                spec.args.join(" ")
            )
        });
    }

    Err(anyhow!(
        "Failed to open {} in {}: {}",
        directory_path.display(),
        metadata.label,
        failures.join("; ")
    ))
}

pub fn open_directory_in_tool(directory_path: &Path, tool_id: SystemOpenInToolId) -> Result<()> {
    #[cfg(target_os = "macos")]
    {
        let metadata = open_in_tool_metadata(tool_id)?;
        let app_path = resolve_application_path(metadata)?.ok_or_else(|| {
            anyhow!(
                "{} is not installed or is no longer discoverable on this Mac.",
                metadata.label
            )
        })?;
        let specs = build_open_directory_launch_specs(metadata, &app_path, directory_path);
        execute_launch_specs(metadata, directory_path, &specs)
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = directory_path;
        let _ = tool_id;
        Err(anyhow!(
            "Opening directories in external tools is only supported on macOS."
        ))
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::{
        build_cli_spec, build_jetbrains_open_spec, build_open_app_spec,
        build_open_directory_launch_specs, discover_open_in_tools_with_resolver,
        iconset_representation_score, open_in_tool_metadata, OPEN_IN_TOOL_CATALOG,
    };
    use host_domain::SystemOpenInToolId;
    use std::collections::HashSet;
    use std::path::{Path, PathBuf};

    #[test]
    fn discover_open_in_tools_preserves_catalog_order_and_filters_missing_apps() {
        let available = HashSet::from([
            SystemOpenInToolId::Finder,
            SystemOpenInToolId::Terminal,
            SystemOpenInToolId::Ghostty,
            SystemOpenInToolId::Zed,
        ]);

        let discovered = discover_open_in_tools_with_resolver(|metadata| {
            Ok(available
                .contains(&metadata.id)
                .then(|| PathBuf::from("/Applications/Test.app")))
        })
        .expect("tool discovery should succeed");

        assert_eq!(
            discovered
                .iter()
                .map(|tool| tool.tool_id)
                .collect::<Vec<_>>(),
            vec![
                SystemOpenInToolId::Finder,
                SystemOpenInToolId::Terminal,
                SystemOpenInToolId::Ghostty,
                SystemOpenInToolId::Zed,
            ]
        );
        assert_eq!(OPEN_IN_TOOL_CATALOG[0].id, SystemOpenInToolId::Finder);
    }

    #[test]
    fn build_open_app_spec_preserves_paths_with_spaces() {
        let spec = build_open_app_spec(
            Path::new("/Applications/Visual Studio Code.app"),
            Path::new("/tmp/worktrees/task 24"),
            false,
        );

        assert_eq!(spec.program, "open");
        assert_eq!(
            spec.args,
            vec![
                "-a".to_string(),
                "/Applications/Visual Studio Code.app".to_string(),
                "/tmp/worktrees/task 24".to_string(),
            ]
        );
    }

    #[test]
    fn build_open_directory_launch_specs_uses_cli_before_open_fallback_for_editors() {
        let metadata = open_in_tool_metadata(SystemOpenInToolId::Vscode)
            .expect("VS Code metadata should exist");
        let specs = build_open_directory_launch_specs(
            metadata,
            Path::new("/Applications/Visual Studio Code.app"),
            Path::new("/tmp/worktrees/task-24"),
        );

        assert_eq!(
            specs.last().expect("fallback spec should exist").program,
            "open"
        );
    }

    #[test]
    fn build_cli_spec_uses_new_window_flag_when_supported() {
        let spec = build_cli_spec(
            "/usr/local/bin/code",
            Path::new("/tmp/worktrees/task-24"),
            Some("-n"),
        );

        assert_eq!(
            spec.args,
            vec!["-n".to_string(), "/tmp/worktrees/task-24".to_string()]
        );
    }

    #[test]
    fn build_open_directory_launch_specs_skips_new_window_flag_for_zed() {
        let spec = build_cli_spec(
            "/usr/local/bin/zed",
            Path::new("/tmp/worktrees/task-24"),
            None,
        );

        assert_eq!(spec.args, vec!["/tmp/worktrees/task-24".to_string()]);
    }

    #[test]
    fn build_jetbrains_open_spec_uses_args_mode() {
        let spec = build_jetbrains_open_spec(
            Path::new("/Applications/RustRover.app"),
            Path::new("/tmp/worktrees/task 24"),
        );

        assert_eq!(spec.program, "open");
        assert_eq!(
            spec.args,
            vec![
                "-na".to_string(),
                "/Applications/RustRover.app".to_string(),
                "--args".to_string(),
                "/tmp/worktrees/task 24".to_string(),
            ]
        );
    }

    #[test]
    fn build_open_directory_launch_specs_use_open_directory_strategy_for_terminals() {
        let metadata = open_in_tool_metadata(SystemOpenInToolId::Terminal)
            .expect("Terminal metadata should exist");
        let specs = build_open_directory_launch_specs(
            metadata,
            Path::new("/System/Applications/Utilities/Terminal.app"),
            Path::new("/tmp/worktrees/task 24"),
        );

        assert_eq!(specs.len(), 1);
        assert_eq!(specs[0].program, "open");
        assert_eq!(specs[0].args[0], "-a");
    }

    #[test]
    fn iconset_representation_score_prefers_larger_scaled_icons() {
        assert_eq!(iconset_representation_score("icon_16x16.png"), Some(256));
        assert_eq!(
            iconset_representation_score("icon_16x16@2x.png"),
            Some(1024)
        );
        assert_eq!(
            iconset_representation_score("icon_128x128@2x.png"),
            Some(65_536)
        );
        assert_eq!(
            iconset_representation_score("icon_256x256.png"),
            Some(65_536)
        );
        assert_eq!(iconset_representation_score("icon_256x256@2x.png"), None);
        assert_eq!(iconset_representation_score("icon_512x512@2x.png"), None);
        assert_eq!(iconset_representation_score("not-an-icon.png"), None);
    }
}
