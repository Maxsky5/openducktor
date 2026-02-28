use anyhow::{anyhow, Result};
use host_infra_system::{hook_set_fingerprint, run_command_allow_failure, RepoConfig};
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

pub(crate) fn validate_hook_trust(repo_path: &str, repo_config: &RepoConfig) -> Result<()> {
    if repo_config.hooks.pre_start.is_empty() && repo_config.hooks.post_complete.is_empty() {
        return Ok(());
    }

    if !repo_config.trusted_hooks {
        return Err(anyhow!(
            "Hooks are configured but not trusted for {repo_path}. Confirm trust first."
        ));
    }

    let current_fingerprint = hook_set_fingerprint(&repo_config.hooks);
    if repo_config.trusted_hooks_fingerprint.as_deref() != Some(current_fingerprint.as_str()) {
        return Err(anyhow!(
            "Hooks changed since last approval for {repo_path}. Reconfirm trust before running hooks."
        ));
    }

    Ok(())
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
