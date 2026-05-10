use serde::Deserialize;
use std::collections::HashMap;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskCreatePayload {
    pub title: String,
    pub issue_type: String,
    pub priority: i32,
    pub description: Option<String>,
    pub labels: Option<Vec<String>>,
    pub ai_review_enabled: Option<bool>,
    pub parent_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskUpdatePayload {
    pub title: Option<String>,
    pub description: Option<String>,
    pub priority: Option<i32>,
    pub issue_type: Option<String>,
    pub ai_review_enabled: Option<bool>,
    pub labels: Option<Vec<String>>,
    pub assignee: Option<String>,
    pub parent_id: Option<String>,
    pub target_branch: Option<host_domain::GitTargetBranch>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownPayload {
    pub markdown: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanPayload {
    pub markdown: String,
    pub subtasks: Option<Vec<PlanSubtaskPayload>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanSubtaskPayload {
    pub title: String,
    pub issue_type: Option<String>,
    pub priority: Option<i32>,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildCompletePayload {
    pub summary: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestContentPayload {
    pub title: String,
    pub body: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDirectMergePayload {
    pub merge_method: host_domain::GitMergeMethod,
    pub squash_commit_message: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoConfigPayload {
    pub default_runtime_kind: Option<String>,
    pub worktree_base_path: Option<String>,
    pub branch_prefix: Option<String>,
    pub default_target_branch: Option<host_infra_system::GitTargetBranch>,
    pub git: Option<host_infra_system::RepoGitConfig>,
    pub dev_servers: Option<Vec<host_infra_system::RepoDevServerScript>>,
    pub worktree_copy_paths: Option<Vec<String>>,
    pub prompt_overrides: Option<host_infra_system::PromptOverrides>,
    pub agent_defaults: Option<host_infra_system::AgentDefaults>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoSettingsPayload {
    pub default_runtime_kind: Option<String>,
    pub worktree_base_path: Option<String>,
    pub branch_prefix: Option<String>,
    pub default_target_branch: Option<host_infra_system::GitTargetBranch>,
    pub git: Option<host_infra_system::RepoGitConfig>,
    pub hooks: Option<host_infra_system::HookSet>,
    pub dev_servers: Option<Vec<host_infra_system::RepoDevServerScript>>,
    pub worktree_copy_paths: Option<Vec<String>>,
    pub prompt_overrides: Option<host_infra_system::PromptOverrides>,
    pub agent_defaults: Option<host_infra_system::AgentDefaults>,
}

#[derive(Debug, Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsSnapshotPayload {
    pub theme: String,
    pub git: host_infra_system::GlobalGitConfig,
    pub general: host_infra_system::GeneralSettings,
    pub chat: host_infra_system::ChatSettings,
    pub reusable_prompts: Vec<host_infra_system::ReusablePrompt>,
    pub kanban: host_infra_system::KanbanSettings,
    pub autopilot: host_infra_system::AutopilotSettings,
    pub workspaces: HashMap<String, host_infra_system::RepoConfig>,
    pub global_prompt_overrides: host_infra_system::PromptOverrides,
}

#[cfg(test)]
mod tests {
    use super::*;
    use host_domain::TaskStatus;
    use serde_json::json;

    #[test]
    fn task_create_payload_deserialization_surfaces_missing_required_fields() {
        let payload = json!({
            "issueType": "task",
            "priority": 2
        });

        let error = serde_json::from_value::<TaskCreatePayload>(payload)
            .expect_err("missing title should fail deserialization");
        assert!(
            error.to_string().contains("title"),
            "deserialization error should mention missing title: {error}"
        );
    }

    #[test]
    fn plan_payload_deserialization_rejects_non_array_subtasks() {
        let payload = json!({
            "markdown": "## Plan",
            "subtasks": {
                "title": "Not an array payload"
            }
        });

        let error = serde_json::from_value::<PlanPayload>(payload)
            .expect_err("non-array subtasks should fail deserialization");
        assert!(
            error.to_string().contains("expected a sequence"),
            "deserialization error should preserve serde type detail: {error}"
        );
    }

    #[test]
    fn repo_payloads_deserialize_default_target_branch_field() {
        let config_payload = json!({
            "defaultTargetBranch": {
                "remote": "origin",
                "branch": "release"
            }
        });
        let parsed_config = serde_json::from_value::<RepoConfigPayload>(config_payload)
            .expect("repo config payload should deserialize");
        assert_eq!(
            parsed_config
                .default_target_branch
                .as_ref()
                .map(host_infra_system::GitTargetBranch::canonical)
                .as_deref(),
            Some("origin/release"),
        );

        let settings_payload = json!({
            "defaultTargetBranch": {
                "remote": "origin",
                "branch": "develop"
            }
        });
        let parsed_settings = serde_json::from_value::<RepoSettingsPayload>(settings_payload)
            .expect("repo settings payload should deserialize");
        assert_eq!(
            parsed_settings
                .default_target_branch
                .as_ref()
                .map(host_infra_system::GitTargetBranch::canonical)
                .as_deref(),
            Some("origin/develop"),
        );
    }

    #[test]
    fn repo_payloads_reject_legacy_string_default_target_branch_field() {
        let error = serde_json::from_value::<RepoConfigPayload>(json!({
            "defaultTargetBranch": "origin/release"
        }))
        .expect_err("legacy string target branch should fail deserialization");
        assert!(
            error.to_string().contains("invalid type"),
            "expected serde type error, got: {error}"
        );
    }

    #[test]
    fn task_direct_merge_payload_deserializes_camel_case_fields() {
        let payload = json!({
            "mergeMethod": "squash",
            "squashCommitMessage": "feat: add Microsoft login"
        });
        let parsed = serde_json::from_value::<TaskDirectMergePayload>(payload)
            .expect("direct merge payload should deserialize");

        assert!(matches!(
            parsed.merge_method,
            host_domain::GitMergeMethod::Squash
        ));
        assert_eq!(
            parsed.squash_commit_message.as_deref(),
            Some("feat: add Microsoft login")
        );
    }

    #[test]
    fn task_direct_merge_payload_allows_missing_squash_commit_message() {
        let payload = json!({
            "mergeMethod": "merge_commit"
        });
        let parsed = serde_json::from_value::<TaskDirectMergePayload>(payload)
            .expect("direct merge payload without squash message should deserialize");

        assert!(matches!(
            parsed.merge_method,
            host_domain::GitMergeMethod::MergeCommit
        ));
        assert_eq!(parsed.squash_commit_message, None);
    }

    #[test]
    fn task_status_deserialization_rejects_unknown_status() {
        let error = serde_json::from_value::<TaskStatus>(json!("backlog"))
            .expect_err("unknown status should fail deserialization");
        assert!(
            error.to_string().contains("unknown variant"),
            "status parse error should include variant details: {error}"
        );
    }
}
