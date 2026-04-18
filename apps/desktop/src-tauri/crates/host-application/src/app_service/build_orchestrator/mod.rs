mod build_cleanup;
mod build_lifecycle;
mod build_runtime_setup;
mod session_stop;

use serde::Deserialize;

/// Action responded by user during build/run (for approve/deny/message flow).
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BuildResponseAction {
    Approve,
    Deny,
    Message,
}

impl BuildResponseAction {
    pub fn as_str(&self) -> &'static str {
        match self {
            BuildResponseAction::Approve => "approve",
            BuildResponseAction::Deny => "deny",
            BuildResponseAction::Message => "message",
        }
    }
}

/// Cleanup mode after build/run completion.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CleanupMode {
    Success,
    Failure,
}

impl CleanupMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            CleanupMode::Success => "success",
            CleanupMode::Failure => "failure",
        }
    }
}

#[cfg(test)]
mod tests;
