use anyhow::{anyhow, Result};
use host_domain::{
    BeadsCheck, RepoStoreAttachmentHealth, RepoStoreHealth, RepoStoreHealthCategory,
    RepoStoreHealthStatus, RepoStoreSharedServerHealth, RepoStoreSharedServerOwnershipState,
    RuntimeCheck, SystemCheck,
};
use host_infra_system::{
    required_command_error, run_command_allow_failure_with_env, version_command, GlobalConfig,
};
use std::path::Path;
use std::time::{Duration, Instant};

use super::service_core::CachedRuntimeCheck;
use super::AppService;

const RUNTIME_CHECK_CACHE_TTL: Duration = Duration::from_secs(5 * 60);
const GH_NON_INTERACTIVE_ENV: [(&str, &str); 1] = [("GH_PROMPT_DISABLED", "1")];

fn build_beads_check(repo_store_health: RepoStoreHealth) -> BeadsCheck {
    let beads_error = (!repo_store_health.is_ready
        && !matches!(
            repo_store_health.status,
            RepoStoreHealthStatus::Initializing
        ))
    .then(|| repo_store_health.detail.clone())
    .flatten();

    BeadsCheck {
        beads_ok: repo_store_health.is_ready,
        beads_path: repo_store_health.attachment.path.clone(),
        beads_error,
        repo_store_health,
    }
}

fn missing_bd_repo_store_health(detail: String) -> RepoStoreHealth {
    RepoStoreHealth {
        category: RepoStoreHealthCategory::AttachmentVerificationFailed,
        status: RepoStoreHealthStatus::Blocking,
        is_ready: false,
        detail: Some(detail),
        attachment: RepoStoreAttachmentHealth {
            path: None,
            database_name: None,
        },
        shared_server: RepoStoreSharedServerHealth {
            host: None,
            port: None,
            ownership_state: RepoStoreSharedServerOwnershipState::Unavailable,
        },
    }
}

fn probe_github_auth_status() -> (bool, Option<String>, Option<String>) {
    let result = run_command_allow_failure_with_env(
        "gh",
        &["auth", "status", "--hostname", "github.com"],
        None,
        &GH_NON_INTERACTIVE_ENV,
    );
    let Ok((ok, stdout, stderr)) = result else {
        return (
            false,
            None,
            Some("Failed to query GitHub authentication status.".to_string()),
        );
    };

    let combined = if stderr.trim().is_empty() {
        stdout.trim().to_string()
    } else if stdout.trim().is_empty() {
        stderr.trim().to_string()
    } else {
        format!("{}\n{}", stdout.trim(), stderr.trim())
    };

    if ok {
        return (true, parse_github_auth_login(combined.as_str()), None);
    }

    let detail = if combined.is_empty() {
        "GitHub authentication is not configured. Run `gh auth login`.".to_string()
    } else {
        combined
    };
    (false, None, Some(detail))
}

fn parse_github_auth_login(output: &str) -> Option<String> {
    let account_marker = "account ";
    let marker_index = output.find(account_marker)?;
    let login_start = marker_index + account_marker.len();
    let remainder = output.get(login_start..)?.trim_start();
    let login = remainder
        .split(|character: char| character.is_whitespace() || character == '(' || character == '\'')
        .next()
        .unwrap_or_default()
        .trim();
    if login.is_empty() {
        None
    } else {
        Some(login.to_string())
    }
}

impl AppService {
    pub fn runtime_check(&self) -> Result<RuntimeCheck> {
        self.runtime_check_with_refresh(false)
    }

    pub fn runtime_check_with_refresh(&self, force_refresh: bool) -> Result<RuntimeCheck> {
        if !force_refresh {
            if let Some(cached) = self.cached_runtime_check()? {
                return Ok(cached);
            }
        }

        let runtime = self.probe_runtime_check()?;
        self.update_runtime_check_cache(runtime.clone())?;
        Ok(runtime)
    }

