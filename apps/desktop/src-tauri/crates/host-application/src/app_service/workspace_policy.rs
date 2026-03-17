use super::AppService;
use anyhow::{anyhow, Result};
use chrono::{DateTime, Utc};
use host_domain::WorkspaceRecord;
use host_infra_system::{
    hook_set_fingerprint, normalize_hook_set, AgentDefaults, ChatSettings, GitTargetBranch,
    HookSet, PromptOverrides, RepoConfig, RepoGitConfig,
};
use std::collections::HashMap;
use std::path::Path;
use std::time::{Duration, SystemTime};
use uuid::Uuid;

const HOOK_TRUST_CHALLENGE_TTL: Duration = Duration::from_secs(120);

#[derive(Debug, Clone, Default)]
pub struct RepoConfigUpdate {
    pub default_runtime_kind: Option<String>,
    pub worktree_base_path: Option<String>,
    pub branch_prefix: Option<String>,
    pub default_target_branch: Option<GitTargetBranch>,
    pub git: Option<RepoGitConfig>,
    pub worktree_file_copies: Option<Vec<String>>,
    pub prompt_overrides: Option<PromptOverrides>,
    pub agent_defaults: Option<AgentDefaults>,
}

#[derive(Debug, Clone)]
pub struct RepoSettingsUpdate {
    pub default_runtime_kind: Option<String>,
    pub worktree_base_path: Option<String>,
    pub branch_prefix: Option<String>,
    pub default_target_branch: Option<GitTargetBranch>,
    pub git: Option<RepoGitConfig>,
    pub trusted_hooks: bool,
    pub hooks: Option<HookSet>,
    pub worktree_file_copies: Option<Vec<String>>,
    pub prompt_overrides: Option<PromptOverrides>,
    pub agent_defaults: Option<AgentDefaults>,
}

#[derive(Debug, Clone)]
pub struct HookTrustConfirmationRequest {
    pub repo_path: String,
    pub hooks: HookSet,
}

pub trait HookTrustConfirmationPort: Send {
    fn confirm_trusted_hooks(&self, request: &HookTrustConfirmationRequest) -> Result<()>;
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedHookTrustChallenge {
    pub nonce: String,
    pub repo_path: String,
    pub fingerprint: String,
    pub expires_at: DateTime<Utc>,
    pub pre_start_count: usize,
    pub post_complete_count: usize,
}

#[derive(Debug, Clone)]
pub(super) struct HookTrustChallenge {
    repo_path: String,
    fingerprint: String,
    expires_at: SystemTime,
}

impl AppService {
    pub fn workspace_merge_repo_config(
        &self,
        repo_path: &str,
        update: RepoConfigUpdate,
    ) -> Result<WorkspaceRecord> {
        let existing = self.workspace_get_repo_config_optional(repo_path)?;
        let defaults = RepoConfig::default();
        let repo_config = RepoConfig {
            default_runtime_kind: update
                .default_runtime_kind
                .or_else(|| {
                    existing
                        .as_ref()
                        .map(|entry| entry.default_runtime_kind.clone())
                })
                .unwrap_or(defaults.default_runtime_kind),
            worktree_base_path: update.worktree_base_path.or_else(|| {
                existing
                    .as_ref()
                    .and_then(|entry| entry.worktree_base_path.clone())
            }),
            branch_prefix: update
                .branch_prefix
                .or_else(|| existing.as_ref().map(|entry| entry.branch_prefix.clone()))
                .unwrap_or(defaults.branch_prefix),
            default_target_branch: update
                .default_target_branch
                .or_else(|| {
                    existing
                        .as_ref()
                        .map(|entry| entry.default_target_branch.clone())
                })
                .unwrap_or(defaults.default_target_branch),
            git: update
                .git
                .or_else(|| existing.as_ref().map(|entry| entry.git.clone()))
                .unwrap_or_default(),
            trusted_hooks: existing.as_ref().is_some_and(|entry| entry.trusted_hooks),
            trusted_hooks_fingerprint: existing
                .as_ref()
                .and_then(|entry| entry.trusted_hooks_fingerprint.clone()),
            hooks: existing
                .as_ref()
                .map(|entry| entry.hooks.clone())
                .unwrap_or_default(),
            worktree_file_copies: update
                .worktree_file_copies
                .or_else(|| {
                    existing
                        .as_ref()
                        .map(|entry| entry.worktree_file_copies.clone())
                })
                .unwrap_or_default(),
            prompt_overrides: update
                .prompt_overrides
                .or_else(|| {
                    existing
                        .as_ref()
                        .map(|entry| entry.prompt_overrides.clone())
                })
                .unwrap_or_default(),
            agent_defaults: update
                .agent_defaults
                .or_else(|| existing.as_ref().map(|entry| entry.agent_defaults.clone()))
                .unwrap_or_default(),
        };

        self.workspace_update_repo_config(repo_path, repo_config)
    }

