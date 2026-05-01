use anyhow::{anyhow, Result};
use host_domain::{
    AgentSessionDocument, GitTargetBranch, TaskDocumentPresence, TaskDocumentSummary,
    TaskQaDocumentPresence,
};
use serde::Deserialize;
use serde_json::{Map, Value};

use crate::document_storage::{document_presence, latest_qa_verdict, latest_updated_at};

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

fn parse_target_branch_value(value: &Value) -> Result<GitTargetBranch> {
    serde_json::from_value(value.clone()).map_err(|error| {
        anyhow!(
            "Invalid openducktor.targetBranch metadata: {error}. Fix the saved task metadata or choose a valid target branch again."
        )
    })
}

pub(crate) fn metadata_target_branch(namespace: &Map<String, Value>) -> Option<GitTargetBranch> {
    namespace
        .get("targetBranch")
        .and_then(|value| parse_target_branch_value(value).ok())
}

pub(crate) fn metadata_target_branch_strict(
    namespace: &Map<String, Value>,
) -> Result<Option<GitTargetBranch>> {
    namespace
        .get("targetBranch")
        .map(parse_target_branch_value)
        .transpose()
}

pub(crate) fn markdown_document_presence(value: Option<&Value>) -> TaskDocumentPresence {
    if !document_presence(value) {
        return TaskDocumentPresence::default();
    }

    TaskDocumentPresence {
        has: true,
        updated_at: latest_updated_at(value),
    }
}

pub(crate) fn qa_document_presence(value: Option<&Value>) -> TaskQaDocumentPresence {
    let Some(value) = value else {
        return TaskQaDocumentPresence::default();
    };
    let has = document_presence(Some(value));

    TaskQaDocumentPresence {
        has,
        updated_at: if has {
            latest_updated_at(Some(value))
        } else {
            None
        },
        verdict: latest_qa_verdict(Some(value)),
    }
}

pub(crate) fn metadata_document_summary(
    namespace: Option<&Map<String, Value>>,
) -> TaskDocumentSummary {
    let documents = namespace
        .and_then(|entry| entry.get("documents"))
        .and_then(Value::as_object);

    let spec = markdown_document_presence(documents.and_then(|docs| docs.get("spec")));
    let plan =
        markdown_document_presence(documents.and_then(|docs| docs.get("implementationPlan")));
    let qa_report = qa_document_presence(documents.and_then(|docs| docs.get("qaReports")));

    TaskDocumentSummary {
        spec,
        plan,
        qa_report,
    }
}

pub(crate) fn parse_agent_sessions(value: &Value) -> Result<Vec<AgentSessionDocument>> {
    let entries = value.as_array().ok_or_else(|| {
        anyhow!(
            "Invalid openducktor.agentSessions metadata: expected an array of persisted sessions. Fix the saved task metadata and retry."
        )
    })?;

    entries
        .iter()
        .enumerate()
        .map(|(index, entry)| {
            AgentSessionDocument::deserialize(entry.clone()).map_err(|error| {
                anyhow!(
                    "Invalid openducktor.agentSessions[{index}] metadata: {error}. Fix the saved task metadata and retry."
                )
            })
        })
        .collect()
}
