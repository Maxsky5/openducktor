use super::*;
use chrono::{Duration as ChronoDuration, Utc};
use serde::Deserialize;
use std::collections::HashSet;

impl BeadsTaskStore {
    fn append_raw_issue_list(
        &self,
        value: serde_json::Value,
        metadata_namespace: &str,
        seen_task_ids: &mut HashSet<String>,
        tasks: &mut Vec<TaskCard>,
    ) -> Result<()> {
        for entry in value
            .as_array()
            .ok_or_else(|| anyhow!("bd list did not return an array"))?
        {
            let issue: RawIssue =
                RawIssue::deserialize(entry).context("Failed to decode task from bd list")?;
            if issue.issue_type == "event" || issue.issue_type == "gate" {
                continue;
            }

            if !seen_task_ids.insert(issue.id.clone()) {
                continue;
            }

            tasks.push(self.parse_task_card(issue, metadata_namespace)?);
        }

        Ok(())
    }

    fn finalize_task_cards(tasks: &mut [TaskCard]) {
        let mut subtasks_by_parent: HashMap<String, Vec<String>> = HashMap::new();
        for task in tasks.iter() {
            if let Some(parent_id) = &task.parent_id {
                subtasks_by_parent
                    .entry(parent_id.clone())
                    .or_default()
                    .push(task.id.clone());
            }
        }

        for task in tasks.iter_mut() {
            let mut subtasks = subtasks_by_parent.remove(&task.id).unwrap_or_default();
            subtasks.sort();
            task.subtask_ids = subtasks;
        }
    }

    pub(super) fn ensure_repo_initialized_impl(&self, repo_path: &Path) -> Result<()> {
        self.lifecycle.ensure_repo_initialized(repo_path)
    }

    pub(super) fn list_tasks_impl(&self, repo_path: &Path) -> Result<Vec<TaskCard>> {
        let metadata_namespace = self.current_metadata_namespace();
        let repo_key = Self::repo_key(repo_path);
        let (cached_tasks, cache_generation) =
            self.cached_task_list_and_generation(&repo_key, &metadata_namespace)?;
        if let Some(tasks) = cached_tasks {
            return Ok(tasks);
        }

        let value = self.run_bd_json(repo_path, &["list", "--all", "--limit", "0"])?;

        let mut tasks = Vec::new();
        let mut seen_task_ids = HashSet::new();
        self.append_raw_issue_list(value, &metadata_namespace, &mut seen_task_ids, &mut tasks)?;
        Self::finalize_task_cards(&mut tasks);

        self.cache_task_list_if_generation(
            &repo_key,
            &metadata_namespace,
            cache_generation,
            &tasks,
        )?;
        Ok(tasks)
    }

    pub(super) fn get_task_impl(&self, repo_path: &Path, task_id: &str) -> Result<TaskCard> {
        self.show_task(repo_path, task_id)
    }

    pub(super) fn list_tasks_for_kanban_impl(
        &self,
        repo_path: &Path,
        done_visible_days: i32,
    ) -> Result<Vec<TaskCard>> {
        if done_visible_days < 0 {
            return Err(anyhow!(
                "done_visible_days must be greater than or equal to 0"
            ));
        }

        let metadata_namespace = self.current_metadata_namespace();
        let repo_key = Self::repo_key(repo_path);
        let (cached_tasks, cache_generation) = self.cached_kanban_task_list_and_generation(
            &repo_key,
            &metadata_namespace,
            done_visible_days,
        )?;
        if let Some(tasks) = cached_tasks {
            return Ok(tasks);
        }

        let mut tasks = Vec::new();
        let mut seen_task_ids = HashSet::new();

        self.append_raw_issue_list(
            self.run_bd_json(repo_path, &["list", "--limit", "0"])?,
            &metadata_namespace,
            &mut seen_task_ids,
            &mut tasks,
        )?;

        if done_visible_days > 0 {
            let cutoff = Utc::now()
                .checked_sub_signed(ChronoDuration::days(i64::from(done_visible_days)))
                .ok_or_else(|| anyhow!("done_visible_days causes datetime underflow"))?
                .format("%Y-%m-%d")
                .to_string();
            self.append_raw_issue_list(
                self.run_bd_json(
                    repo_path,
                    &[
                        "list",
                        "--status",
                        "closed",
                        "--closed-after",
                        cutoff.as_str(),
                        "--limit",
                        "0",
                    ],
                )?,
                &metadata_namespace,
                &mut seen_task_ids,
                &mut tasks,
            )?;
        }

        Self::finalize_task_cards(&mut tasks);
        self.cache_kanban_task_list_if_generation(
            &repo_key,
            &metadata_namespace,
            done_visible_days,
            cache_generation,
            &tasks,
        )?;
        Ok(tasks)
    }

