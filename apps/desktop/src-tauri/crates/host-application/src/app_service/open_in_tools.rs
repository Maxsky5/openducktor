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