    pub fn workspace_save_repo_settings<P: HookTrustConfirmationPort + ?Sized>(
        &self,
        repo_path: &str,
        settings: RepoSettingsUpdate,
        confirmation_port: &P,
    ) -> Result<WorkspaceRecord> {
        let existing = self
            .workspace_get_repo_config_optional(repo_path)?
            .unwrap_or_default();

        let (normalized_hooks, trusted_hooks_fingerprint) = self
            .normalize_hooks_with_trust_confirmation(
                repo_path,
                &existing,
                settings.trusted_hooks,
                settings.hooks.unwrap_or_else(|| existing.hooks.clone()),
                confirmation_port,
            )?;

        let final_repo_config = RepoConfig {
            default_runtime_kind: normalize_runtime_kind(settings.default_runtime_kind)?
                .unwrap_or(existing.default_runtime_kind),
            worktree_base_path: settings.worktree_base_path.or(existing.worktree_base_path),
            branch_prefix: settings.branch_prefix.unwrap_or(existing.branch_prefix),
            default_target_branch: settings
                .default_target_branch
                .unwrap_or(existing.default_target_branch),
            git: settings.git.unwrap_or(existing.git),
            trusted_hooks: settings.trusted_hooks,
            trusted_hooks_fingerprint,
            hooks: normalized_hooks,
            worktree_file_copies: settings
                .worktree_file_copies
                .unwrap_or(existing.worktree_file_copies),
            prompt_overrides: settings
                .prompt_overrides
                .unwrap_or(existing.prompt_overrides),
            agent_defaults: settings.agent_defaults.unwrap_or(existing.agent_defaults),
        };

        self.workspace_update_repo_config(repo_path, final_repo_config)
    }

    pub fn workspace_prepare_trusted_hooks_challenge(
        &self,
        repo_path: &str,
    ) -> Result<PreparedHookTrustChallenge> {
        let repo_config = self.workspace_get_repo_config(repo_path)?;
        let canonical_repo_path = canonical_repo_key(repo_path);
        let fingerprint = hook_set_fingerprint(&repo_config.hooks);
        let nonce = format!("hooks-trust-{}", Uuid::new_v4().simple());
        let expires_at = SystemTime::now()
            .checked_add(HOOK_TRUST_CHALLENGE_TTL)
            .ok_or_else(|| anyhow!("Failed to allocate hook trust challenge window."))?;

        {
            let mut challenges = self.hook_trust_challenges.lock().map_err(|_| {
                anyhow!("Hook trust challenge lock poisoned in `workspace_prepare_trusted_hooks_challenge`")
            })?;
            prune_expired_hook_trust_challenges(&mut challenges);
            challenges.insert(
                nonce.clone(),
                HookTrustChallenge {
                    repo_path: canonical_repo_path.clone(),
                    fingerprint: fingerprint.clone(),
                    expires_at,
                },
            );
        }

        Ok(PreparedHookTrustChallenge {
            nonce,
            repo_path: canonical_repo_path,
            fingerprint,
            expires_at: DateTime::<Utc>::from(expires_at),
            pre_start_count: repo_config.hooks.pre_start.len(),
            post_complete_count: repo_config.hooks.post_complete.len(),
        })
    }

