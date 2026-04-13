use crate::external_task_sync::{build_tasks_updated_event, ExternalTaskSyncEvent};
use anyhow::Result;
use host_application::{AppService, RepoPullRequestSyncResult};
use host_domain::WorkspaceRecord;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

const PULL_REQUEST_SYNC_INTERVAL: Duration = Duration::from_secs(5 * 60);
const STOP_POLL_INTERVAL: Duration = Duration::from_millis(250);

pub(crate) fn start_pull_request_sync_loop(
    service: Arc<AppService>,
    emit_event: impl Fn(ExternalTaskSyncEvent) + Send + Sync + 'static,
) -> Arc<AtomicBool> {
    start_pull_request_sync_loop_with_interval(service, PULL_REQUEST_SYNC_INTERVAL, emit_event)
}

fn start_pull_request_sync_loop_with_interval(
    service: Arc<AppService>,
    interval: Duration,
    emit_event: impl Fn(ExternalTaskSyncEvent) + Send + Sync + 'static,
) -> Arc<AtomicBool> {
    let stop_requested = Arc::new(AtomicBool::new(false));
    let loop_stop_requested = stop_requested.clone();
    let event_emitter = Arc::new(emit_event);

    std::thread::spawn(move || {
        let mut previous_repo_path = None;
        run_pull_request_sync_loop(
            &loop_stop_requested,
            interval,
            || {
                run_pull_request_sync_iteration(
                    &mut previous_repo_path,
                    || service.workspace_list(),
                    |repo_path| service.prime_pull_request_sync_candidates(repo_path),
                    |repo_path| service.repo_pull_request_sync_detailed(repo_path),
                )
            },
            |event| event_emitter(event),
        );
    });

    stop_requested
}

fn run_pull_request_sync_iteration(
    previous_repo_path: &mut Option<String>,
    mut list_workspaces: impl FnMut() -> Result<Vec<WorkspaceRecord>>,
    mut prime_candidates: impl FnMut(&str) -> Result<()>,
    mut sync_repo: impl FnMut(&str) -> Result<RepoPullRequestSyncResult>,
) -> Result<Option<ExternalTaskSyncEvent>> {
    let active_repo_path = list_workspaces()?
        .into_iter()
        .find(|workspace| workspace.is_active)
        .map(|workspace| workspace.path);

    let Some(active_repo_path) = active_repo_path else {
        *previous_repo_path = None;
        return Ok(None);
    };

    if previous_repo_path.as_deref() != Some(active_repo_path.as_str()) {
        prime_candidates(active_repo_path.as_str())?;
        *previous_repo_path = Some(active_repo_path.clone());
    }

    let result = sync_repo(active_repo_path.as_str())?;
    if result.changed_task_ids.is_empty() {
        return Ok(None);
    }

    Ok(Some(build_tasks_updated_event(
        active_repo_path,
        result.changed_task_ids,
    )))
}

fn run_pull_request_sync_loop(
    stop_requested: &AtomicBool,
    interval: Duration,
    mut sync_iteration: impl FnMut() -> Result<Option<ExternalTaskSyncEvent>>,
    mut emit_event: impl FnMut(ExternalTaskSyncEvent),
) {
    while !stop_requested.load(Ordering::SeqCst) {
        match sync_iteration() {
            Ok(Some(event)) => emit_event(event),
            Ok(None) => {}
            Err(error) => {
                tracing::error!(
                    target: "openducktor.task-sync",
                    error = %format!("{error:#}"),
                    "Pull request sync iteration failed; the scheduler will retry on the next interval"
                );
            }
        }
        sleep_until_next_iteration(stop_requested, interval);
    }
}

