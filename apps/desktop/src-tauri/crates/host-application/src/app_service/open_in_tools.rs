use anyhow::{anyhow, Result};
use host_domain::{SystemOpenInToolId, SystemOpenInToolInfo};
use host_infra_system::{
    discover_open_in_tools, open_directory_in_tool as open_directory_in_tool_with_system,
};
use std::path::Path;
use std::time::{Duration, Instant};

use super::service_core::CachedOpenInToolList;
use super::AppService;

const OPEN_IN_TOOL_CACHE_TTL: Duration = Duration::from_secs(5 * 60);

impl AppService {
    fn cached_open_in_tools(&self) -> Result<Option<Vec<SystemOpenInToolInfo>>> {
        let mut cache = self
            .open_in_tool_cache
            .lock()
            .map_err(|_| anyhow!("Open In tool cache lock poisoned in `cached_open_in_tools`"))?;
        if let Some(entry) = cache.as_ref() {
            if entry.checked_at.elapsed() <= OPEN_IN_TOOL_CACHE_TTL {
                return Ok(Some(entry.tools.clone()));
            }
        }
        *cache = None;
        Ok(None)
    }

    fn update_open_in_tool_cache(&self, tools: Vec<SystemOpenInToolInfo>) -> Result<()> {
        let mut cache = self.open_in_tool_cache.lock().map_err(|_| {
            anyhow!("Open In tool cache lock poisoned in `update_open_in_tool_cache`")
        })?;
        *cache = Some(CachedOpenInToolList {
            checked_at: Instant::now(),
            tools,
        });
        Ok(())
    }

    fn clear_open_in_tool_cache(&self) -> Result<()> {
        let mut cache = self.open_in_tool_cache.lock().map_err(|_| {
            anyhow!("Open In tool cache lock poisoned in `clear_open_in_tool_cache`")
        })?;
        *cache = None;
        Ok(())
    }

    pub(super) fn list_open_in_tools_with_discovery<F>(
        &self,
        force_refresh: bool,
        discover: F,
    ) -> Result<Vec<SystemOpenInToolInfo>>
    where
        F: FnOnce() -> Result<Vec<SystemOpenInToolInfo>>,
    {
        if force_refresh {
            self.clear_open_in_tool_cache()?;
        } else if let Some(cached) = self.cached_open_in_tools()? {
            return Ok(cached);
        }

        let tools = discover()?;
        self.update_open_in_tool_cache(tools.clone())?;
        Ok(tools)
    }

    pub fn list_open_in_tools(&self, force_refresh: bool) -> Result<Vec<SystemOpenInToolInfo>> {
        self.list_open_in_tools_with_discovery(force_refresh, discover_open_in_tools)
    }

    pub fn open_directory_in_tool(
        &self,
        directory_path: &str,
        tool_id: SystemOpenInToolId,
    ) -> Result<()> {
        self.open_directory_in_tool_with_launcher(
            directory_path,
            tool_id,
            open_directory_in_tool_with_system,
        )
    }

    pub(super) fn open_directory_in_tool_with_launcher<F>(
        &self,
        directory_path: &str,
        tool_id: SystemOpenInToolId,
        launcher: F,
    ) -> Result<()>
    where
        F: FnOnce(&Path, SystemOpenInToolId) -> Result<()>,
    {
        if directory_path.trim().is_empty() {
            return Err(anyhow!("Cannot open an empty directory path."));
        }

        let directory = Path::new(directory_path);
        if !directory.exists() {
            return Err(anyhow!("Directory does not exist: {directory_path}"));
        }
        if !directory.is_dir() {
            return Err(anyhow!("Path is not a directory: {directory_path}"));
        }

        launcher(directory, tool_id)
    }
}

#[cfg(test)]
mod tests {
    use super::super::service_core::CachedOpenInToolList;
    use super::super::test_support::{build_service_with_state, unique_temp_path};
    use super::*;
    use std::cell::Cell;
    use std::fs;
    use std::time::{Duration, Instant};

    fn open_in_tool(tool_id: SystemOpenInToolId) -> SystemOpenInToolInfo {
        SystemOpenInToolInfo {
            tool_id,
            icon_data_url: None,
        }
    }

