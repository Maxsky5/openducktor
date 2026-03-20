use anyhow::{anyhow, Result};
use host_domain::{now_rfc3339, GitProviderRepository, PullRequestRecord};
use host_infra_system::{command_exists, run_command_allow_failure_with_env, run_command_with_env};
use serde::Deserialize;
use std::path::Path;

const GIT_PROVIDER_ENV: [(&str, &str); 1] = [("GH_PROMPT_DISABLED", "1")];

#[derive(Debug, Clone)]
pub(super) struct GitProviderAuthStatus {
    pub authenticated: bool,
    pub error: Option<String>,
}

pub(super) trait GitHostingProvider: Send + Sync {
    fn is_available(&self) -> bool;
    fn auth_status(&self, host: &str) -> Result<GitProviderAuthStatus>;
    fn detect_repository(&self, repo_path: &Path) -> Result<Option<GitProviderRepository>>;
    fn resolve_remote_name(
        &self,
        repo_path: &Path,
        repository: &GitProviderRepository,
    ) -> Result<String>;
    fn create_pull_request(
        &self,
        repo_path: &Path,
        repository: &GitProviderRepository,
        source_branch: &str,
        target_branch: &str,
        title: &str,
        body: &str,
    ) -> Result<ResolvedPullRequest>;
    fn update_pull_request(
        &self,
        repo_path: &Path,
        repository: &GitProviderRepository,
        number: u32,
        title: &str,
        body: &str,
    ) -> Result<ResolvedPullRequest>;
    fn fetch_pull_request(
        &self,
        repo_path: &Path,
        repository: &GitProviderRepository,
        number: u32,
    ) -> Result<ResolvedPullRequest>;
    fn find_open_pull_request_for_branch(
        &self,
        repo_path: &Path,
        repository: &GitProviderRepository,
        source_branch: &str,
    ) -> Result<Option<ResolvedPullRequest>>;
    fn find_pull_request_for_branch(
        &self,
        repo_path: &Path,
        repository: &GitProviderRepository,
        source_branch: &str,
    ) -> Result<Option<ResolvedPullRequest>>;
}

pub(super) struct GithubGhCliProvider;

#[derive(Debug, Deserialize)]
struct GithubPullBranchRef {
    #[serde(rename = "ref")]
    name: String,
}

#[derive(Debug, Deserialize)]
struct GithubPullResponse {
    number: u32,
    html_url: String,
    draft: bool,
    state: String,
    created_at: String,
    updated_at: String,
    merged_at: Option<String>,
    closed_at: Option<String>,
    head: GithubPullBranchRef,
}

#[derive(Debug, Clone)]
pub(super) struct ResolvedPullRequest {
    pub record: PullRequestRecord,
    pub source_branch: String,
}

impl GithubGhCliProvider {
    fn find_pull_request_list_entry_for_branch(
        repo_path: &Path,
        repository: &GitProviderRepository,
        source_branch: &str,
        state: Option<&str>,
    ) -> Result<Option<ResolvedPullRequest>> {
        let repo_slug = Self::repo_slug(repository);
        let path = format!("repos/{repo_slug}/pulls");
        let mut args = vec![
            "api".to_string(),
            "--method".to_string(),
            "GET".to_string(),
            path,
        ];
        if let Some(state) = state {
            args.push("-f".to_string());
            args.push(format!("state={state}"));
        }
        args.push("-f".to_string());
        args.push(format!("head={}:{}", repository.owner, source_branch));
        let arg_refs = args.iter().map(String::as_str).collect::<Vec<_>>();
        let payload = Self::run_gh(
            repo_path,
            Some(repository.host.as_str()),
            arg_refs.as_slice(),
        )?;
        let mut pull_requests = Self::parse_pull_list_response(payload)?;
        match pull_requests.len() {
            0 => Ok(None),
            1 => Ok(pull_requests.pop()),
            _ => Err(anyhow!(
                "Multiple pull requests were found for branch {source_branch}."
            )),
        }
    }

    fn build_gh_args(host: Option<&str>, args: &[&str]) -> Vec<String> {
        let mut full_args = Vec::new();
        if let Some(host) = host.filter(|value| !value.trim().is_empty()) {
            full_args.push("--hostname".to_string());
            full_args.push(host.trim().to_string());
        }
        full_args.extend(args.iter().map(|value| value.to_string()));
        full_args
    }

