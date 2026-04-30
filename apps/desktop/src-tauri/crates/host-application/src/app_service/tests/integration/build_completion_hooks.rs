use anyhow::Result;
use host_domain::{GitCurrentBranch, TaskStatus};
use host_infra_system::{AppConfigStore, HookSet, RepoConfig};
use std::fs;

use crate::app_service::test_support::{
    build_service_with_store, init_git_repo, lock_env, make_task, unique_temp_path,
    workspace_update_repo_config_by_repo_path,
};

fn main_branch() -> GitCurrentBranch {
    GitCurrentBranch {
        name: Some("main".to_string()),
        detached: false,
        revision: None,
    }
}

#[test]
fn build_completed_runs_post_complete_hooks_in_builder_worktree() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("build-completed-post-complete-hook");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let worktree_base = root.join("builder-worktrees");
    let worktree = worktree_base.join("task-1");
    fs::create_dir_all(&worktree)?;

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let repo_path = repo.to_string_lossy().to_string();
    let mut task = make_task("task-1", "task", TaskStatus::InProgress);
    task.ai_review_enabled = false;
    let (service, task_state, _git_state) =
        build_service_with_store(vec![task], vec![], main_branch(), config_store);
    service.workspace_add(repo_path.as_str())?;
    workspace_update_repo_config_by_repo_path(
        &service,
        repo_path.as_str(),
        RepoConfig {
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            hooks: HookSet {
                pre_start: Vec::new(),
                post_complete: vec!["sh -lc 'printf cleanup > cleanup-ran.txt'".to_string()],
            },
            ..Default::default()
        },
    )?;

    let completed = service.build_completed(repo_path.as_str(), "task-1", Some("done"))?;
    assert_eq!(completed.status, TaskStatus::HumanReview);
    assert_eq!(
        fs::read_to_string(worktree.join("cleanup-ran.txt"))?,
        "cleanup"
    );

    let task_state = task_state.lock().expect("task lock poisoned");
    assert!(task_state
        .updated_patches
        .iter()
        .any(|(_, patch)| patch.status == Some(TaskStatus::HumanReview)));
    drop(task_state);

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn build_completed_skips_empty_post_complete_hooks_without_worktree() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("build-completed-empty-post-hook");
    let repo = root.join("repo");
    init_git_repo(&repo)?;

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let repo_path = repo.to_string_lossy().to_string();
    let mut task = make_task("task-1", "task", TaskStatus::InProgress);
    task.ai_review_enabled = false;
    let (service, _task_state, _git_state) =
        build_service_with_store(vec![task], vec![], main_branch(), config_store);
    service.workspace_add(repo_path.as_str())?;
    workspace_update_repo_config_by_repo_path(
        &service,
        repo_path.as_str(),
        RepoConfig {
            worktree_base_path: Some(root.join("builder-worktrees").to_string_lossy().to_string()),
            hooks: HookSet {
                pre_start: Vec::new(),
                post_complete: vec!["  ".to_string(), "\t".to_string()],
            },
            ..Default::default()
        },
    )?;

    let completed = service.build_completed(repo_path.as_str(), "task-1", None)?;
    assert_eq!(completed.status, TaskStatus::HumanReview);

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn build_completed_blocks_task_when_post_complete_hook_fails() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("build-completed-post-hook-failure");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let worktree_base = root.join("builder-worktrees");
    let worktree = worktree_base.join("task-1");
    fs::create_dir_all(&worktree)?;

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let repo_path = repo.to_string_lossy().to_string();
    let mut task = make_task("task-1", "task", TaskStatus::InProgress);
    task.ai_review_enabled = false;
    let (service, task_state, _git_state) =
        build_service_with_store(vec![task], vec![], main_branch(), config_store);
    service.workspace_add(repo_path.as_str())?;
    workspace_update_repo_config_by_repo_path(
        &service,
        repo_path.as_str(),
        RepoConfig {
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            hooks: HookSet {
                pre_start: Vec::new(),
                post_complete: vec!["sh -lc 'echo cleanup failed >&2; exit 1'".to_string()],
            },
            ..Default::default()
        },
    )?;

    let error = service
        .build_completed(repo_path.as_str(), "task-1", Some("done"))
        .expect_err("failing cleanup hook should fail build completion");
    let message = error.to_string();
    assert!(message.contains("Worktree cleanup script command failed"));
    assert!(message.contains("cleanup failed"));

    let task_state = task_state.lock().expect("task lock poisoned");
    assert!(task_state
        .updated_patches
        .iter()
        .any(|(_, patch)| patch.status == Some(TaskStatus::Blocked)));
    assert!(task_state.updated_patches.iter().all(|(_, patch)| {
        patch.status != Some(TaskStatus::HumanReview) && patch.status != Some(TaskStatus::AiReview)
    }));
    drop(task_state);

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn build_completed_from_human_review_is_no_op_without_running_hooks() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("build-completed-human-review-no-op");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let worktree_base = root.join("builder-worktrees");
    let worktree = worktree_base.join("task-1");
    fs::create_dir_all(&worktree)?;

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let repo_path = repo.to_string_lossy().to_string();
    let mut task = make_task("task-1", "task", TaskStatus::HumanReview);
    task.ai_review_enabled = false;
    let (service, task_state, _git_state) =
        build_service_with_store(vec![task], vec![], main_branch(), config_store);
    service.workspace_add(repo_path.as_str())?;
    workspace_update_repo_config_by_repo_path(
        &service,
        repo_path.as_str(),
        RepoConfig {
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            hooks: HookSet {
                pre_start: Vec::new(),
                post_complete: vec!["sh -lc 'printf should-not-run > cleanup-ran.txt'".to_string()],
            },
            ..Default::default()
        },
    )?;

    let completed = service
        .build_completed(repo_path.as_str(), "task-1", Some("duplicate"))
        .expect("build_completed from human_review should succeed as no-op");
    assert_eq!(completed.status, TaskStatus::HumanReview);
    assert!(!worktree.join("cleanup-ran.txt").exists());

    let task_state = task_state.lock().expect("task lock poisoned");
    assert!(task_state.updated_patches.is_empty());
    drop(task_state);

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn build_completed_from_ai_review_is_no_op_without_running_hooks() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("build-completed-ai-review-no-op");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let worktree_base = root.join("builder-worktrees");
    let worktree = worktree_base.join("task-1");
    fs::create_dir_all(&worktree)?;

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let repo_path = repo.to_string_lossy().to_string();
    let mut task = make_task("task-1", "task", TaskStatus::AiReview);
    task.ai_review_enabled = true;
    let (service, task_state, _git_state) =
        build_service_with_store(vec![task], vec![], main_branch(), config_store);
    service.workspace_add(repo_path.as_str())?;
    workspace_update_repo_config_by_repo_path(
        &service,
        repo_path.as_str(),
        RepoConfig {
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            hooks: HookSet {
                pre_start: Vec::new(),
                post_complete: vec!["sh -lc 'printf should-not-run > cleanup-ran.txt'".to_string()],
            },
            ..Default::default()
        },
    )?;

    let completed = service
        .build_completed(repo_path.as_str(), "task-1", Some("duplicate"))
        .expect("build_completed from ai_review should succeed as no-op");
    assert_eq!(completed.status, TaskStatus::AiReview);
    assert!(!worktree.join("cleanup-ran.txt").exists());

    let task_state = task_state.lock().expect("task lock poisoned");
    assert!(task_state.updated_patches.is_empty());
    drop(task_state);

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn build_completed_from_blocked_blocks_task_when_post_complete_hook_fails() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("build-completed-blocked-hook-failure");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let worktree_base = root.join("builder-worktrees");
    let worktree = worktree_base.join("task-1");
    fs::create_dir_all(&worktree)?;

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let repo_path = repo.to_string_lossy().to_string();
    let mut task = make_task("task-1", "task", TaskStatus::Blocked);
    task.ai_review_enabled = false;
    let (service, task_state, _git_state) =
        build_service_with_store(vec![task], vec![], main_branch(), config_store);
    service.workspace_add(repo_path.as_str())?;
    workspace_update_repo_config_by_repo_path(
        &service,
        repo_path.as_str(),
        RepoConfig {
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            hooks: HookSet {
                pre_start: Vec::new(),
                post_complete: vec!["sh -lc 'echo cleanup failed >&2; exit 1'".to_string()],
            },
            ..Default::default()
        },
    )?;

    let error = service
        .build_completed(repo_path.as_str(), "task-1", Some("done"))
        .expect_err("failing cleanup hook should fail build completion");
    let message = error.to_string();
    assert!(message.contains("Worktree cleanup script command failed"));
    assert!(message.contains("cleanup failed"));

    let task_state = task_state.lock().expect("task lock poisoned");
    assert!(task_state.updated_patches.iter().all(|(_, patch)| {
        patch.status != Some(TaskStatus::HumanReview) && patch.status != Some(TaskStatus::AiReview)
    }));
    drop(task_state);

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn build_completed_blocks_task_when_post_complete_hooks_have_no_worktree() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("build-completed-post-hook-missing-worktree");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let worktree_base = root.join("builder-worktrees");

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let repo_path = repo.to_string_lossy().to_string();
    let mut task = make_task("task-1", "task", TaskStatus::InProgress);
    task.ai_review_enabled = false;
    let (service, task_state, _git_state) =
        build_service_with_store(vec![task], vec![], main_branch(), config_store);
    service.workspace_add(repo_path.as_str())?;
    workspace_update_repo_config_by_repo_path(
        &service,
        repo_path.as_str(),
        RepoConfig {
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            hooks: HookSet {
                pre_start: Vec::new(),
                post_complete: vec!["sh -lc 'printf cleanup > cleanup-ran.txt'".to_string()],
            },
            ..Default::default()
        },
    )?;

    let error = service
        .build_completed(repo_path.as_str(), "task-1", Some("done"))
        .expect_err("configured cleanup hooks require a builder worktree");
    assert!(error
        .to_string()
        .contains("Worktree cleanup scripts require a builder worktree"));

    let task_state = task_state.lock().expect("task lock poisoned");
    assert!(task_state
        .updated_patches
        .iter()
        .any(|(_, patch)| patch.status == Some(TaskStatus::Blocked)));
    assert!(task_state.updated_patches.iter().all(|(_, patch)| {
        patch.status != Some(TaskStatus::HumanReview) && patch.status != Some(TaskStatus::AiReview)
    }));
    drop(task_state);

    let _ = fs::remove_dir_all(root);
    Ok(())
}
