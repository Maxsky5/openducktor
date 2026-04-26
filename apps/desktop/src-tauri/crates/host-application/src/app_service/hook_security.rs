use host_infra_system::run_command_allow_failure;
use std::path::Path;

pub(crate) fn run_parsed_hook_command_allow_failure(
    hook: &str,
    cwd: &Path,
) -> (bool, String, String) {
    let parsed = match shell_words::split(hook) {
        Ok(parsed) => parsed,
        Err(error) => {
            return (
                false,
                String::new(),
                format!(
                    "Invalid hook command syntax. Use argv tokens, or explicitly invoke a shell (for example: sh -lc '...'): {error}"
                ),
            );
        }
    };

    let Some((program, args)) = parsed.split_first() else {
        return (
            false,
            String::new(),
            "Hook command is empty. Provide an executable name.".to_string(),
        );
    };

    let argv = args.iter().map(String::as_str).collect::<Vec<_>>();
    match run_command_allow_failure(program, argv.as_slice(), Some(cwd)) {
        Ok(result) => result,
        Err(error) => (
            false,
            String::new(),
            format!("Failed to execute hook command: {error:#}"),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::run_parsed_hook_command_allow_failure;

    #[test]
    fn run_parsed_hook_command_allow_failure_reports_empty_hook() {
        let (ok, _stdout, stderr) =
            run_parsed_hook_command_allow_failure("  ", std::path::Path::new("."));
        assert!(!ok);
        assert!(stderr.contains("Hook command is empty"));
    }
}
