pub(crate) fn normalize_labels(labels: Vec<String>) -> Vec<String> {
    let mut normalized: Vec<String> = labels
        .into_iter()
        .map(|label| label.trim().to_string())
        .filter(|label| !label.is_empty())
        .collect();
    normalized.sort();
    normalized.dedup();
    normalized
}

pub(crate) fn normalize_text_option(value: Option<String>) -> Option<String> {
    value.and_then(|entry| {
        let trimmed = entry.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

pub(crate) fn normalize_issue_type(issue_type: &str) -> &'static str {
    match issue_type {
        "epic" => "epic",
        "feature" => "feature",
        "bug" => "bug",
        _ => "task",
    }
}

pub(crate) fn default_ai_review_enabled(issue_type: &str) -> bool {
    matches!(
        normalize_issue_type(issue_type),
        "epic" | "feature" | "task" | "bug"
    )
}