fn sleep_until_next_iteration(stop_requested: &AtomicBool, interval: Duration) {
    let deadline = Instant::now() + interval;
    while !stop_requested.load(Ordering::SeqCst) {
        let now = Instant::now();
        if now >= deadline {
            return;
        }
        std::thread::sleep((deadline - now).min(STOP_POLL_INTERVAL));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn workspace(path: &str, is_active: bool) -> WorkspaceRecord {
        WorkspaceRecord {
            path: path.to_string(),
            is_active,
            has_config: true,
            configured_worktree_base_path: None,
            default_worktree_base_path: None,
            effective_worktree_base_path: None,
        }
    }

    #[test]
    fn sync_iteration_returns_none_without_an_active_workspace() {
        let mut previous_repo_path = Some("/repo-a".to_string());
        let mut prime_calls = Vec::new();
        let mut sync_calls = Vec::new();

        let event = run_pull_request_sync_iteration(
            &mut previous_repo_path,
            || Ok(vec![workspace("/repo-a", false)]),
            |repo_path| {
                prime_calls.push(repo_path.to_string());
                Ok(())
            },
            |repo_path| {
                sync_calls.push(repo_path.to_string());
                Ok(RepoPullRequestSyncResult {
                    ran: true,
                    changed_task_ids: vec!["task-1".to_string()],
                })
            },
        )
        .expect("iteration should succeed");

        assert!(event.is_none());
        assert!(prime_calls.is_empty());
        assert!(sync_calls.is_empty());
        assert_eq!(previous_repo_path, None);
    }

    #[test]
    fn sync_iteration_primes_new_active_repo_and_returns_batched_update_event() {
        let mut previous_repo_path = Some("/repo-a".to_string());
        let mut prime_calls = Vec::new();
        let mut sync_calls = Vec::new();

        let event = run_pull_request_sync_iteration(
            &mut previous_repo_path,
            || {
                Ok(vec![
                    workspace("/repo-a", false),
                    workspace("/repo-b", true),
                ])
            },
            |repo_path| {
                prime_calls.push(repo_path.to_string());
                Ok(())
            },
            |repo_path| {
                sync_calls.push(repo_path.to_string());
                Ok(RepoPullRequestSyncResult {
                    ran: true,
                    changed_task_ids: vec!["task-1".to_string(), "task-2".to_string()],
                })
            },
        )
        .expect("iteration should succeed")
        .expect("iteration should emit an event");

        assert_eq!(prime_calls, vec!["/repo-b"]);
        assert_eq!(sync_calls, vec!["/repo-b"]);
        assert_eq!(previous_repo_path.as_deref(), Some("/repo-b"));
        assert_eq!(
            event.kind,
            crate::external_task_sync::ExternalTaskSyncEventKind::TasksUpdated
        );
        assert_eq!(event.repo_path, "/repo-b");
        assert_eq!(event.task_id, None);
        assert_eq!(
            event.task_ids,
            Some(vec!["task-1".to_string(), "task-2".to_string()])
        );
    }

    #[test]
    fn sync_iteration_skips_emission_when_sync_reports_no_changed_tasks() {
        let mut previous_repo_path = None;
        let mut prime_calls = Vec::new();
        let mut sync_calls = Vec::new();

        let event = run_pull_request_sync_iteration(
            &mut previous_repo_path,
            || Ok(vec![workspace("/repo", true)]),
            |repo_path| {
                prime_calls.push(repo_path.to_string());
                Ok(())
            },
            |repo_path| {
                sync_calls.push(repo_path.to_string());
                Ok(RepoPullRequestSyncResult::default())
            },
        )
        .expect("iteration should succeed");

        assert!(event.is_none());
        assert_eq!(prime_calls, vec!["/repo"]);
        assert_eq!(sync_calls, vec!["/repo"]);
    }

    #[test]
    fn sync_loop_stops_promptly_once_stop_is_requested() {
        let stop_requested = AtomicBool::new(false);
        let started = Instant::now();
        let mut emitted = Vec::new();
        let mut iteration_count = 0;

        run_pull_request_sync_loop(
            &stop_requested,
            Duration::from_secs(60),
            || {
                iteration_count += 1;
                stop_requested.store(true, Ordering::SeqCst);
                Ok(Some(build_tasks_updated_event(
                    "/repo".to_string(),
                    vec!["task-1".to_string()],
                )))
            },
            |event| emitted.push(event),
        );

        assert_eq!(iteration_count, 1);
        assert_eq!(emitted.len(), 1);
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn sync_loop_continues_after_iteration_errors() {
        let stop_requested = AtomicBool::new(false);
        let mut emitted = Vec::new();
        let mut iteration_count = 0;

        run_pull_request_sync_loop(
            &stop_requested,
            Duration::ZERO,
            || {
                iteration_count += 1;
                if iteration_count == 1 {
                    return Err(anyhow::anyhow!("transient sync failure"));
                }
                stop_requested.store(true, Ordering::SeqCst);
                Ok(Some(build_tasks_updated_event(
                    "/repo".to_string(),
                    vec!["task-1".to_string()],
                )))
            },
            |event| emitted.push(event),
        );

        assert_eq!(iteration_count, 2);
        assert_eq!(emitted.len(), 1);
        assert_eq!(emitted[0].repo_path, "/repo");
    }
}
