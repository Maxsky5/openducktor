use anyhow::{anyhow, Context, Result};
use host_domain::{GitTargetBranch as TaskGitTargetBranch, TaskCard, TaskStatus};
use host_infra_system::{AppConfigStore, GitTargetBranch as RepoGitTargetBranch, RepoConfig};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use super::support::{
    test_git_current_branch, test_repo_config, TEST_BRANCH_PREFIX, TEST_MAIN_BRANCH,
    TEST_RUNTIME_KIND, TEST_TASK_ID,
};
use crate::app_service::test_support::{
    build_service_with_store, create_fake_opencode, init_git_repo, install_fake_dolt, lock_env,
    make_task, set_fake_opencode_and_bridge_binaries, unique_temp_path,
    workspace_update_repo_config_by_repo_path,
};
use crate::app_service::AppService;

fn run_git(repo_path: &Path, args: &[&str]) -> Result<String> {
    let output = Command::new("git")
        .current_dir(repo_path)
        .args(args)
        .output()
        .with_context(|| {
            format!(
                "failed running git in {} with args {:?}",
                repo_path.display(),
                args
            )
        })?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
    }

    Err(anyhow!(
        "git {:?} failed in {} with status {}\n{}",
        args,
        repo_path.display(),
        output.status,
        String::from_utf8_lossy(&output.stderr).trim()
    ))
}

fn run_git_success(repo_path: &Path, args: &[&str]) -> Result<()> {
    run_git(repo_path, args).map(|_| ())
}

fn add_bare_remote(root: &Path, repo_path: &Path, remote_name: &str) -> Result<()> {
    fs::create_dir_all(root)?;
    let remote_dir = root.join(format!("{remote_name}.git"));
    let remote_dir_string = remote_dir.to_string_lossy().to_string();
    run_git_success(root, &["init", "--bare", remote_dir_string.as_str()])?;
    run_git_success(
        repo_path,
        &["remote", "add", remote_name, remote_dir_string.as_str()],
    )
}

fn create_branch_with_commit(repo_path: &Path, branch: &str, file_name: &str) -> Result<()> {
    run_git_success(repo_path, &["checkout", "-b", branch])?;
    commit_file_on_current_branch(repo_path, file_name, branch, branch)
}

fn commit_file_on_current_branch(
    repo_path: &Path,
    file_name: &str,
    contents: &str,
    message: &str,
) -> Result<()> {
    fs::write(repo_path.join(file_name), format!("{contents}\n"))?;
    run_git_success(repo_path, &["add", file_name])?;
    run_git_success(repo_path, &["commit", "-m", message])
}

fn push_branch(repo_path: &Path, remote: &str, branch: &str) -> Result<()> {
    let refspec = format!("{branch}:{branch}");
    run_git_success(repo_path, &["push", remote, refspec.as_str()])
}

fn current_upstream(worktree_path: &Path) -> Result<String> {
    run_git(
        worktree_path,
        &[
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{upstream}",
        ],
    )
}

fn current_branch(worktree_path: &Path) -> Result<String> {
    run_git(worktree_path, &["branch", "--show-current"])
}

fn make_repo_config(
    worktree_base: &Path,
    target_remote: Option<&str>,
    target_branch: &str,
) -> RepoConfig {
    let mut repo_config = test_repo_config(Some(worktree_base));
    repo_config.default_target_branch = RepoGitTargetBranch {
        remote: target_remote.map(str::to_string),
        branch: target_branch.to_string(),
    };
    repo_config
}

fn create_build_service(
    root: &Path,
    repo: &Path,
    task: TaskCard,
    target_remote: Option<&str>,
    target_branch: &str,
) -> Result<(AppService, String)> {
    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let worktree_base = root.join("builder-worktrees");
    let repo_path = repo.to_string_lossy().to_string();
    let (service, _task_state, _git_state) =
        build_service_with_store(vec![task], vec![], test_git_current_branch(), config_store);
    service.workspace_add(repo_path.as_str())?;
    workspace_update_repo_config_by_repo_path(
        &service,
        repo_path.as_str(),
        make_repo_config(worktree_base.as_path(), target_remote, target_branch),
    )?;
    Ok((service, repo_path))
}

fn stop_runtime_if_started(service: &AppService, repo_path: &str) -> Result<()> {
    let runtimes = service.runtime_list(TEST_RUNTIME_KIND, Some(repo_path))?;
    for runtime in runtimes {
        service.runtime_stop(runtime.runtime_id.as_str())?;
    }
    Ok(())
}

