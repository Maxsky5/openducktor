use super::super::super::{
    terminate_child_process, AgentRuntimeProcess, AppService, RuntimeCleanupTarget,
};
use anyhow::{anyhow, Result};
use std::process::Child;

impl AppService {
    pub(crate) fn append_runtime_cleanup_error(
        base_error: anyhow::Error,
        cleanup_error: anyhow::Error,
    ) -> anyhow::Error {
        anyhow!("{base_error}\nAlso failed to clean up runtime startup state: {cleanup_error}")
    }

    pub(super) fn cleanup_runtime_worktree_if_needed(
        cleanup_target: Option<&RuntimeCleanupTarget>,
    ) -> Result<()> {
        let _ = cleanup_target;
        Ok(())
    }

    pub(in crate::app_service::runtime_orchestrator) fn cleanup_started_runtime(
        child: Option<&mut Child>,
        cleanup_target: Option<&RuntimeCleanupTarget>,
    ) -> Result<()> {
        if let Some(child) = child {
            terminate_child_process(child);
        }
        Self::cleanup_runtime_worktree_if_needed(cleanup_target)
    }

    pub(super) fn cleanup_runtime_process(runtime: &mut AgentRuntimeProcess) -> Result<()> {
        if let Some(child) = runtime.child.as_mut() {
            terminate_child_process(child);
        }
        Self::cleanup_runtime_worktree_if_needed(runtime.cleanup_target.as_ref())
    }

    pub(crate) fn cleanup_failed_host_managed_start(
        child: Option<&mut Child>,
        cleanup_target: Option<&RuntimeCleanupTarget>,
    ) -> Result<()> {
        Self::cleanup_started_runtime(child, cleanup_target)
    }
}

#[cfg(test)]
mod tests {
    use super::AppService;
    use anyhow::anyhow;

    #[test]
    fn append_runtime_cleanup_error_uses_generic_startup_cleanup_message() {
        let error = AppService::append_runtime_cleanup_error(
            anyhow!("primary failure"),
            anyhow!("cleanup failure"),
        );

        assert_eq!(
            error.to_string(),
            "primary failure\nAlso failed to clean up runtime startup state: cleanup failure"
        );
    }
}
