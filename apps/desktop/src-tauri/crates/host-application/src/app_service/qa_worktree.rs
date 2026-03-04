use super::{run_parsed_hook_command_allow_failure, validate_hook_trust};
use anyhow::{anyhow, Context, Result};
use host_infra_system::{build_branch_name, remove_worktree, run_command, AppConfigStore};
use std::fs;
use std::path::{Component, Path};

#[derive(Debug)]
pub(super) struct QaWorktreeSetup {
    pub(super) repo_path: String,
    pub(super) worktree_path: String,
}

pub(super) fn prepare_qa_worktree(
    repo_path: &str,
    task_id: &str,
    task_title: &str,
    config_store: &AppConfigStore,
) -> Result<QaWorktreeSetup> {
    validate_task_id_for_worktree(task_id)?;

    let repo_config = config_store.repo_config(repo_path)?;
    let worktree_base = repo_config.worktree_base_path.clone().ok_or_else(|| {
        anyhow!(
            "QA blocked: configure repos.{repo_path}.worktreeBasePath in {}",
            config_store.path().display()
        )
    })?;

    validate_hook_trust(repo_path, &repo_config)?;

    let worktree_base_path = Path::new(&worktree_base);
    fs::create_dir_all(worktree_base_path).with_context(|| {
        format!(
            "Failed creating QA worktree base directory {}",
            worktree_base_path.display()
        )
    })?;

    let qa_worktree = worktree_base_path.join(format!("qa-{task_id}"));
    if qa_worktree.exists() {
        return Err(anyhow!(
            "QA worktree path already exists for task {}: {}",
            task_id,
            qa_worktree.display()
        ));
    }

    let repo_path_ref = Path::new(repo_path);
    let branch = build_branch_name(&repo_config.branch_prefix, task_id, task_title);
    let qa_worktree_str = qa_worktree
        .to_str()
        .ok_or_else(|| anyhow!("Invalid QA worktree path"))?;
    let checkout_existing = run_command(
        "git",
        &["worktree", "add", qa_worktree_str, &branch],
        Some(repo_path_ref),
    );
    if let Err(existing_error) = checkout_existing {
        run_command(
            "git",
            &["worktree", "add", qa_worktree_str, "-b", &branch],
            Some(repo_path_ref),
        )
        .with_context(|| {
            format!("Failed to create or checkout QA branch {branch}: {existing_error}")
        })?;
    }

    for hook in &repo_config.hooks.pre_start {
        let (ok, _stdout, stderr) =
            run_parsed_hook_command_allow_failure(hook, qa_worktree.as_path());
        if !ok {
            if let Err(cleanup_error) =
                remove_runtime_worktree(repo_path_ref, qa_worktree.as_path())
            {
                return Err(anyhow!(
                    "QA pre-start hook failed: {hook}\n{stderr}\nAlso failed to remove QA worktree: {cleanup_error}"
                ));
            }
            return Err(anyhow!("QA pre-start hook failed: {hook}\n{stderr}"));
        }
    }

    let qa_worktree_path = qa_worktree_str.to_string();
    Ok(QaWorktreeSetup {
        repo_path: repo_path.to_string(),
        worktree_path: qa_worktree_path,
    })
}

pub(super) fn remove_runtime_worktree(repo_path: &Path, worktree_path: &Path) -> Result<()> {
    remove_worktree(repo_path, worktree_path).with_context(|| {
        format!(
            "Failed removing QA worktree runtime {}",
            worktree_path.display()
        )
    })
}

