use anyhow::{anyhow, Result};
use host_domain::{
    AgentSessionDocument, GitTargetBranch, TaskDocumentPresence, TaskDocumentSummary,
    TaskQaDocumentPresence,
};
use serde::Deserialize;
use serde_json::{Map, Value};

use crate::document_storage::{document_presence, latest_qa_verdict, latest_updated_at};

const LEGACY_AGENT_SESSION_SCENARIO_ALIASES: &[(&str, &str)] = &[
    ("spec_revision", "spec_initial"),
    ("planner_revision", "planner_initial"),
];

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

fn normalize_agent_session_entry(entry: &Value) -> Value {
    let Some(object) = entry.as_object() else {
        return entry.clone();
    };

    let Some(scenario_value) = object.get("scenario").and_then(Value::as_str) else {
        return entry.clone();
    };

    let Some((_, canonical_scenario)) = LEGACY_AGENT_SESSION_SCENARIO_ALIASES
        .iter()
        .find(|(legacy_scenario, _)| *legacy_scenario == scenario_value)
    else {
        return entry.clone();
    };

    let mut normalized = object.clone();
    normalized.insert(
        "scenario".to_string(),
        Value::String((*canonical_scenario).to_string()),
    );
    Value::Object(normalized)
}

fn parse_agent_session_compatibility_entry(entry: &Value) -> Result<Value> {
    let Some(object) = entry.as_object() else {
        return Ok(entry.clone());
    };

    let session_id = object.get("sessionId").and_then(Value::as_str).map(str::trim);
    let external_session_id = object
        .get("externalSessionId")
        .and_then(Value::as_str)
        .map(str::trim);

    match (session_id, external_session_id) {
        (Some(session_id), Some(external_session_id)) if session_id == external_session_id => {
            let mut normalized = object.clone();
            normalized.insert(
                "externalSessionId".to_string(),
                Value::String(external_session_id.to_string()),
            );
            Ok(Value::Object(normalized))
        }
        (Some(session_id), Some(external_session_id)) => Err(anyhow!(
            "Invalid legacy openducktor.agentSessions metadata: sessionId and externalSessionId must match when both are present. Found sessionId={session_id}, externalSessionId={external_session_id}. Fix the saved task metadata and retry."
        )),
        (Some(session_id), None) => {
            let mut normalized = object.clone();
            normalized.insert(
                "externalSessionId".to_string(),
                Value::String(session_id.to_string()),
            );
            Ok(Value::Object(normalized))
        }
        (None, Some(external_session_id)) => {
            let mut normalized = object.clone();
            normalized.insert(
                "externalSessionId".to_string(),
                Value::String(external_session_id.to_string()),
            );
            Ok(Value::Object(normalized))
        }
        (None, None) => Ok(entry.clone()),
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
            let entry = parse_agent_session_compatibility_entry(entry).map_err(|error| {
                anyhow!("Invalid openducktor.agentSessions[{index}] metadata: {error}")
            })?;
            AgentSessionDocument::deserialize(normalize_agent_session_entry(&entry)).map_err(|error| {
                anyhow!(
                    "Invalid openducktor.agentSessions[{index}] metadata: {error}. Fix the saved task metadata and retry."
                )
            })
        })
        .collect()
}