    pub fn workspace_save_settings_snapshot<P: HookTrustConfirmationPort + ?Sized>(
        &self,
        theme: String,
        git: host_infra_system::GlobalGitConfig,
        chat: ChatSettings,
        mut repos: HashMap<String, RepoConfig>,
        global_prompt_overrides: PromptOverrides,
        confirmation_port: &P,
    ) -> Result<Vec<WorkspaceRecord>> {
        for (repo_path, repo_config) in repos.iter_mut() {
            let existing = self
                .workspace_get_repo_config_optional(repo_path)?
                .unwrap_or_default();
            let submitted_hooks = std::mem::take(&mut repo_config.hooks);
            let (normalized_hooks, trusted_hooks_fingerprint) = self
                .normalize_hooks_with_trust_confirmation(
                    repo_path,
                    &existing,
                    repo_config.trusted_hooks,
                    submitted_hooks,
                    confirmation_port,
                )?;
            repo_config.hooks = normalized_hooks;
            repo_config.trusted_hooks_fingerprint = trusted_hooks_fingerprint;
        }

        self.workspace_persist_settings_snapshot(theme, git, chat, repos, global_prompt_overrides)?;
        self.workspace_list()
    }

    pub fn workspace_set_trusted_hooks<P: HookTrustConfirmationPort + ?Sized>(
        &self,
        repo_path: &str,
        trusted: bool,
        challenge_nonce: Option<&str>,
        challenge_fingerprint: Option<&str>,
        confirmation_port: &P,
    ) -> Result<WorkspaceRecord> {
        if !trusted {
            return self.workspace_persist_trusted_hooks(repo_path, false, None);
        }

        let nonce = challenge_nonce
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| anyhow!("Hook trust confirmation requires challenge nonce."))?;
        let expected_fingerprint = challenge_fingerprint
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| anyhow!("Hook trust confirmation requires challenge fingerprint."))?;

        let canonical_repo_path = canonical_repo_key(repo_path);
        let challenge = {
            let mut challenges = self.hook_trust_challenges.lock().map_err(|_| {
                anyhow!("Hook trust challenge lock poisoned in `workspace_set_trusted_hooks`")
            })?;
            prune_expired_hook_trust_challenges(&mut challenges);
            let Some(challenge) = challenges.remove(nonce) else {
                return Err(anyhow!(
                    "Hook trust challenge is missing or expired. Retry confirmation."
                ));
            };

            validate_trust_challenge_entry(
                &challenge,
                canonical_repo_path.as_str(),
                expected_fingerprint,
                SystemTime::now(),
            )?;

            challenge
        };

        let repo_config = self.workspace_get_repo_config(repo_path)?;
        let latest_fingerprint = hook_set_fingerprint(&repo_config.hooks);
        if latest_fingerprint != challenge.fingerprint {
            return Err(anyhow!(
                "Hook commands changed after challenge generation. Request trust confirmation again."
            ));
        }

        confirmation_port.confirm_trusted_hooks(&HookTrustConfirmationRequest {
            repo_path: canonical_repo_path,
            hooks: repo_config.hooks.clone(),
        })?;

        self.workspace_persist_trusted_hooks(repo_path, true, Some(challenge.fingerprint.as_str()))
    }

    fn normalize_hooks_with_trust_confirmation<P: HookTrustConfirmationPort + ?Sized>(
        &self,
        repo_path: &str,
        existing: &RepoConfig,
        trusted_hooks: bool,
        hooks: HookSet,
        confirmation_port: &P,
    ) -> Result<(HookSet, Option<String>)> {
        let normalized_hooks = normalize_hook_set(hooks);
        let hooks_fingerprint = hook_set_fingerprint(&normalized_hooks);
        let trust_already_approved_for_same_hooks = existing.trusted_hooks
            && existing.hooks == normalized_hooks
            && existing.trusted_hooks_fingerprint.as_deref() == Some(hooks_fingerprint.as_str());

        if trusted_hooks && !trust_already_approved_for_same_hooks {
            confirmation_port.confirm_trusted_hooks(&HookTrustConfirmationRequest {
                repo_path: canonical_repo_key(repo_path),
                hooks: normalized_hooks.clone(),
            })?;
        }

        let trusted_hooks_fingerprint = if trusted_hooks {
            Some(hooks_fingerprint)
        } else {
            None
        };

        Ok((normalized_hooks, trusted_hooks_fingerprint))
    }
}

