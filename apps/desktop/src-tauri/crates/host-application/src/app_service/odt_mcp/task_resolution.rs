use anyhow::{anyhow, Result};
use host_domain::TaskCard;

use crate::app_service::workflow_rules::normalize_title_key;

const MAX_TASK_CANDIDATES: usize = 5;

fn sanitize_slug(input: &str) -> String {
    let mut slug = String::new();
    let mut last_dash = false;

    for ch in input.chars() {
        let lower = ch.to_ascii_lowercase();
        if lower.is_ascii_alphanumeric() {
            slug.push(lower);
            last_dash = false;
            continue;
        }
        if !last_dash {
            slug.push('-');
            last_dash = true;
        }
    }

    slug.trim_matches('-').to_string()
}

fn format_task_ref(task: &TaskCard) -> String {
    format!("{} ({})", task.id, task.title)
}

fn throw_ambiguous_task_identifier(
    requested_task_id: &str,
    matches: &[TaskCard],
) -> Result<TaskCard> {
    let candidates = matches
        .iter()
        .take(MAX_TASK_CANDIDATES)
        .map(format_task_ref)
        .collect::<Vec<_>>()
        .join(", ");
    Err(anyhow!(
        "Task identifier \"{}\" is ambiguous. Use exact task id. Candidates: {}",
        requested_task_id,
        candidates
    ))
}

pub(super) fn resolve_task_reference(
    tasks: &[TaskCard],
    requested_task_id: &str,
) -> Result<TaskCard> {
    let requested_literal = requested_task_id.trim();
    if requested_literal.is_empty() {
        return Err(anyhow!("Missing taskId."));
    }

    let requested_lower = normalize_title_key(requested_literal);
    let requested_slug = sanitize_slug(requested_literal);

    if let Some(task) = tasks.iter().find(|task| task.id == requested_literal) {
        return Ok(task.clone());
    }

    let by_case_insensitive_id = tasks
        .iter()
        .filter(|task| normalize_title_key(&task.id) == requested_lower)
        .cloned()
        .collect::<Vec<_>>();
    if by_case_insensitive_id.len() == 1 {
        return Ok(by_case_insensitive_id[0].clone());
    }
    if by_case_insensitive_id.len() > 1 {
        return throw_ambiguous_task_identifier(requested_task_id, &by_case_insensitive_id);
    }

    if !requested_slug.is_empty() {
        // ID matching intentionally accepts any dash-separated segment so users can paste
        // short memorable fragments from generated task ids, not only trailing suffixes.
        let by_id_segment = tasks
            .iter()
            .filter(|task| {
                let normalized_id = normalize_title_key(&task.id);
                normalized_id == requested_slug
                    || normalized_id
                        .split('-')
                        .any(|suffix| !suffix.is_empty() && suffix == requested_slug)
            })
            .cloned()
            .collect::<Vec<_>>();
        if by_id_segment.len() == 1 {
            return Ok(by_id_segment[0].clone());
        }
        if by_id_segment.len() > 1 {
            return throw_ambiguous_task_identifier(requested_task_id, &by_id_segment);
        }
    }

    let by_title_exact = tasks
        .iter()
        .filter(|task| normalize_title_key(&task.title) == requested_lower)
        .cloned()
        .collect::<Vec<_>>();
    if by_title_exact.len() == 1 {
        return Ok(by_title_exact[0].clone());
    }
    if by_title_exact.len() > 1 {
        return throw_ambiguous_task_identifier(requested_task_id, &by_title_exact);
    }

    if !requested_slug.is_empty() {
        let by_title_slug_exact = tasks
            .iter()
            .filter(|task| sanitize_slug(&task.title) == requested_slug)
            .cloned()
            .collect::<Vec<_>>();
        if by_title_slug_exact.len() == 1 {
            return Ok(by_title_slug_exact[0].clone());
        }
        if by_title_slug_exact.len() > 1 {
            return throw_ambiguous_task_identifier(requested_task_id, &by_title_slug_exact);
        }
    }

    let by_title_contains = tasks
        .iter()
        .filter(|task| {
            let title_lower = normalize_title_key(&task.title);
            let title_slug = sanitize_slug(&task.title);
            (!requested_lower.is_empty() && title_lower.contains(&requested_lower))
                || (!requested_slug.is_empty() && title_slug.contains(&requested_slug))
        })
        .take(MAX_TASK_CANDIDATES + 1)
        .cloned()
        .collect::<Vec<_>>();
    if by_title_contains.len() == 1 {
        return Ok(by_title_contains[0].clone());
    }
    if by_title_contains.len() > 1 {
        return throw_ambiguous_task_identifier(requested_task_id, &by_title_contains);
    }

    let hints = tasks
        .iter()
        .filter(|task| {
            let id_lower = normalize_title_key(&task.id);
            let title_lower = normalize_title_key(&task.title);
            let title_slug = sanitize_slug(&task.title);
            (!requested_lower.is_empty()
                && (id_lower.contains(&requested_lower) || title_lower.contains(&requested_lower)))
                || (!requested_slug.is_empty()
                    && (id_lower.contains(&requested_slug) || title_slug.contains(&requested_slug)))
        })
        .take(MAX_TASK_CANDIDATES)
        .map(format_task_ref)
        .collect::<Vec<_>>();
    let candidates = if hints.is_empty() {
        tasks
            .iter()
            .take(MAX_TASK_CANDIDATES)
            .map(format_task_ref)
            .collect::<Vec<_>>()
    } else {
        hints
    };

    if candidates.is_empty() {
        return Err(anyhow!("Task not found: {}.", requested_task_id));
    }

    Err(anyhow!(
        "Task not found: {}. Candidate task ids: {}",
        requested_task_id,
        candidates.join(", ")
    ))
}
