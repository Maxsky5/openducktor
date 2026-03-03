use anyhow::Result;
use host_domain::{GitBranch, GitCurrentBranch};
use std::path::Path;

use super::util::normalize_non_empty;
use super::GitCliPort;

impl GitCliPort {
    pub(super) fn get_branches_impl(&self, repo_path: &Path) -> Result<Vec<GitBranch>> {
        self.ensure_repository(repo_path)?;
        let output = self.run_git(
            repo_path,
            &[
                "for-each-ref",
                "--format=%(if)%(HEAD)%(then)1%(else)0%(end)|%(refname:short)|%(refname)",
                "refs/heads",
                "refs/remotes",
            ],
        )?;

        let mut branches = parse_branch_rows(output.as_str());
        branches.sort_by(|a, b| {
            b.is_current
                .cmp(&a.is_current)
                .then(a.is_remote.cmp(&b.is_remote))
                .then(a.name.cmp(&b.name))
        });
        Ok(branches)
    }

    pub(super) fn get_current_branch_impl(&self, repo_path: &Path) -> Result<GitCurrentBranch> {
        self.ensure_repository(repo_path)?;
        self.get_current_branch_unchecked(repo_path)
    }

    pub(super) fn get_current_branch_unchecked(&self, repo_path: &Path) -> Result<GitCurrentBranch> {
        let output = self.run_git(repo_path, &["branch", "--show-current"])?;
        let name = output
            .lines()
            .find(|line| !line.trim().is_empty())
            .map(|line| line.trim().to_string());

        Ok(GitCurrentBranch {
            detached: name.is_none(),
            name,
        })
    }

    pub(super) fn switch_branch_impl(
        &self,
        repo_path: &Path,
        branch: &str,
        create: bool,
    ) -> Result<GitCurrentBranch> {
        self.ensure_repository(repo_path)?;
        let branch = normalize_non_empty(branch, "branch")?;

        if create {
            self.run_git(repo_path, &["switch", "-c", branch.as_str()])?;
        } else {
            self.run_git(repo_path, &["switch", "--end-of-options", branch.as_str()])?;
        }

        self.get_current_branch_impl(repo_path)
    }
}

fn parse_branch_rows(output: &str) -> Vec<GitBranch> {
    output
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                return None;
            }

            let mut parts = trimmed.splitn(3, '|');
            let head_marker = parts.next()?.trim();
            let name = parts.next()?.trim();
            let full_ref = parts.next()?.trim();
            if name.is_empty() || full_ref.is_empty() {
                return None;
            }

            let is_remote = full_ref.starts_with("refs/remotes/");
            if is_remote && full_ref.ends_with("/HEAD") {
                return None;
            }

            Some(GitBranch {
                name: name.to_string(),
                is_current: head_marker == "1" || head_marker == "*",
                is_remote,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::parse_branch_rows;

    #[test]
    fn parse_branch_rows_marks_current_local_and_remote_branches() {
        let parsed = parse_branch_rows(
            "1|main|refs/heads/main\n0|feature/a|refs/heads/feature/a\n0|origin/main|refs/remotes/origin/main\n",
        );

        assert_eq!(parsed.len(), 3);
        assert_eq!(parsed[0].name, "main");
        assert!(parsed[0].is_current);
        assert!(!parsed[0].is_remote);
        assert_eq!(parsed[2].name, "origin/main");
        assert!(parsed[2].is_remote);
    }

    #[test]
    fn parse_branch_rows_skips_remote_head_symbolic_ref() {
        let parsed = parse_branch_rows(
            "0|origin/HEAD|refs/remotes/origin/HEAD\n0|origin/main|refs/remotes/origin/main\n",
        );

        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].name, "origin/main");
    }
}