    fn git_remote_names(repo_path: &Path) -> Result<Vec<String>> {
        let (ok, stdout, stderr) = run_command_allow_failure_with_env(
            "git",
            &["remote"],
            Some(repo_path),
            &[("GIT_TERMINAL_PROMPT", "0")],
        )?;
        if !ok {
            let detail = if stderr.trim().is_empty() {
                stdout
            } else if stdout.trim().is_empty() {
                stderr
            } else {
                format!("{stdout}\n{stderr}")
            };
            return Err(anyhow!("Failed to list git remotes: {}", detail.trim()));
        }

        Ok(stdout
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(ToString::to_string)
            .collect())
    }

    fn git_remote_url(repo_path: &Path, remote_name: &str) -> Result<Option<String>> {
        let (ok, stdout, _stderr) = run_command_allow_failure_with_env(
            "git",
            &["remote", "get-url", remote_name],
            Some(repo_path),
            &[("GIT_TERMINAL_PROMPT", "0")],
        )?;
        if !ok {
            return Ok(None);
        }

        let url = stdout.trim();
        if url.is_empty() {
            return Ok(None);
        }
        Ok(Some(url.to_string()))
    }

    fn repository_matches(left: &GitProviderRepository, right: &GitProviderRepository) -> bool {
        left.host.eq_ignore_ascii_case(right.host.as_str())
            && left.owner.eq_ignore_ascii_case(right.owner.as_str())
            && left.name.eq_ignore_ascii_case(right.name.as_str())
    }

    fn parsed_git_remotes(repo_path: &Path) -> Result<Vec<(String, GitProviderRepository)>> {
        let remote_names = Self::git_remote_names(repo_path)?;
        let mut remotes = Vec::new();
        for remote_name in remote_names {
            let Some(url) = Self::git_remote_url(repo_path, remote_name.as_str())? else {
                continue;
            };
            let Some(repository) = Self::parse_remote_url(url.as_str()) else {
                continue;
            };
            remotes.push((remote_name, repository));
        }
        Ok(remotes)
    }

    fn run_gh(repo_path: &Path, host: Option<&str>, args: &[&str]) -> Result<String> {
        let full_args = Self::build_gh_args(host, args);
        let arg_refs = full_args.iter().map(String::as_str).collect::<Vec<_>>();
        run_command_with_env(
            "gh",
            arg_refs.as_slice(),
            Some(repo_path),
            &GIT_PROVIDER_ENV,
        )
    }

    fn run_gh_allow_failure(
        repo_path: &Path,
        host: Option<&str>,
        args: &[&str],
    ) -> Result<(bool, String, String)> {
        let full_args = Self::build_gh_args(host, args);
        let arg_refs = full_args.iter().map(String::as_str).collect::<Vec<_>>();
        run_command_allow_failure_with_env(
            "gh",
            arg_refs.as_slice(),
            Some(repo_path),
            &GIT_PROVIDER_ENV,
        )
    }

    fn parse_remote_url(url: &str) -> Option<GitProviderRepository> {
        let trimmed = url.trim();
        if trimmed.is_empty() {
            return None;
        }

        let without_suffix = trimmed.strip_suffix(".git").unwrap_or(trimmed);
        let (host, path) = if let Some(rest) = without_suffix.strip_prefix("git@") {
            let (host, path) = rest.split_once(':')?;
            (host, path)
        } else if let Some(rest) = without_suffix.strip_prefix("https://") {
            let (host, path) = rest.split_once('/')?;
            (host, path)
        } else if let Some(rest) = without_suffix.strip_prefix("ssh://git@") {
            let (host, path) = rest.split_once('/')?;
            (host, path)
        } else {
            return None;
        };

        let host = host
            .rsplit_once('@')
            .map_or(host, |(_, actual_host)| actual_host);

        let mut segments = path.split('/');
        let owner = segments.next()?.trim();
        let name = segments.next()?.trim();
        if host.trim().is_empty() || owner.is_empty() || name.is_empty() {
            return None;
        }

        Some(GitProviderRepository {
            host: host.trim().to_string(),
            owner: owner.to_string(),
            name: name.to_string(),
        })
    }

