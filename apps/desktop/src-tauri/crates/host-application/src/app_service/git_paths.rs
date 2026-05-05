pub(super) fn resolve_execution_path(repo_path: &str, working_dir: Option<&str>) -> String {
    working_dir
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(repo_path)
        .to_string()
}
