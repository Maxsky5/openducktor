mod command_runner;
mod constants;
mod document_storage;
mod execution;
mod lifecycle;
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
use document_storage::{
    encode_markdown_for_storage, next_document_revision, parse_markdown_entries, parse_qa_entries,
    read_latest_markdown_document, DOCUMENT_ENCODING_GZIP_BASE64_V1,
};
#[cfg(test)]
use metadata::{
    metadata_bool_qa_required, metadata_namespace, parse_agent_sessions, parse_metadata_root,
};
#[cfg(test)]
use normalize::{
    default_ai_review_enabled, normalize_labels, normalize_text_option, parse_issue_type,
    parse_task_status,
};

#[cfg(test)]
mod tests;