fn validate_task_id_for_worktree(task_id: &str) -> Result<()> {
    let trimmed = task_id.trim();
    if trimmed.is_empty() {
        return Err(anyhow!("Invalid task id for QA worktree: value is empty"));
    }

    if !trimmed
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        return Err(anyhow!(
            "Invalid task id for QA worktree: only ASCII letters, numbers, '-' and '_' are allowed"
        ));
    }

    // Defense in depth: reject anything that could be interpreted as path traversal.
    let path = Path::new(trimmed);
    if path.is_absolute() {
        return Err(anyhow!(
            "Invalid task id for QA worktree: absolute paths are not allowed"
        ));
    }
    if !matches!(path.components().next(), Some(Component::Normal(_)))
        || path.components().count() != 1
    {
        return Err(anyhow!(
            "Invalid task id for QA worktree: path separators or traversal segments are not allowed"
        ));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{prepare_qa_worktree, remove_runtime_worktree};
    use crate::app_service::test_support::{init_git_repo, unique_temp_path};
    use anyhow::Result;
    use host_infra_system::{hook_set_fingerprint, AppConfigStore, HookSet, RepoConfig};
    use std::fs;
    use std::path::Path;

    fn register_workspace(config_store: &AppConfigStore, repo_path: &str) -> Result<()> {
        config_store.add_workspace(repo_path)?;
        Ok(())
    }

    #[test]
    fn prepare_qa_worktree_returns_setup_for_valid_config() -> Result<()> {
        let root = unique_temp_path("qa-worktree-setup-success");
        let repo = root.join("repo");
        init_git_repo(&repo)?;
        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let repo_path = repo.to_string_lossy().to_string();
        let worktree_base = root.join("qa-worktrees");
        register_workspace(&config_store, repo_path.as_str())?;

        config_store.update_repo_config(
            repo_path.as_str(),
            RepoConfig {
                worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
                branch_prefix: "odt".to_string(),
                default_target_branch: "origin/main".to_string(),
                trusted_hooks: true,
                trusted_hooks_fingerprint: None,
                hooks: HookSet::default(),
                prompt_overrides: Default::default(),
                agent_defaults: Default::default(),
            },
        )?;

        let setup = prepare_qa_worktree(repo_path.as_str(), "task-1", "Task 1", &config_store)?;
        let qa_path = Path::new(setup.worktree_path.as_str());
        assert!(qa_path.exists());
        assert_eq!(setup.repo_path, repo_path);

        remove_runtime_worktree(Path::new(setup.repo_path.as_str()), qa_path)?;
        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn prepare_qa_worktree_requires_worktree_base_path() -> Result<()> {
        let root = unique_temp_path("qa-worktree-missing-base");
        let repo = root.join("repo");
        init_git_repo(&repo)?;
        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let repo_path = repo.to_string_lossy().to_string();
        register_workspace(&config_store, repo_path.as_str())?;

        config_store.update_repo_config(
            repo_path.as_str(),
            RepoConfig {
                worktree_base_path: None,
                branch_prefix: "odt".to_string(),
                default_target_branch: "origin/main".to_string(),
                trusted_hooks: true,
                trusted_hooks_fingerprint: None,
                hooks: HookSet::default(),
                prompt_overrides: Default::default(),
                agent_defaults: Default::default(),
            },
        )?;

        let error = prepare_qa_worktree(repo_path.as_str(), "task-1", "Task 1", &config_store)
            .expect_err("missing worktree base path should fail");
        assert!(error.to_string().contains("QA blocked: configure repos."));

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn prepare_qa_worktree_removes_worktree_when_pre_start_hook_fails() -> Result<()> {
        let root = unique_temp_path("qa-worktree-hook-failure");
        let repo = root.join("repo");
        init_git_repo(&repo)?;
        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let repo_path = repo.to_string_lossy().to_string();
        let worktree_base = root.join("qa-worktrees");
        let hooks = HookSet {
            pre_start: vec!["sh -lc 'exit 1'".to_string()],
            post_complete: Vec::new(),
        };
        register_workspace(&config_store, repo_path.as_str())?;

        config_store.update_repo_config(
            repo_path.as_str(),
            RepoConfig {
                worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
                branch_prefix: "odt".to_string(),
                default_target_branch: "origin/main".to_string(),
                trusted_hooks: true,
                trusted_hooks_fingerprint: Some(hook_set_fingerprint(&hooks)),
                hooks,
                prompt_overrides: Default::default(),
                agent_defaults: Default::default(),
            },
        )?;

        let qa_worktree_path = worktree_base.join("qa-task-1");
        let error = prepare_qa_worktree(repo_path.as_str(), "task-1", "Task 1", &config_store)
            .expect_err("failing pre-start hook should fail setup");
        assert!(error.to_string().contains("QA pre-start hook failed"));
        assert!(
            !qa_worktree_path.exists(),
            "qa worktree should be removed when pre-start hook fails"
        );

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn prepare_qa_worktree_rejects_invalid_task_id() -> Result<()> {
        let root = unique_temp_path("qa-worktree-invalid-task-id");
        let repo = root.join("repo");
        init_git_repo(&repo)?;
        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let repo_path = repo.to_string_lossy().to_string();
        let worktree_base = root.join("qa-worktrees");
        register_workspace(&config_store, repo_path.as_str())?;

        config_store.update_repo_config(
            repo_path.as_str(),
            RepoConfig {
                worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
                branch_prefix: "odt".to_string(),
                default_target_branch: "origin/main".to_string(),
                trusted_hooks: true,
                trusted_hooks_fingerprint: None,
                hooks: HookSet::default(),
                prompt_overrides: Default::default(),
                agent_defaults: Default::default(),
            },
        )?;

        let error = prepare_qa_worktree(repo_path.as_str(), "../../tmp", "Task 1", &config_store)
            .expect_err("task id with traversal markers should fail");
        assert!(error
            .to_string()
            .contains("Invalid task id for QA worktree"));

        let _ = fs::remove_dir_all(root);
        Ok(())
    }
}
