use super::{run_parsed_hook_command_allow_failure, validate_hook_trust};
use anyhow::{anyhow, Context, Result};
use host_infra_system::{build_branch_name, remove_worktree, run_command, AppConfigStore};
use std::fs;
use std::path::Path;

pub(crate) struct QaWorktreeSetup {
    pub(crate) working_directory: String,
    pub(crate) cleanup_repo_path: String,
    pub(crate) cleanup_worktree_path: String,
}

pub(crate) fn prepare_qa_worktree(
    repo_path: &str,
    task_id: &str,
    task_title: &str,
    config_store: &AppConfigStore,
) -> Result<QaWorktreeSetup> {
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
        working_directory: qa_worktree_path.clone(),
        cleanup_repo_path: repo_path.to_string(),
        cleanup_worktree_path: qa_worktree_path,
    })
}

fn remove_runtime_worktree(repo_path: &Path, worktree_path: &Path) -> Result<()> {
    remove_worktree(repo_path, worktree_path).with_context(|| {
        format!(
            "Failed removing QA worktree runtime {}",
            worktree_path.display()
        )
    })
}
