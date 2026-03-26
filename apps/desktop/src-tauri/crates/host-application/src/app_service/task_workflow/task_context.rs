use crate::app_service::service_core::AppService;
use anyhow::{anyhow, Result};
use host_domain::TaskCard;
use std::path::Path;

pub(super) struct TaskRepoContext {
    pub(super) repo_path: String,
    pub(super) tasks: Vec<TaskCard>,
}

impl TaskRepoContext {
    pub(super) fn repo_dir(&self) -> &Path {
        Path::new(&self.repo_path)
    }

    pub(super) fn task(&self, task_id: &str) -> Result<&TaskCard> {
        self.tasks
            .iter()
            .find(|task| task.id == task_id)
            .ok_or_else(|| anyhow!("Task not found: {task_id}"))
    }

    pub(super) fn cloned_task(&self, task_id: &str) -> Result<TaskCard> {
        self.task(task_id).cloned()
    }
}

pub(super) struct LoadedTaskContext {
    pub(super) repo: TaskRepoContext,
    pub(super) task: TaskCard,
}

impl LoadedTaskContext {
    pub(super) fn repo_dir(&self) -> &Path {
        self.repo.repo_dir()
    }
}

impl AppService {
    pub(super) fn load_task_repo_context_from_resolved(
        &self,
        repo_path: String,
    ) -> Result<TaskRepoContext> {
        let tasks = self.task_store.list_tasks(Path::new(&repo_path))?;
        Ok(TaskRepoContext { repo_path, tasks })
    }

    pub(crate) fn resolve_task_repo_path(&self, repo_path: &str) -> Result<String> {
        self.resolve_initialized_repo_path(repo_path)
    }

    pub(super) fn load_task_repo_context(&self, repo_path: &str) -> Result<TaskRepoContext> {
        let repo_path = self.resolve_task_repo_path(repo_path)?;
        self.load_task_repo_context_from_resolved(repo_path)
    }

    pub(super) fn load_task_repo_context_for_kanban(
        &self,
        repo_path: &str,
        done_visible_days: i32,
    ) -> Result<TaskRepoContext> {
        let repo_path = self.resolve_task_repo_path(repo_path)?;
        let tasks = self
            .task_store
            .list_tasks_for_kanban(Path::new(&repo_path), done_visible_days)?;
        Ok(TaskRepoContext { repo_path, tasks })
    }

    pub(super) fn load_task_context_from_resolved(
        &self,
        repo_path: String,
        task_id: &str,
    ) -> Result<LoadedTaskContext> {
        let repo = self.load_task_repo_context_from_resolved(repo_path)?;
        let task = repo.cloned_task(task_id)?;
        Ok(LoadedTaskContext { repo, task })
    }

    pub(super) fn load_task_context(
        &self,
        repo_path: &str,
        task_id: &str,
    ) -> Result<LoadedTaskContext> {
        let repo_path = self.resolve_task_repo_path(repo_path)?;
        self.load_task_context_from_resolved(repo_path, task_id)
    }
}
