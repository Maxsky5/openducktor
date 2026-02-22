use host_domain::{AgentSessionDocument, TaskDocumentPresence, TaskDocumentSummary};
use serde_json::{Map, Value};

use crate::model::{MarkdownEntry, QaEntry};

pub(crate) fn parse_metadata_root(metadata: Option<Value>) -> Map<String, Value> {
    match metadata {
        Some(Value::Object(map)) => map,
        _ => Map::new(),
    }
}

pub(crate) fn metadata_namespace<'a>(
    metadata: &'a Map<String, Value>,
    namespace: &str,
) -> Option<&'a Map<String, Value>> {
    metadata.get(namespace).and_then(Value::as_object)
}

pub(crate) fn metadata_bool_qa_required(namespace: &Map<String, Value>) -> Option<bool> {
    namespace.get("qaRequired").and_then(Value::as_bool)
}

pub(crate) fn markdown_document_presence(
    entries: Option<Vec<MarkdownEntry>>,
) -> TaskDocumentPresence {
    let latest = entries.as_ref().and_then(|list| list.last());
    match latest {
        Some(entry) if !entry.markdown.trim().is_empty() => TaskDocumentPresence {
            has: true,
            updated_at: Some(entry.updated_at.clone()),
        },
        _ => TaskDocumentPresence::default(),
    }
}

pub(crate) fn qa_document_presence(entries: Option<Vec<QaEntry>>) -> TaskDocumentPresence {
    let latest = entries.as_ref().and_then(|list| list.last());
    match latest {
        Some(entry) if !entry.markdown.trim().is_empty() => TaskDocumentPresence {
            has: true,
            updated_at: Some(entry.updated_at.clone()),
        },
        _ => TaskDocumentPresence::default(),
    }
}

pub(crate) fn metadata_document_summary(
    namespace: Option<&Map<String, Value>>,
) -> TaskDocumentSummary {
    let documents = namespace
        .and_then(|entry| entry.get("documents"))
        .and_then(Value::as_object);

    let spec = markdown_document_presence(
        documents
            .and_then(|docs| docs.get("spec"))
            .and_then(parse_markdown_entries),
    );
    let plan = markdown_document_presence(
        documents
            .and_then(|docs| docs.get("implementationPlan"))
            .and_then(parse_markdown_entries),
    );
    let qa_report = qa_document_presence(
        documents
            .and_then(|docs| docs.get("qaReports"))
            .and_then(parse_qa_entries),
    );

    TaskDocumentSummary {
        spec,
        plan,
        qa_report,
    }
}

pub(crate) fn parse_markdown_entries(value: &Value) -> Option<Vec<MarkdownEntry>> {
    let entries = value
        .as_array()?
        .iter()
        .filter_map(|entry| serde_json::from_value::<MarkdownEntry>(entry.clone()).ok())
        .collect::<Vec<_>>();
    Some(entries)
}

pub(crate) fn parse_qa_entries(value: &Value) -> Option<Vec<QaEntry>> {
    let entries = value
        .as_array()?
        .iter()
        .filter_map(|entry| serde_json::from_value::<QaEntry>(entry.clone()).ok())
        .collect::<Vec<_>>();
    Some(entries)
}

pub(crate) fn parse_agent_sessions(value: &Value) -> Option<Vec<AgentSessionDocument>> {
    let entries = value
        .as_array()?
        .iter()
        .filter_map(|entry| serde_json::from_value::<AgentSessionDocument>(entry.clone()).ok())
        .collect::<Vec<_>>();
    Some(entries)
}