fn normalize_runtime_kind(value: Option<String>) -> Result<Option<String>> {
    let Some(runtime_kind) = value else {
        return Ok(None);
    };

    let trimmed = runtime_kind.trim();
    if trimmed.is_empty() {
        return Err(anyhow!("defaultRuntimeKind cannot be blank"));
    }

    Ok(Some(trimmed.to_string()))
}

fn canonical_repo_key(repo_path: &str) -> String {
    std::fs::canonicalize(Path::new(repo_path))
        .ok()
        .and_then(|path| path.to_str().map(|value| value.to_string()))
        .unwrap_or_else(|| repo_path.trim().to_string())
}

fn prune_expired_hook_trust_challenges(challenges: &mut HashMap<String, HookTrustChallenge>) {
    let now = SystemTime::now();
    challenges.retain(|_, challenge| challenge.expires_at > now);
}

fn validate_trust_challenge_entry(
    challenge: &HookTrustChallenge,
    canonical_repo_path: &str,
    expected_fingerprint: &str,
    now: SystemTime,
) -> Result<()> {
    if challenge.repo_path != canonical_repo_path {
        return Err(anyhow!(
            "Hook trust challenge repository mismatch. Retry confirmation."
        ));
    }
    if challenge.fingerprint != expected_fingerprint {
        return Err(anyhow!(
            "Hook trust challenge fingerprint mismatch. Retry confirmation."
        ));
    }
    if challenge.expires_at <= now {
        return Err(anyhow!("Hook trust challenge expired. Retry confirmation."));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        canonical_repo_key, normalize_hook_set, validate_trust_challenge_entry, AppService,
        HookTrustChallenge, RepoConfigUpdate, RepoSettingsUpdate,
    };
    use crate::app_service::test_support::{
        lock_env, set_env_var, unique_temp_path, EnvVarGuard, FakeTaskStore, TaskStoreState,
    };
    use anyhow::{anyhow, Result};
    use host_domain::TaskStore;
    use host_infra_system::{
        hook_set_fingerprint, AppConfigStore, ChatSettings, GitCliPort, HookSet, PromptOverride,
        RepoConfig,
    };
    use std::fs;
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, SystemTime};

    use super::{HookTrustConfirmationPort, HookTrustConfirmationRequest};

    #[derive(Default)]
    struct RecordingHookTrustConfirmationPort {
        requests: Mutex<Vec<HookTrustConfirmationRequest>>,
        next_error: Mutex<Option<String>>,
    }

    impl RecordingHookTrustConfirmationPort {
        fn with_error(message: &str) -> Self {
            Self {
                requests: Mutex::new(Vec::new()),
                next_error: Mutex::new(Some(message.to_string())),
            }
        }

        fn request_count(&self) -> usize {
            self.requests.lock().expect("request lock poisoned").len()
        }
    }

    impl HookTrustConfirmationPort for RecordingHookTrustConfirmationPort {
        fn confirm_trusted_hooks(&self, request: &HookTrustConfirmationRequest) -> Result<()> {
            self.requests
                .lock()
                .expect("request lock poisoned")
                .push(request.clone());
            if let Some(error) = self.next_error.lock().expect("error lock poisoned").take() {
                return Err(anyhow!(error));
            }
            Ok(())
        }
    }

    struct WorkspacePolicyFixture {
        service: AppService,
        repo_path: String,
        root: PathBuf,
        _env_lock: std::sync::MutexGuard<'static, ()>,
        _home_guard: EnvVarGuard,
    }

    impl Drop for WorkspacePolicyFixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn setup_fixture(prefix: &str, hooks: HookSet) -> WorkspacePolicyFixture {
        let env_lock = lock_env();
        let root = unique_temp_path(prefix);
        fs::create_dir_all(&root).expect("fixture root should exist");
        let home_guard = set_env_var("HOME", root.to_string_lossy().as_ref());
        let repo = root.join("repo");
        fs::create_dir_all(repo.join(".git")).expect("fake git workspace should exist");
        let repo_path = repo.to_string_lossy().to_string();

        let config_store = AppConfigStore::from_path(root.join("config.json"));
        config_store
            .add_workspace(repo_path.as_str())
            .expect("workspace should be allowlisted");
        config_store
            .update_repo_hooks(repo_path.as_str(), hooks)
            .expect("hooks should persist");

        let task_store: Arc<dyn TaskStore> = Arc::new(FakeTaskStore {
            state: Arc::new(Mutex::new(TaskStoreState::default())),
        });
        let service =
            AppService::with_git_port(task_store, config_store, Arc::new(GitCliPort::new()));

        WorkspacePolicyFixture {
            service,
            repo_path,
            root,
            _env_lock: env_lock,
            _home_guard: home_guard,
        }
    }

    fn insert_challenge(
        service: &AppService,
        nonce: &str,
        challenge: HookTrustChallenge,
    ) -> Result<()> {
        let mut challenges = service
            .hook_trust_challenges
            .lock()
            .map_err(|_| anyhow!("challenge lock poisoned"))?;
        challenges.insert(nonce.to_string(), challenge);
        Ok(())
    }

    #[test]
    fn workspace_merge_repo_config_preserves_existing_trust_and_hooks() -> Result<()> {
        let fixture = setup_fixture(
            "merge-repo-config",
            HookSet {
                pre_start: vec!["echo pre".to_string()],
                post_complete: vec!["echo post".to_string()],
            },
        );
        let trusted_fingerprint = hook_set_fingerprint(
            &fixture
                .service
                .workspace_get_repo_config(&fixture.repo_path)?
                .hooks,
        );
        fixture.service.workspace_update_repo_config(
            fixture.repo_path.as_str(),
            RepoConfig {
                trusted_hooks: true,
                trusted_hooks_fingerprint: Some(trusted_fingerprint.clone()),
                branch_prefix: "abc".to_string(),
                ..fixture
                    .service
                    .workspace_get_repo_config(&fixture.repo_path)?
            },
        )?;

        fixture.service.workspace_merge_repo_config(
            fixture.repo_path.as_str(),
            RepoConfigUpdate {
                default_target_branch: Some(host_infra_system::GitTargetBranch {
                    remote: Some("origin".to_string()),
                    branch: "release".to_string(),
                }),
                ..RepoConfigUpdate::default()
            },
        )?;

        let updated = fixture
            .service
            .workspace_get_repo_config(&fixture.repo_path)?;
        assert_eq!(updated.default_target_branch.canonical(), "origin/release");
        assert_eq!(updated.branch_prefix, "abc");
        assert!(updated.trusted_hooks);
        assert_eq!(
            updated.trusted_hooks_fingerprint.as_deref(),
            Some(trusted_fingerprint.as_str())
        );
        assert_eq!(updated.hooks.pre_start, vec!["echo pre".to_string()]);
        Ok(())
    }

    #[test]
    fn workspace_save_repo_settings_rejects_blank_default_runtime_kind() {
        let fixture = setup_fixture("blank-runtime-kind", HookSet::default());
        let confirmation = RecordingHookTrustConfirmationPort::default();

        let error = fixture
            .service
            .workspace_save_repo_settings(
                fixture.repo_path.as_str(),
                RepoSettingsUpdate {
                    default_runtime_kind: Some("   ".to_string()),
                    worktree_base_path: None,
                    branch_prefix: None,
                    default_target_branch: None,
                    git: None,
                    trusted_hooks: false,
                    hooks: None,
                    worktree_file_copies: None,
                    prompt_overrides: None,
                    agent_defaults: None,
                },
                &confirmation,
            )
            .expect_err("blank runtime kind should fail");

        assert!(error
            .to_string()
            .contains("defaultRuntimeKind cannot be blank"));
    }

    #[test]
    fn workspace_save_repo_settings_trims_runtime_kind() -> Result<()> {
        let fixture = setup_fixture("trim-runtime-kind", HookSet::default());
        let confirmation = RecordingHookTrustConfirmationPort::default();

        fixture.service.workspace_save_repo_settings(
            fixture.repo_path.as_str(),
            RepoSettingsUpdate {
                default_runtime_kind: Some("  claude-code  ".to_string()),
                worktree_base_path: None,
                branch_prefix: None,
                default_target_branch: None,
                git: None,
                trusted_hooks: false,
                hooks: None,
                worktree_file_copies: None,
                prompt_overrides: None,
                agent_defaults: None,
            },
            &confirmation,
        )?;

        let persisted = fixture
            .service
            .workspace_get_repo_config(&fixture.repo_path)?;
        assert_eq!(persisted.default_runtime_kind, "claude-code");
        Ok(())
    }

    #[test]
    fn workspace_save_repo_settings_requires_trust_confirmation() -> Result<()> {
        let fixture = setup_fixture(
            "repo-settings-trust",
            HookSet {
                pre_start: vec![" echo pre ".to_string()],
                post_complete: vec!["echo post".to_string()],
            },
        );
        let confirmation = RecordingHookTrustConfirmationPort::with_error(
            "Hook trust confirmation was cancelled by the user.",
        );

        let error = fixture
            .service
            .workspace_save_repo_settings(
                fixture.repo_path.as_str(),
                RepoSettingsUpdate {
                    default_runtime_kind: None,
                    worktree_base_path: None,
                    branch_prefix: None,
                    default_target_branch: None,
                    git: None,
                    trusted_hooks: true,
                    hooks: Some(HookSet {
                        pre_start: vec!["  echo pre  ".to_string()],
                        post_complete: vec!["echo post".to_string()],
                    }),
                    worktree_file_copies: None,
                    prompt_overrides: None,
                    agent_defaults: None,
                },
                &confirmation,
            )
            .expect_err("trust enable should require confirmation");

        assert!(error.to_string().contains("cancelled"));
        assert_eq!(confirmation.request_count(), 1);

        let persisted = fixture
            .service
            .workspace_get_repo_config(&fixture.repo_path)?;
        assert!(!persisted.trusted_hooks);
        assert!(persisted.trusted_hooks_fingerprint.is_none());
        Ok(())
    }

    #[test]
    fn workspace_save_settings_snapshot_persists_trusted_fingerprint_after_confirmation(
    ) -> Result<()> {
        let fixture = setup_fixture(
            "snapshot-save-trust",
            HookSet {
                pre_start: vec![" echo pre ".to_string()],
                post_complete: vec!["echo post".to_string()],
            },
        );
        let confirmation = RecordingHookTrustConfirmationPort::default();

        let (theme, git, mut chat, mut repos, mut global_prompt_overrides) =
            fixture.service.workspace_get_settings_snapshot()?;
        chat.show_thinking_messages = true;
        global_prompt_overrides.insert(
            "system.shared.workflow_guards".to_string(),
            PromptOverride {
                template: "global workflow guards".to_string(),
                base_version: 1,
                enabled: true,
            },
        );
        let repo_key = canonical_repo_key(fixture.repo_path.as_str());
        let repo_config = repos
            .get_mut(repo_key.as_str())
            .ok_or_else(|| anyhow!("repo config missing"))?;
        repo_config.trusted_hooks = true;
        repo_config.hooks = HookSet {
            pre_start: vec!["  echo pre  ".to_string()],
            post_complete: vec!["echo post".to_string()],
        };
        repo_config.trusted_hooks_fingerprint = None;

        fixture.service.workspace_save_settings_snapshot(
            theme,
            git,
            chat,
            repos,
            global_prompt_overrides,
            &confirmation,
        )?;

        let persisted = fixture
            .service
            .workspace_get_repo_config(&fixture.repo_path)?;
        let normalized_hooks = HookSet {
            pre_start: vec!["echo pre".to_string()],
            post_complete: vec!["echo post".to_string()],
        };
        let expected_fingerprint = hook_set_fingerprint(&normalized_hooks);
        assert!(persisted.trusted_hooks);
        assert_eq!(persisted.hooks, normalized_hooks);
        assert_eq!(
            persisted.trusted_hooks_fingerprint.as_deref(),
            Some(expected_fingerprint.as_str())
        );
        assert_eq!(confirmation.request_count(), 1);
        Ok(())
    }

    #[test]
    fn workspace_save_settings_snapshot_persists_chat_settings_roundtrip() -> Result<()> {
        let fixture = setup_fixture("snapshot-chat-roundtrip", HookSet::default());
        let confirmation = RecordingHookTrustConfirmationPort::default();

        let (theme, git, mut chat, repos, global_prompt_overrides) =
            fixture.service.workspace_get_settings_snapshot()?;
        assert_eq!(chat, ChatSettings::default());
        chat.show_thinking_messages = true;

        fixture.service.workspace_save_settings_snapshot(
            theme,
            git,
            chat,
            repos,
            global_prompt_overrides,
            &confirmation,
        )?;

        let (
            _persisted_theme,
            _persisted_git,
            persisted_chat,
            _persisted_repos,
            _persisted_global_prompt_overrides,
        ) = fixture.service.workspace_get_settings_snapshot()?;
        assert!(persisted_chat.show_thinking_messages);
        assert_eq!(confirmation.request_count(), 0);
        Ok(())
    }

    #[test]
    fn workspace_set_trusted_hooks_rejects_expired_challenge_entries() -> Result<()> {
        let fixture = setup_fixture("expired-challenge", HookSet::default());
        let confirmation = RecordingHookTrustConfirmationPort::default();
        let nonce = "expired-nonce";
        let fingerprint = hook_set_fingerprint(&HookSet::default());
        insert_challenge(
            &fixture.service,
            nonce,
            HookTrustChallenge {
                repo_path: canonical_repo_key(fixture.repo_path.as_str()),
                fingerprint: fingerprint.clone(),
                expires_at: SystemTime::now()
                    .checked_sub(Duration::from_secs(1))
                    .ok_or_else(|| anyhow!("expired time should be valid"))?,
            },
        )?;

        let error = fixture
            .service
            .workspace_set_trusted_hooks(
                fixture.repo_path.as_str(),
                true,
                Some(nonce),
                Some(fingerprint.as_str()),
                &confirmation,
            )
            .expect_err("expired challenge should fail");
        assert!(error.to_string().contains("missing or expired"));
        Ok(())
    }

    #[test]
    fn workspace_set_trusted_hooks_rejects_repository_mismatch_and_consumes_nonce() -> Result<()> {
        let fixture = setup_fixture("repo-mismatch", HookSet::default());
        let confirmation = RecordingHookTrustConfirmationPort::default();
        let nonce = "nonce-repo-mismatch";
        let fingerprint = hook_set_fingerprint(&HookSet::default());
        insert_challenge(
            &fixture.service,
            nonce,
            HookTrustChallenge {
                repo_path: "/tmp/not-the-same-repo".to_string(),
                fingerprint: fingerprint.clone(),
                expires_at: SystemTime::now()
                    .checked_add(Duration::from_secs(60))
                    .ok_or_else(|| anyhow!("future time should be valid"))?,
            },
        )?;

        let mismatch = fixture
            .service
            .workspace_set_trusted_hooks(
                fixture.repo_path.as_str(),
                true,
                Some(nonce),
                Some(fingerprint.as_str()),
                &confirmation,
            )
            .expect_err("repo mismatch should fail");
        assert!(mismatch.to_string().contains("repository mismatch"));

        let replay = fixture
            .service
            .workspace_set_trusted_hooks(
                fixture.repo_path.as_str(),
                true,
                Some(nonce),
                Some(fingerprint.as_str()),
                &confirmation,
            )
            .expect_err("nonce should be consumed");
        assert!(replay.to_string().contains("missing or expired"));
        Ok(())
    }

    #[test]
    fn workspace_set_trusted_hooks_accepts_valid_challenge_and_persists_trust() -> Result<()> {
        let fixture = setup_fixture(
            "trust-happy-path",
            HookSet {
                pre_start: vec!["echo pre".to_string()],
                post_complete: vec!["echo post".to_string()],
            },
        );
        let confirmation = RecordingHookTrustConfirmationPort::default();
        let challenge = fixture
            .service
            .workspace_prepare_trusted_hooks_challenge(fixture.repo_path.as_str())?;

        fixture.service.workspace_set_trusted_hooks(
            fixture.repo_path.as_str(),
            true,
            Some(challenge.nonce.as_str()),
            Some(challenge.fingerprint.as_str()),
            &confirmation,
        )?;

        let repo_config = fixture
            .service
            .workspace_get_repo_config(&fixture.repo_path)?;
        assert!(repo_config.trusted_hooks);
        assert_eq!(
            repo_config.trusted_hooks_fingerprint.as_deref(),
            Some(challenge.fingerprint.as_str())
        );
        assert_eq!(confirmation.request_count(), 1);
        Ok(())
    }

    #[test]
    fn workspace_set_trusted_hooks_rejects_stale_challenge_after_hook_changes() -> Result<()> {
        let original_hooks = HookSet {
            pre_start: vec!["echo pre".to_string()],
            post_complete: Vec::new(),
        };
        let fixture = setup_fixture("stale-trust-challenge", original_hooks);
        let confirmation = RecordingHookTrustConfirmationPort::default();
        let challenge = fixture
            .service
            .workspace_prepare_trusted_hooks_challenge(fixture.repo_path.as_str())?;

        fixture.service.workspace_update_repo_hooks(
            fixture.repo_path.as_str(),
            HookSet {
                pre_start: vec!["echo changed".to_string()],
                post_complete: Vec::new(),
            },
        )?;

        let stale = fixture
            .service
            .workspace_set_trusted_hooks(
                fixture.repo_path.as_str(),
                true,
                Some(challenge.nonce.as_str()),
                Some(challenge.fingerprint.as_str()),
                &confirmation,
            )
            .expect_err("stale challenge should fail");
        assert!(stale
            .to_string()
            .contains("Hook commands changed after challenge generation"));
        Ok(())
    }

    #[test]
    fn workspace_set_trusted_hooks_disables_without_challenge() -> Result<()> {
        let hooks = HookSet {
            pre_start: vec!["echo pre".to_string()],
            post_complete: Vec::new(),
        };
        let fixture = setup_fixture("disable-trust", hooks.clone());
        let confirmation = RecordingHookTrustConfirmationPort::default();
        let fingerprint = hook_set_fingerprint(&hooks);
        fixture.service.workspace_persist_trusted_hooks(
            fixture.repo_path.as_str(),
            true,
            Some(fingerprint.as_str()),
        )?;

        fixture.service.workspace_set_trusted_hooks(
            fixture.repo_path.as_str(),
            false,
            None,
            None,
            &confirmation,
        )?;

        let repo_config = fixture
            .service
            .workspace_get_repo_config(&fixture.repo_path)?;
        assert!(!repo_config.trusted_hooks);
        assert!(repo_config.trusted_hooks_fingerprint.is_none());
        assert_eq!(confirmation.request_count(), 0);
        Ok(())
    }

    #[test]
    fn normalize_hook_set_trims_and_removes_blank_commands() {
        let normalized = normalize_hook_set(HookSet {
            pre_start: vec!["  echo pre  ".to_string(), "   ".to_string()],
            post_complete: vec!["".to_string(), " echo post ".to_string()],
        });
        assert_eq!(normalized.pre_start, vec!["echo pre".to_string()]);
        assert_eq!(normalized.post_complete, vec!["echo post".to_string()]);
    }

    #[test]
    fn validate_trust_challenge_entry_checks_repo_and_fingerprint_and_expiry() -> Result<()> {
        let now = SystemTime::now();
        let challenge = HookTrustChallenge {
            repo_path: "/repo".to_string(),
            fingerprint: "abc".to_string(),
            expires_at: now
                .checked_add(Duration::from_secs(5))
                .ok_or_else(|| anyhow!("challenge expiry"))?,
        };
        assert!(validate_trust_challenge_entry(&challenge, "/repo", "abc", now).is_ok());

        let repo_error = validate_trust_challenge_entry(&challenge, "/repo-2", "abc", now)
            .expect_err("repo mismatch should fail");
        assert!(repo_error.to_string().contains("repository mismatch"));

        let fingerprint_error = validate_trust_challenge_entry(&challenge, "/repo", "def", now)
            .expect_err("fingerprint mismatch should fail");
        assert!(fingerprint_error
            .to_string()
            .contains("fingerprint mismatch"));

        let expired = HookTrustChallenge {
            expires_at: now
                .checked_sub(Duration::from_secs(1))
                .ok_or_else(|| anyhow!("expired instant"))?,
            ..challenge
        };
        let expired_error = validate_trust_challenge_entry(&expired, "/repo", "abc", now)
            .expect_err("expired challenge should fail");
        assert!(expired_error.to_string().contains("expired"));
        Ok(())
    }

    #[test]
    fn canonical_repo_key_keeps_input_when_path_does_not_exist() {
        let missing_path = "/this/path/should/not/exist-for-openducktor";
        assert_eq!(canonical_repo_key(missing_path), missing_path.to_string());
    }
}
