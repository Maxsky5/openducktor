use anyhow::Result;
use host_domain::GitWorktreeSummary;
use std::path::Path;

use super::util::{normalize_non_empty, path_to_string};
use super::GitCliPort;

impl GitCliPort {
    pub(super) fn list_worktrees_impl(&self, repo_path: &Path) -> Result<Vec<GitWorktreeSummary>> {
        self.ensure_repository(repo_path)?;
        let output = self.run_git(repo_path, &["worktree", "list", "--porcelain"])?;
        let mut worktrees = Vec::new();
        let mut current_path: Option<String> = None;
        let mut current_branch: Option<String> = None;

        let flush_current = |worktrees: &mut Vec<GitWorktreeSummary>,
                             current_path: &mut Option<String>,
                             current_branch: &mut Option<String>| {
            let Some(worktree_path) = current_path.take() else {
                return;
            };
            worktrees.push(GitWorktreeSummary {
                branch: current_branch.take().unwrap_or_default(),
                worktree_path,
            });
        };

        for line in output.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                flush_current(&mut worktrees, &mut current_path, &mut current_branch);
                continue;
            }

            if let Some(path) = trimmed.strip_prefix("worktree ") {
                flush_current(&mut worktrees, &mut current_path, &mut current_branch);
                current_path = Some(path.to_string());
                continue;
            }

            if let Some(branch_ref) = trimmed.strip_prefix("branch ") {
                current_branch = Some(
                    branch_ref
                        .strip_prefix("refs/heads/")
                        .unwrap_or(branch_ref)
                        .to_string(),
                );
            }
        }

        flush_current(&mut worktrees, &mut current_path, &mut current_branch);
        Ok(worktrees)
    }

    pub(super) fn create_worktree_impl(
        &self,
        repo_path: &Path,
        worktree_path: &Path,
        branch: &str,
        create_branch: bool,
    ) -> Result<()> {
        self.ensure_repository(repo_path)?;
        let branch = normalize_non_empty(branch, "branch")?;
        let worktree_path = path_to_string(worktree_path, "worktree path")?;

        if create_branch {
            self.run_git(
                repo_path,
                &[
                    "worktree",
                    "add",
                    "-b",
                    branch.as_str(),
                    "--end-of-options",
                    worktree_path.as_str(),
                ],
            )?;
        } else {
            self.run_git(
                repo_path,
                &[
                    "worktree",
                    "add",
                    "--end-of-options",
                    worktree_path.as_str(),
                    branch.as_str(),
                ],
            )?;
        }

        Ok(())
    }

    pub(super) fn remove_worktree_impl(
        &self,
        repo_path: &Path,
        worktree_path: &Path,
        force: bool,
    ) -> Result<()> {
        self.ensure_repository(repo_path)?;
        let worktree_path = path_to_string(worktree_path, "worktree path")?;
        let mut args = vec!["worktree".to_string(), "remove".to_string()];
        if force {
            args.push("--force".to_string());
        }
        args.push("--end-of-options".to_string());
        args.push(worktree_path);
        let borrowed = args.iter().map(String::as_str).collect::<Vec<_>>();
        self.run_git(repo_path, borrowed.as_slice())?;
        Ok(())
    }
}