    fn probe_runtime_check(&self) -> Result<RuntimeCheck> {
        let git_error = required_command_error("git");
        let gh_error = required_command_error("gh");
        let git_ok = git_error.is_none();
        let gh_ok = gh_error.is_none();
        let (gh_auth_ok, gh_auth_login, gh_auth_error) = if gh_ok {
            probe_github_auth_status()
        } else {
            (false, None, gh_error.clone())
        };
        let config = self.config_store.load()?;
        let runtimes = self
            .runtime_registry
            .definitions()
            .into_iter()
            .map(|definition| {
                let enabled = config
                    .agent_runtimes
                    .get(definition.kind().as_str())
                    .map(|runtime| runtime.enabled)
                    .or_else(|| {
                        GlobalConfig::default()
                            .agent_runtimes
                            .get(definition.kind().as_str())
                            .map(|runtime| runtime.enabled)
                    })
                    .unwrap_or(false);
                let mut health = self
                    .runtime_registry
                    .runtime(definition.kind())
                    .map(|runtime| runtime.runtime_health())?;
                health.enabled = enabled;
                Ok(health)
            })
            .collect::<Result<Vec<_>>>()?;

        let mut errors = Vec::new();
        if let Some(error) = git_error {
            errors.push(error);
        }
        if let Some(error) = gh_error {
            errors.push(error);
        }
        for runtime in &runtimes {
            if runtime.enabled {
                if let Some(error) = runtime.error.as_ref() {
                    errors.push(error.clone());
                }
            }
        }

        Ok(RuntimeCheck {
            git_ok,
            git_version: version_command("git", &["--version"]),
            gh_ok,
            gh_version: version_command("gh", &["--version"]),
            gh_auth_ok,
            gh_auth_login,
            gh_auth_error,
            runtimes,
            errors,
        })
    }

    fn cached_runtime_check(&self) -> Result<Option<RuntimeCheck>> {
        let mut cache = self
            .runtime_check_cache
            .lock()
            .map_err(|_| anyhow!("Runtime check cache lock poisoned in `cached_runtime_check`"))?;
        if let Some(entry) = cache.as_ref() {
            if entry.checked_at.elapsed() <= RUNTIME_CHECK_CACHE_TTL {
                return Ok(Some(entry.value.clone()));
            }
        }
        *cache = None;
        Ok(None)
    }

    fn update_runtime_check_cache(&self, check: RuntimeCheck) -> Result<()> {
        let mut cache = self.runtime_check_cache.lock().map_err(|_| {
            anyhow!("Runtime check cache lock poisoned in `update_runtime_check_cache`")
        })?;
        *cache = Some(CachedRuntimeCheck {
            checked_at: Instant::now(),
            value: check,
        });
        Ok(())
    }

    pub fn beads_check(&self, repo_path: &str) -> Result<BeadsCheck> {
        if let Some(error) = required_command_error("bd") {
            return Ok(build_beads_check(missing_bd_repo_store_health(error)));
        }

        let repo = Path::new(repo_path);
        let repo_store_health = self.task_store.diagnose_repo_store(repo)?;
        Ok(build_beads_check(repo_store_health))
    }