    fn normalize_pull_request(response: GithubPullResponse) -> ResolvedPullRequest {
        let state = if response.merged_at.is_some() {
            "merged"
        } else if response.draft {
            "draft"
        } else if response.state.trim().eq_ignore_ascii_case("open") {
            "open"
        } else {
            "closed_unmerged"
        };

        ResolvedPullRequest {
            record: PullRequestRecord {
                provider_id: "github".to_string(),
                number: response.number,
                url: response.html_url,
                state: state.to_string(),
                created_at: response.created_at,
                updated_at: response.updated_at,
                last_synced_at: Some(now_rfc3339()),
                merged_at: response.merged_at,
                closed_at: response.closed_at,
            },
            source_branch: response.head.name,
        }
    }

    fn parse_pull_response(payload: String) -> Result<ResolvedPullRequest> {
        let response: GithubPullResponse = serde_json::from_str(payload.as_str())
            .map_err(|error| anyhow!("Failed to parse GitHub pull request response: {error}"))?;
        Ok(Self::normalize_pull_request(response))
    }

    fn parse_pull_list_response(payload: String) -> Result<Vec<ResolvedPullRequest>> {
        if let Ok(responses) = serde_json::from_str::<Vec<GithubPullResponse>>(payload.as_str()) {
            return Ok(responses
                .into_iter()
                .map(Self::normalize_pull_request)
                .collect());
        }

        let pages = serde_json::from_str::<Vec<Vec<GithubPullResponse>>>(payload.as_str())
            .map_err(|error| {
                anyhow!("Failed to parse GitHub pull request list response: {error}")
            })?;
        Ok(pages
            .into_iter()
            .flatten()
            .map(Self::normalize_pull_request)
            .collect())
    }

    fn repo_slug(repository: &GitProviderRepository) -> String {
        format!("{}/{}", repository.owner, repository.name)
    }
}

impl GitHostingProvider for GithubGhCliProvider {
    fn is_available(&self) -> bool {
        command_exists("gh")
    }

    fn auth_status(&self, host: &str) -> Result<GitProviderAuthStatus> {
        if !self.is_available() {
            return Ok(GitProviderAuthStatus {
                authenticated: false,
                error: Some("gh CLI is not installed.".to_string()),
            });
        }

        let (ok, stdout, stderr) = Self::run_gh_allow_failure(
            Path::new("."),
            None,
            &["auth", "status", "--hostname", host],
        )?;
        let detail = if stderr.trim().is_empty() {
            stdout.trim().to_string()
        } else if stdout.trim().is_empty() {
            stderr.trim().to_string()
        } else {
            format!("{}\n{}", stdout.trim(), stderr.trim())
        };

        if ok {
            return Ok(GitProviderAuthStatus {
                authenticated: true,
                error: None,
            });
        }

        Ok(GitProviderAuthStatus {
            authenticated: false,
            error: Some(if detail.is_empty() {
                "GitHub authentication is not configured. Run `gh auth login`.".to_string()
            } else {
                detail
            }),
        })
    }

    fn detect_repository(&self, repo_path: &Path) -> Result<Option<GitProviderRepository>> {
        let mut detected = Vec::new();
        for (_remote_name, repository) in Self::parsed_git_remotes(repo_path)? {
            if detected
                .iter()
                .any(|entry: &GitProviderRepository| Self::repository_matches(entry, &repository))
            {
                continue;
            }
            detected.push(repository);
        }

        if detected.len() == 1 {
            return Ok(detected.into_iter().next());
        }

        Ok(None)
    }

    fn resolve_remote_name(
        &self,
        repo_path: &Path,
        repository: &GitProviderRepository,
    ) -> Result<String> {
        let matches = Self::parsed_git_remotes(repo_path)?
            .into_iter()
            .filter_map(|(remote_name, candidate)| {
                if Self::repository_matches(&candidate, repository) {
                    Some(remote_name)
                } else {
                    None
                }
            })
            .collect::<Vec<_>>();

        match matches.as_slice() {
            [remote_name] => Ok(remote_name.clone()),
            [] => Err(anyhow!(
                "No git remote matches the configured GitHub repository {}:{}/{}.",
                repository.host,
                repository.owner,
                repository.name
            )),
            _ => Err(anyhow!(
                "Multiple git remotes match the configured GitHub repository {}:{}/{}: {}. Configure a single matching remote before opening or updating a pull request.",
                repository.host,
                repository.owner,
                repository.name,
                matches.join(", ")
            )),
        }
    }

