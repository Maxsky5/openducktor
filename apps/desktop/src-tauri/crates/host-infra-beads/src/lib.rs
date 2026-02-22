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
use constants::CUSTOM_STATUS_VALUES;
#[cfg(test)]
use metadata::{
    metadata_bool_qa_required, metadata_namespace, parse_agent_sessions, parse_markdown_entries,
    parse_metadata_root, parse_qa_entries,
};
#[cfg(test)]
use normalize::{
    default_ai_review_enabled, normalize_issue_type, normalize_labels, normalize_text_option,
};

#[cfg(test)]
mod tests;
