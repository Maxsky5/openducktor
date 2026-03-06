mod command_runner;
mod constants;
mod execution;
mod initialization;
mod metadata;
mod metadata_ops;
mod model;
mod normalize;
mod parsing;
mod store;

pub use store::BeadsTaskStore;

#[cfg(test)]
use command_runner::{CommandRunner, ProcessCommandRunner};
#[cfg(test)]
use constants::{CUSTOM_STATUS_VALUES, TASK_LIST_CACHE_TTL_MS};
#[cfg(test)]
use metadata::{
    metadata_bool_qa_required, metadata_namespace, parse_agent_sessions, parse_markdown_entries,
    parse_metadata_root, parse_qa_entries,
};
#[cfg(test)]
use normalize::{
    default_ai_review_enabled, normalize_labels, normalize_text_option, parse_issue_type,
    parse_task_status,
};

#[cfg(test)]
mod tests;
