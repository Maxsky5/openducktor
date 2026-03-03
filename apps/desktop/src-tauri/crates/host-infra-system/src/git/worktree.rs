use anyhow::Result;
use std::path::Path;

use super::util::{normalize_non_empty, path_to_string};
use super::GitCliPort;

impl GitCliPort {
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
                    worktree_path.as_str(),
                ],
            )?;
        } else {
            self.run_git(
                repo_path,
                &["worktree", "add", worktree_path.as_str(), branch.as_str()],
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
        args.push(worktree_path);
        let borrowed = args.iter().map(String::as_str).collect::<Vec<_>>();
        self.run_git(repo_path, borrowed.as_slice())?;
        Ok(())
    }
}