    #[test]
    fn list_open_in_tools_returns_fresh_cached_tools_without_discovery() {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let cached_tools = vec![open_in_tool(SystemOpenInToolId::Finder)];
        {
            let mut cache = service
                .open_in_tool_cache
                .lock()
                .expect("open-in cache lock poisoned");
            *cache = Some(CachedOpenInToolList {
                checked_at: Instant::now(),
                tools: cached_tools.clone(),
            });
        }

        let discovery_called = Cell::new(false);
        let tools = service
            .list_open_in_tools_with_discovery(false, || {
                discovery_called.set(true);
                Ok(vec![open_in_tool(SystemOpenInToolId::Terminal)])
            })
            .expect("fresh cache should be returned");

        assert_eq!(tools, cached_tools);
        assert!(!discovery_called.get(), "discovery should be skipped");
    }

    #[test]
    fn list_open_in_tools_force_refresh_bypasses_cache() {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        {
            let mut cache = service
                .open_in_tool_cache
                .lock()
                .expect("open-in cache lock poisoned");
            *cache = Some(CachedOpenInToolList {
                checked_at: Instant::now(),
                tools: vec![open_in_tool(SystemOpenInToolId::Finder)],
            });
        }

        let discovered_tools = vec![open_in_tool(SystemOpenInToolId::Terminal)];
        let tools = service
            .list_open_in_tools_with_discovery(true, || Ok(discovered_tools.clone()))
            .expect("forced refresh should return discovered tools");

        assert_eq!(tools, discovered_tools);
    }

    #[test]
    fn list_open_in_tools_refreshes_stale_cache() {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        {
            let mut cache = service
                .open_in_tool_cache
                .lock()
                .expect("open-in cache lock poisoned");
            *cache = Some(CachedOpenInToolList {
                checked_at: Instant::now() - (OPEN_IN_TOOL_CACHE_TTL + Duration::from_secs(1)),
                tools: vec![open_in_tool(SystemOpenInToolId::Finder)],
            });
        }

        let discovered_tools = vec![open_in_tool(SystemOpenInToolId::Ghostty)];
        let tools = service
            .list_open_in_tools_with_discovery(false, || Ok(discovered_tools.clone()))
            .expect("stale cache should refresh");

        assert_eq!(tools, discovered_tools);
    }

    #[test]
    fn open_directory_in_tool_rejects_empty_path() {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);

        let error = service
            .open_directory_in_tool_with_launcher("   ", SystemOpenInToolId::Finder, |_, _| Ok(()))
            .expect_err("empty directory should be rejected");

        assert_eq!(error.to_string(), "Cannot open an empty directory path.");
    }

    #[test]
    fn open_directory_in_tool_rejects_missing_path() {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let missing_path = unique_temp_path("open-in-missing-directory");
        let missing_path_text = missing_path.to_string_lossy().to_string();

        let error = service
            .open_directory_in_tool_with_launcher(
                missing_path_text.as_str(),
                SystemOpenInToolId::Finder,
                |_, _| Ok(()),
            )
            .expect_err("missing directory should be rejected");

        assert_eq!(
            error.to_string(),
            format!("Directory does not exist: {missing_path_text}")
        );
    }

    #[test]
    fn open_directory_in_tool_rejects_file_path() {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let root = unique_temp_path("open-in-file-path");
        fs::create_dir_all(&root).expect("test root should exist");
        let file_path = root.join("README.md");
        fs::write(&file_path, "not a directory").expect("file should exist");
        let file_path_text = file_path.to_string_lossy().to_string();

        let error = service
            .open_directory_in_tool_with_launcher(
                file_path_text.as_str(),
                SystemOpenInToolId::Finder,
                |_, _| Ok(()),
            )
            .expect_err("file path should be rejected");

        assert_eq!(
            error.to_string(),
            format!("Path is not a directory: {file_path_text}")
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn open_directory_in_tool_launches_existing_directory() {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let directory = unique_temp_path("open-in-existing-directory");
        fs::create_dir_all(&directory).expect("directory should exist");
        let directory_text = directory.to_string_lossy().to_string();
        let launched = Cell::new(false);

        service
            .open_directory_in_tool_with_launcher(
                directory_text.as_str(),
                SystemOpenInToolId::Finder,
                |path, tool_id| {
                    launched.set(true);
                    assert_eq!(path, directory.as_path());
                    assert_eq!(tool_id, SystemOpenInToolId::Finder);
                    Ok(())
                },
            )
            .expect("existing directory should launch");

        assert!(launched.get(), "launcher should be called");

        let _ = fs::remove_dir_all(directory);
    }
}
