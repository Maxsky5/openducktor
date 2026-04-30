use anyhow::{anyhow, Context, Result};
use host_domain::TaskStore;
use host_infra_system::{AppConfigStore, HookSet, RepoConfig};
use std::fs;
#[cfg(unix)]
use std::os::unix::fs::symlink;
use std::path::Path;
use std::process::Command;
use std::sync::{Arc, Mutex};

use crate::app_service::test_support::{
    add_workspace_with_repo_config, init_git_repo, unique_temp_path, write_private_file,
    FakeTaskStore, TaskStoreState,
};
use crate::app_service::AppService;

fn assert_branch_missing(repo_path: &Path, branch: &str) -> Result<()> {
    let output = Command::new("git")
        .current_dir(repo_path)
        .args(["branch", "--list", branch])
        .output()
        .with_context(|| format!("failed listing branch {branch} in {}", repo_path.display()))?;
    if !output.status.success() {
        return Err(anyhow!(
            "git branch --list failed for {branch} in {}",
            repo_path.display()
        ));
    }

    assert!(
        String::from_utf8_lossy(&output.stdout).trim().is_empty(),
        "branch {branch} should have been removed"
    );
    Ok(())
}

fn make_service(
    root: &Path,
    repo_path: &str,
    worktree_copy_paths: Vec<String>,
) -> Result<AppService> {
    let task_state = Arc::new(Mutex::new(TaskStoreState::default()));
    let task_store: Arc<dyn TaskStore> = Arc::new(FakeTaskStore { state: task_state });
    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let service = AppService::new(task_store, config_store);
    add_workspace_with_repo_config(
        &service,
        repo_path,
        RepoConfig {
            default_runtime_kind: "opencode".to_string(),
            worktree_base_path: Some(root.join("worktrees").to_string_lossy().to_string()),
            branch_prefix: "odt".to_string(),
            default_target_branch: host_infra_system::GitTargetBranch {
                remote: Some("origin".to_string()),
                branch: "main".to_string(),
            },
            git: Default::default(),
            hooks: HookSet::default(),
            dev_servers: Vec::new(),
            worktree_copy_paths,
            prompt_overrides: Default::default(),
            agent_defaults: Default::default(),
            ..Default::default()
        },
    )?;
    Ok(service)
}

#[test]
fn git_create_worktree_copies_configured_directory() -> Result<()> {
    let root = unique_temp_path("git-create-worktree-copies-directory");
    let result = (|| -> Result<()> {
        let repo = root.join("repo");
        let worktree = root.join("worktree");
        init_git_repo(&repo)?;
        fs::create_dir_all(repo.join(".vscode").join("profiles"))?;
        write_private_file(
            repo.join(".vscode").join("settings.json").as_path(),
            "{\"editor.tabSize\":2}\n",
        )?;
        write_private_file(
            repo.join(".vscode")
                .join("profiles")
                .join("local.json")
                .as_path(),
            "{\"name\":\"local\"}\n",
        )?;

        let repo_path = repo.to_string_lossy().to_string();
        let service = make_service(
            root.as_path(),
            repo_path.as_str(),
            vec![".vscode".to_string()],
        )?;

        service.git_create_worktree(
            repo_path.as_str(),
            worktree.to_string_lossy().as_ref(),
            "feature/manual-directory-copy",
            true,
        )?;

        assert_eq!(
            fs::read_to_string(worktree.join(".vscode").join("settings.json"))?,
            "{\"editor.tabSize\":2}\n"
        );
        assert_eq!(
            fs::read_to_string(worktree.join(".vscode").join("profiles").join("local.json"))?,
            "{\"name\":\"local\"}\n"
        );

        service.git_remove_worktree(
            repo_path.as_str(),
            worktree.to_string_lossy().as_ref(),
            true,
        )?;
        Ok(())
    })();

    let _ = fs::remove_dir_all(root);
    result
}

#[cfg(unix)]
#[test]
fn git_create_worktree_cleans_up_when_configured_directory_copy_fails() -> Result<()> {
    let root = unique_temp_path("git-create-worktree-directory-copy-failure");
    let result = (|| -> Result<()> {
        let repo = root.join("repo");
        let worktree = root.join("worktree");
        let outside = root.join("outside");
        init_git_repo(&repo)?;
        fs::create_dir_all(repo.join(".vscode"))?;
        fs::create_dir_all(&outside)?;
        write_private_file(repo.join(".vscode").join("settings.json").as_path(), "{}\n")?;
        symlink(
            outside.join("secret.env"),
            repo.join(".vscode").join("bad-link"),
        )?;

        let repo_path = repo.to_string_lossy().to_string();
        let service = make_service(
            root.as_path(),
            repo_path.as_str(),
            vec![".vscode".to_string()],
        )?;

        let error = service
            .git_create_worktree(
                repo_path.as_str(),
                worktree.to_string_lossy().as_ref(),
                "feature/manual-directory-copy-failure",
                true,
            )
            .expect_err("configured directory symlink should fail");
        let message = error.to_string();
        assert!(message.contains("Configured worktree copy failed"));
        assert!(message.contains("bad-link"));
        assert!(
            !worktree.exists(),
            "manual worktree creation should remove the failed worktree"
        );
        assert_branch_missing(repo.as_path(), "feature/manual-directory-copy-failure")?;
        Ok(())
    })();

    let _ = fs::remove_dir_all(root);
    result
}