    pub(super) fn create_task_impl(
        &self,
        repo_path: &Path,
        input: CreateTaskInput,
    ) -> Result<TaskCard> {
        let mut args = vec![
            "create".to_string(),
            input.title,
            "--type".to_string(),
            input.issue_type.as_cli_value().to_string(),
            "--priority".to_string(),
            input.priority.to_string(),
        ];

        if let Some(description) = normalize_text_option(input.description) {
            args.push("--description".to_string());
            args.push(description);
        }

        let labels = normalize_labels(input.labels.unwrap_or_default());
        if !labels.is_empty() {
            args.push("--labels".to_string());
            args.push(labels.join(","));
        }

        if let Some(parent_id) = normalize_text_option(input.parent_id) {
            args.push("--parent".to_string());
            args.push(parent_id);
        }

        let arg_refs = args.iter().map(String::as_str).collect::<Vec<_>>();
        let value = self.run_bd_json(repo_path, &arg_refs)?;
        self.invalidate_task_list_cache(repo_path)?;
        let raw: RawIssue =
            serde_json::from_value(value).context("Failed to decode created issue")?;
        let created_id = raw.id.clone();

        let mut metadata_root = parse_metadata_root(raw.metadata);
        let namespace_key = self.current_metadata_namespace();
        let mut namespace_map = metadata_namespace(&metadata_root, &namespace_key)
            .cloned()
            .unwrap_or_default();

        namespace_map.insert(
            "qaRequired".to_string(),
            Value::Bool(input.ai_review_enabled.unwrap_or(true)),
        );

        self.persist_namespace(
            repo_path,
            &created_id,
            &namespace_key,
            &mut metadata_root,
            namespace_map,
        )?;

        self.show_task(repo_path, &created_id)
    }

    pub(super) fn update_task_impl(
        &self,
        repo_path: &Path,
        task_id: &str,
        patch: UpdateTaskPatch,
    ) -> Result<TaskCard> {
        let mut args = vec!["update".to_string()];

        if let Some(title) = patch.title {
            args.push("--title".to_string());
            args.push(title);
        }

        if let Some(description) = patch.description {
            args.push("--description".to_string());
            args.push(description);
        }

        if let Some(notes) = patch.notes {
            args.push("--notes".to_string());
            args.push(notes);
        }

        if let Some(status) = patch.status {
            args.push("--status".to_string());
            args.push(status.as_cli_value().to_string());
        }

        if let Some(priority) = patch.priority {
            args.push("--priority".to_string());
            args.push(priority.to_string());
        }

        if let Some(issue_type) = patch.issue_type {
            args.push("--type".to_string());
            args.push(issue_type.as_cli_value().to_string());
        }

        if let Some(assignee) = patch.assignee {
            args.push("--assignee".to_string());
            args.push(assignee);
        }

        if let Some(parent_id) = patch.parent_id {
            args.push("--parent".to_string());
            args.push(parent_id.trim().to_string());
        }

        if let Some(labels) = patch.labels {
            args.push("--set-labels".to_string());
            args.push(normalize_labels(labels).join(","));
        }

        if args.len() > 1 {
            args.push("--".to_string());
            args.push(task_id.to_string());
            let arg_refs = args.iter().map(String::as_str).collect::<Vec<_>>();
            self.run_bd_json(repo_path, &arg_refs)?;
            self.invalidate_task_list_cache(repo_path)?;
        }

        if let Some(ai_review_enabled) = patch.ai_review_enabled {
            let (mut root, namespace_key, mut namespace_map) =
                self.load_namespace(repo_path, task_id)?;
            namespace_map.insert("qaRequired".to_string(), Value::Bool(ai_review_enabled));
            self.persist_namespace(repo_path, task_id, &namespace_key, &mut root, namespace_map)?;
        }

        self.show_task(repo_path, task_id)
    }

    pub(super) fn delete_task_impl(
        &self,
        repo_path: &Path,
        task_id: &str,
        delete_subtasks: bool,
    ) -> Result<bool> {
        let mut args = vec!["delete", "--force"];
        if delete_subtasks {
            args.push("--cascade");
        }
        args.push("--");
        args.push(task_id);

        self.run_bd(repo_path, &args)?;
        self.invalidate_task_list_cache(repo_path)?;
        Ok(true)
    }
}