    fn create_pull_request(
        &self,
        repo_path: &Path,
        repository: &GitProviderRepository,
        source_branch: &str,
        target_branch: &str,
        title: &str,
        body: &str,
    ) -> Result<ResolvedPullRequest> {
        let repo_slug = Self::repo_slug(repository);
        let payload = Self::run_gh(
            repo_path,
            Some(repository.host.as_str()),
            &[
                "api",
                "--method",
                "POST",
                &format!("repos/{repo_slug}/pulls"),
                "-f",
                &format!("title={title}"),
                "-f",
                &format!("head={source_branch}"),
                "-f",
                &format!("base={target_branch}"),
                "-f",
                &format!("body={body}"),
            ],
        )?;
        Self::parse_pull_response(payload)
    }

    fn update_pull_request(
        &self,
        repo_path: &Path,
        repository: &GitProviderRepository,
        number: u32,
        title: &str,
        body: &str,
    ) -> Result<ResolvedPullRequest> {
        let repo_slug = Self::repo_slug(repository);
        let payload = Self::run_gh(
            repo_path,
            Some(repository.host.as_str()),
            &[
                "api",
                "--method",
                "PATCH",
                &format!("repos/{repo_slug}/pulls/{number}"),
                "-f",
                &format!("title={title}"),
                "-f",
                &format!("body={body}"),
            ],
        )?;
        Self::parse_pull_response(payload)
    }

    fn fetch_pull_request(
        &self,
        repo_path: &Path,
        repository: &GitProviderRepository,
        number: u32,
    ) -> Result<ResolvedPullRequest> {
        let repo_slug = Self::repo_slug(repository);
        let payload = Self::run_gh(
            repo_path,
            Some(repository.host.as_str()),
            &["api", &format!("repos/{repo_slug}/pulls/{number}")],
        )?;
        Self::parse_pull_response(payload)
    }

    fn find_open_pull_request_for_branch(
        &self,
        repo_path: &Path,
        repository: &GitProviderRepository,
        source_branch: &str,
    ) -> Result<Option<ResolvedPullRequest>> {
        Self::find_pull_request_list_entry_for_branch(
            repo_path,
            repository,
            source_branch,
            Some("open"),
        )
    }

    fn find_pull_request_for_branch(
        &self,
        repo_path: &Path,
        repository: &GitProviderRepository,
        source_branch: &str,
    ) -> Result<Option<ResolvedPullRequest>> {
        Self::find_pull_request_list_entry_for_branch(
            repo_path,
            repository,
            source_branch,
            Some("all"),
        )
    }
}

pub(super) fn github_provider() -> GithubGhCliProvider {
    GithubGhCliProvider
}

#[cfg(test)]
mod tests {
    use super::GithubGhCliProvider;
    use host_domain::GitProviderRepository;

    #[test]
    fn parse_remote_url_strips_https_userinfo() {
        assert_eq!(
            GithubGhCliProvider::parse_remote_url("https://token@github.com/owner/repo.git"),
            Some(GitProviderRepository {
                host: "github.com".to_string(),
                owner: "owner".to_string(),
                name: "repo".to_string(),
            })
        );
    }

    #[test]
    fn build_gh_args_adds_hostname_only_when_present() {
        assert_eq!(
            GithubGhCliProvider::build_gh_args(Some("github.mycorp.com"), &["api", "repos/x/y"]),
            vec![
                "--hostname".to_string(),
                "github.mycorp.com".to_string(),
                "api".to_string(),
                "repos/x/y".to_string(),
            ]
        );
        assert_eq!(
            GithubGhCliProvider::build_gh_args(None, &["auth", "status"]),
            vec!["auth".to_string(), "status".to_string()]
        );
    }
}
