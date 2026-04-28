use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[serde(transparent)]
pub struct AgentRuntimeKind(String);

impl AgentRuntimeKind {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    pub fn opencode() -> Self {
        Self::new("opencode")
    }

    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }
}

impl From<&str> for AgentRuntimeKind {
    fn from(value: &str) -> Self {
        Self::new(value)
    }
}

impl From<String> for AgentRuntimeKind {
    fn from(value: String) -> Self {
        Self::new(value)
    }
}

impl fmt::Display for AgentRuntimeKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}
