use super::{
    default_ai_review_enabled, encode_markdown_for_storage, metadata_bool_qa_required,
    metadata_namespace, next_document_revision, normalize_labels, normalize_text_option,
    parse_agent_sessions, parse_issue_type, parse_markdown_entries, parse_metadata_root,
    parse_qa_entries, parse_task_status, read_latest_markdown_document, BeadsTaskStore,
    CommandRunner, ProcessCommandRunner, CUSTOM_STATUS_VALUES, DOCUMENT_ENCODING_GZIP_BASE64_V1,
    MAX_DECODED_MARKDOWN_BYTES, TASK_LIST_CACHE_TTL_MS,
};
use anyhow::{anyhow, Result};
use chrono::{Duration as ChronoDuration, Utc};
use host_domain::{
    AgentSessionDocument, CreateTaskInput, IssueType, QaVerdict, QaWorkflowVerdict, TaskStatus,
    TaskStore, UpdateTaskPatch, ODT_QA_APPROVED_SOURCE_TOOL, ODT_QA_REJECTED_SOURCE_TOOL,
    ODT_SET_PLAN_SOURCE_TOOL, ODT_SET_SPEC_SOURCE_TOOL,
};
use host_infra_system::{
    compute_beads_database_name, read_shared_dolt_server_state, resolve_repo_beads_attachment_dir,
};
use serde_json::{json, Value};
use std::fs;
use std::time::{Duration, Instant};

mod support;

#[path = "tests/lifecycle.rs"]
mod lifecycle;
#[path = "tests/parsing.rs"]
mod parsing;
#[path = "tests/persistence_docs.rs"]
mod persistence_docs;
#[path = "tests/persistence_sessions.rs"]
mod persistence_sessions;
#[path = "tests/persistence_tasks.rs"]
mod persistence_tasks;

use support::*;