#[test]
fn build_start_tracks_task_branch_on_default_remote_target() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("build-start-default-remote-upstream");
    let result = (|| -> Result<()> {
        let repo = root.join("repo");
        init_git_repo(repo.as_path())?;
        let fake_opencode = root.join("opencode");
        create_fake_opencode(fake_opencode.as_path())?;
        let _dolt_guard = install_fake_dolt(root.as_path())?;
        let _runtime_binary_guards = set_fake_opencode_and_bridge_binaries(fake_opencode.as_path());

        add_bare_remote(root.as_path(), repo.as_path(), "origin")?;
        create_branch_with_commit(repo.as_path(), "develop", "develop-only.txt")?;
        push_branch(repo.as_path(), "origin", "develop")?;
        run_git_success(repo.as_path(), &["checkout", TEST_MAIN_BRANCH])?;
        commit_file_on_current_branch(repo.as_path(), "main-only.txt", "main", "main-only")?;

        let task = make_task(TEST_TASK_ID, "bug", TaskStatus::Open);
        let (service, repo_path) = create_build_service(
            root.as_path(),
            repo.as_path(),
            task,
            Some("origin"),
            "develop",
        )?;

        let bootstrap = service.build_start(repo_path.as_str(), TEST_TASK_ID, TEST_RUNTIME_KIND)?;
        let worktree_path = PathBuf::from(bootstrap.working_directory.as_str());
        let branch = current_branch(worktree_path.as_path())?;
        let upstream = current_upstream(worktree_path.as_path())?;

        assert!(worktree_path.join("develop-only.txt").exists());
        assert!(!worktree_path.join("main-only.txt").exists());
        assert!(branch.starts_with(format!("{TEST_BRANCH_PREFIX}/{TEST_TASK_ID}").as_str()));
        assert!(upstream.starts_with("origin/odt/"));
        assert_eq!(upstream, format!("origin/{branch}"));
        assert_ne!(upstream, "origin/develop");
        assert_ne!(upstream, "origin/main");

        stop_runtime_if_started(&service, repo_path.as_str())
    })();

    let _ = fs::remove_dir_all(root.as_path());
    result
}

#[test]
fn build_start_tracks_task_branch_on_task_target_override_remote() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("build-start-task-override-upstream");
    let result = (|| -> Result<()> {
        let repo = root.join("repo");
        init_git_repo(repo.as_path())?;
        let fake_opencode = root.join("opencode");
        create_fake_opencode(fake_opencode.as_path())?;
        let _dolt_guard = install_fake_dolt(root.as_path())?;
        let _runtime_binary_guards = set_fake_opencode_and_bridge_binaries(fake_opencode.as_path());

        add_bare_remote(root.as_path(), repo.as_path(), "upstream")?;
        create_branch_with_commit(repo.as_path(), "release", "release-only.txt")?;
        push_branch(repo.as_path(), "upstream", "release")?;
        run_git_success(repo.as_path(), &["checkout", TEST_MAIN_BRANCH])?;
        commit_file_on_current_branch(repo.as_path(), "main-only.txt", "main", "main-only")?;

        let mut task = make_task(TEST_TASK_ID, "bug", TaskStatus::Open);
        task.target_branch = Some(TaskGitTargetBranch {
            remote: Some("upstream".to_string()),
            branch: "release".to_string(),
        });
        let (service, repo_path) =
            create_build_service(root.as_path(), repo.as_path(), task, None, TEST_MAIN_BRANCH)?;

        let bootstrap = service.build_start(repo_path.as_str(), TEST_TASK_ID, TEST_RUNTIME_KIND)?;
        let worktree_path = PathBuf::from(bootstrap.working_directory.as_str());
        let branch = current_branch(worktree_path.as_path())?;
        let upstream = current_upstream(worktree_path.as_path())?;

        assert!(worktree_path.join("release-only.txt").exists());
        assert!(!worktree_path.join("main-only.txt").exists());
        assert!(branch.starts_with(format!("{TEST_BRANCH_PREFIX}/{TEST_TASK_ID}").as_str()));
        assert!(upstream.starts_with("upstream/odt/"));
        assert_eq!(upstream, format!("upstream/{branch}"));
        assert_ne!(upstream, "upstream/release");

        stop_runtime_if_started(&service, repo_path.as_str())
    })();

    let _ = fs::remove_dir_all(root.as_path());
    result
}