    pub fn system_check(&self, repo_path: &str) -> Result<SystemCheck> {
        let runtime = self.runtime_check()?;
        let beads = self.beads_check(repo_path)?;
        let mut errors = runtime.errors;
        if let Some(beads_error) = beads.beads_error.as_deref() {
            errors.push(format!("beads: {beads_error}"));
        }

        Ok(SystemCheck {
            git_ok: runtime.git_ok,
            git_version: runtime.git_version,
            gh_ok: runtime.gh_ok,
            gh_version: runtime.gh_version,
            gh_auth_ok: runtime.gh_auth_ok,
            gh_auth_login: runtime.gh_auth_login,
            gh_auth_error: runtime.gh_auth_error,
            runtimes: runtime.runtimes,
            repo_store_health: beads.repo_store_health.clone(),
            beads_ok: beads.beads_ok,
            beads_path: beads.beads_path,
            beads_error: beads.beads_error,
            errors,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::super::service_core::CachedRuntimeCheck;
    use super::super::test_support::build_service_with_state;
    use super::*;
    use host_domain::{RuntimeCheck, RuntimeHealth};
    use std::time::{Duration, Instant};

    #[test]
    fn module_runtime_check_returns_cached_value_when_fresh() {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let cached = RuntimeCheck {
            git_ok: false,
            git_version: Some("cached-git-sentinel".to_string()),
            gh_ok: false,
            gh_version: Some("cached-gh-sentinel".to_string()),
            gh_auth_ok: false,
            gh_auth_login: None,
            gh_auth_error: Some("cached-gh-auth-sentinel".to_string()),
            runtimes: vec![RuntimeHealth {
                kind: "opencode".to_string(),
                enabled: true,
                ok: false,
                version: Some("cached-opencode-sentinel".to_string()),
                error: None,
            }],
            errors: vec!["cached-runtime-sentinel".to_string()],
        };
        {
            let mut cache = service
                .runtime_check_cache
                .lock()
                .expect("runtime cache lock poisoned");
            *cache = Some(CachedRuntimeCheck {
                checked_at: Instant::now(),
                value: cached.clone(),
            });
        }

        let runtime = service
            .runtime_check()
            .expect("runtime check should use cached entry");
        assert_eq!(runtime.git_version, cached.git_version);
        assert_eq!(
            runtime
                .runtimes
                .iter()
                .find(|entry| entry.kind == "opencode")
                .and_then(|entry| entry.version.as_deref()),
            cached
                .runtimes
                .iter()
                .find(|entry| entry.kind == "opencode")
                .and_then(|entry| entry.version.as_deref())
        );
        assert_eq!(runtime.errors, cached.errors);
    }

    #[test]
    fn module_runtime_check_force_refresh_bypasses_cache() {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let sentinel_error = "cached-runtime-sentinel".to_string();
        {
            let mut cache = service
                .runtime_check_cache
                .lock()
                .expect("runtime cache lock poisoned");
            *cache = Some(CachedRuntimeCheck {
                checked_at: Instant::now(),
                value: RuntimeCheck {
                    git_ok: false,
                    git_version: Some("cached-git-sentinel".to_string()),
                    gh_ok: false,
                    gh_version: Some("cached-gh-sentinel".to_string()),
                    gh_auth_ok: false,
                    gh_auth_login: None,
                    gh_auth_error: Some("cached-gh-auth-sentinel".to_string()),
                    runtimes: vec![RuntimeHealth {
                        kind: "opencode".to_string(),
                        enabled: true,
                        ok: false,
                        version: Some("cached-opencode-sentinel".to_string()),
                        error: None,
                    }],
                    errors: vec![sentinel_error.clone()],
                },
            });
        }

        let runtime = service
            .runtime_check_with_refresh(true)
            .expect("runtime check should bypass cache when forced");
        assert!(!runtime.errors.contains(&sentinel_error));
        assert_ne!(runtime.git_version.as_deref(), Some("cached-git-sentinel"));
        assert_ne!(
            runtime
                .runtimes
                .iter()
                .find(|entry| entry.kind == "opencode")
                .and_then(|entry| entry.version.as_deref()),
            Some("cached-opencode-sentinel")
        );
    }

    #[test]
    fn module_runtime_check_reports_disabled_runtime_cli_health_without_failing() {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);

        let runtime = service
            .runtime_check_with_refresh(true)
            .expect("runtime check should include disabled runtimes");

        assert!(runtime
            .runtimes
            .iter()
            .any(|entry| entry.kind == "opencode"));
        let codex_health = runtime
            .runtimes
            .iter()
            .find(|entry| entry.kind == "codex")
            .expect("disabled Codex CLI health should still be reported");
        assert!(!codex_health.enabled);
        assert!(!runtime
            .errors
            .iter()
            .any(|error| error.to_lowercase().contains("codex")));
    }

    #[test]
    fn module_runtime_check_refreshes_when_cache_is_stale() {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let sentinel_error = "cached-runtime-sentinel".to_string();
        {
            let mut cache = service
                .runtime_check_cache
                .lock()
                .expect("runtime cache lock poisoned");
            *cache = Some(CachedRuntimeCheck {
                checked_at: Instant::now() - (RUNTIME_CHECK_CACHE_TTL + Duration::from_secs(1)),
                value: RuntimeCheck {
                    git_ok: false,
                    git_version: Some("cached-git-sentinel".to_string()),
                    gh_ok: false,
                    gh_version: Some("cached-gh-sentinel".to_string()),
                    gh_auth_ok: false,
                    gh_auth_login: None,
                    gh_auth_error: Some("cached-gh-auth-sentinel".to_string()),
                    runtimes: vec![RuntimeHealth {
                        kind: "opencode".to_string(),
                        enabled: true,
                        ok: false,
                        version: Some("cached-opencode-sentinel".to_string()),
                        error: None,
                    }],
                    errors: vec![sentinel_error.clone()],
                },
            });
        }

        let runtime = service
            .runtime_check()
            .expect("runtime check should refresh stale cache entries");
        assert!(!runtime.errors.contains(&sentinel_error));
        assert_ne!(runtime.git_version.as_deref(), Some("cached-git-sentinel"));
        assert_ne!(
            runtime
                .runtimes
                .iter()
                .find(|entry| entry.kind == "opencode")
                .and_then(|entry| entry.version.as_deref()),
            Some("cached-opencode-sentinel")
        );
    }
}
