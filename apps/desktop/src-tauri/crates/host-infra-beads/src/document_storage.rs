use anyhow::{anyhow, Result};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use host_domain::{QaReportDocument, QaWorkflowVerdict, SpecDocument};
#[cfg(test)]
use serde::Deserialize;
use serde_json::{Map, Value};
use std::io::{Read, Write};

#[cfg(test)]
use crate::model::{MarkdownEntry, QaEntry};

pub(crate) const DOCUMENT_ENCODING_GZIP_BASE64_V1: &str = "gzip-base64-v1";

pub(crate) fn encode_markdown_for_storage(markdown: &str) -> Result<String> {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(markdown.as_bytes())?;
    let compressed = encoder.finish()?;
    Ok(STANDARD.encode(compressed))
}

fn decode_markdown_payload(payload: &str, encoding: &str, path: &str) -> Result<String> {
    match encoding {
        DOCUMENT_ENCODING_GZIP_BASE64_V1 => {
            let compressed = STANDARD.decode(payload).map_err(|error| {
                anyhow!("Failed to decode {path}: invalid base64 payload: {error}")
            })?;
            let mut decoder = GzDecoder::new(compressed.as_slice());
            let mut markdown = String::new();
            decoder.read_to_string(&mut markdown).map_err(|error| {
                anyhow!("Failed to decode {path}: invalid gzip payload: {error}")
            })?;
            Ok(markdown)
        }
        other => Err(anyhow!(
            "Failed to decode {path}: unsupported encoding {other}"
        )),
    }
}

#[cfg(test)]
pub(crate) fn parse_markdown_entries(value: &Value) -> Option<Vec<MarkdownEntry>> {
    value
        .as_array()?
        .iter()
        .map(|entry| MarkdownEntry::deserialize(entry).ok())
        .collect::<Option<Vec<_>>>()
}

#[cfg(test)]
pub(crate) fn parse_qa_entries(value: &Value) -> Option<Vec<QaEntry>> {
    value
        .as_array()?
        .iter()
        .map(|entry| QaEntry::deserialize(entry).ok())
        .collect::<Option<Vec<_>>>()
}

pub(crate) fn next_document_revision(value: Option<&Value>, path: &str) -> Result<u32> {
    match value {
        None => Ok(1),
        Some(Value::Array(entries)) => {
            let mut max_revision = 0u32;
            for (index, entry) in entries.iter().enumerate() {
                let object = entry.as_object().ok_or_else(|| {
                    anyhow!("Invalid existing {path} metadata at index {index}: expected an object")
                })?;
                let revision = parse_required_u32_field(object, "revision", path, index)?;
                max_revision = max_revision.max(revision);
            }
            Ok(max_revision + 1)
        }
        Some(_) => Err(anyhow!(
            "Invalid existing {path} metadata: expected an array"
        )),
    }
}

pub(crate) fn read_latest_markdown_document(value: Option<&Value>, path: &str) -> SpecDocument {
    let Some(value) = value else {
        return SpecDocument {
            markdown: String::new(),
            updated_at: None,
            revision: None,
            error: None,
        };
    };

    let Some((entry, index)) = latest_entry(value) else {
        return SpecDocument {
            markdown: String::new(),
            updated_at: None,
            revision: None,
            error: malformed_collection_error(path, value),
        };
    };

    read_markdown_entry(entry, &format!("{path}[{index}]"))
}

pub(crate) fn read_latest_qa_document(
    value: Option<&Value>,
    path: &str,
) -> Option<QaReportDocument> {
    let value = value?;

    let Some((entry, index)) = latest_entry(value) else {
        return Some(QaReportDocument {
            markdown: String::new(),
            verdict: QaWorkflowVerdict::NotReviewed,
            updated_at: None,
            revision: None,
            error: malformed_collection_error(path, value),
        });
    };

    Some(read_qa_entry(entry, &format!("{path}[{index}]")))
}

pub(crate) fn document_presence(value: Option<&Value>) -> bool {
    match value {
        Some(Value::Array(entries)) => {
            let Some(entry) = entries.last() else {
                return false;
            };
            match entry.as_object() {
                Some(object) => {
                    let Some(payload) = object.get("markdown").and_then(Value::as_str) else {
                        return true;
                    };

                    match object.get("encoding").and_then(Value::as_str) {
                        Some(encoding) => {
                            decode_markdown_payload(payload, encoding, "document presence")
                                .map(|markdown| !markdown.trim().is_empty())
                                .unwrap_or(true)
                        }
                        None if object.contains_key("encoding") => true,
                        None => !payload.trim().is_empty(),
                    }
                }
                None => true,
            }
        }
        Some(_) => true,
        None => false,
    }
}

pub(crate) fn latest_updated_at(value: Option<&Value>) -> Option<String> {
    latest_entry(value?).and_then(|(entry, _)| {
        entry.as_object().and_then(|object| {
            object
                .get("updatedAt")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
        })
    })
}

pub(crate) fn latest_qa_verdict(value: Option<&Value>) -> QaWorkflowVerdict {
    let Some(value) = value else {
        return QaWorkflowVerdict::NotReviewed;
    };
    let Some((entry, _)) = latest_entry(value) else {
        return QaWorkflowVerdict::NotReviewed;
    };
    let Some(object) = entry.as_object() else {
        return QaWorkflowVerdict::NotReviewed;
    };
    parse_workflow_verdict(object.get("verdict")).unwrap_or(QaWorkflowVerdict::NotReviewed)
}

fn latest_entry<'a>(value: &'a Value) -> Option<(&'a Value, usize)> {
    let entries = value.as_array()?;
    let index = entries.len().checked_sub(1)?;
    entries.get(index).map(|entry| (entry, index))
}

fn malformed_collection_error(path: &str, value: &Value) -> Option<String> {
    if value.is_array() {
        return None;
    }
    Some(format!("Failed to read {path}: expected an array"))
}

struct BaseDocumentFields<'a> {
    updated_at: Option<String>,
    revision: Option<u32>,
    payload: Option<&'a str>,
    encoding: std::result::Result<Option<String>, String>,
    errors: Vec<String>,
}

impl<'a> BaseDocumentFields<'a> {
    fn from_object(object: &'a Map<String, Value>, path: &str) -> Self {
        let updated_at = optional_string_field(object, "updatedAt");
        let revision = optional_u32_field(object, "revision");
        let payload = required_string_field(object, "markdown");
        let encoding = encoding_field(object);
        let mut errors = field_errors(object, path, &["updatedAt", "revision"]);

        if payload.is_none() {
            errors.push(format!("{path}.markdown must be a string"));
        }
        if let Some(error) = encoding.as_ref().err() {
            errors.push(error.clone());
        }

        Self {
            updated_at,
            revision,
            payload,
            encoding,
            errors,
        }
    }

    fn with_additional_error(mut self, error: Option<String>) -> Self {
        if let Some(error) = error {
            self.errors.push(error);
        }
        self
    }

    fn decode_markdown(&self, path: &str) -> std::result::Result<String, String> {
        if !self.errors.is_empty() {
            return Err(format!("Failed to read {path}: {}", self.errors.join("; ")));
        }

        let payload = self.payload.expect("payload checked above");
        match &self.encoding {
            Ok(Some(encoding)) => {
                decode_markdown_payload(payload, encoding, path).map_err(|error| error.to_string())
            }
            Ok(None) => Ok(payload.to_string()),
            Err(_) => unreachable!("encoding error handled above"),
        }
    }
}

fn read_markdown_entry(entry: &Value, path: &str) -> SpecDocument {
    let Some(object) = entry.as_object() else {
        return SpecDocument {
            markdown: String::new(),
            updated_at: None,
            revision: None,
            error: Some(format!("Failed to read {path}: expected an object")),
        };
    };

    let fields = BaseDocumentFields::from_object(object, path);
    let updated_at = fields.updated_at.clone();
    let revision = fields.revision;

    let markdown = match fields.decode_markdown(path) {
        Ok(markdown) => markdown,
        Err(error) => {
            return SpecDocument {
                markdown: String::new(),
                updated_at,
                revision,
                error: Some(error),
            };
        }
    };

    SpecDocument {
        markdown,
        updated_at,
        revision,
        error: None,
    }
}

fn read_qa_entry(entry: &Value, path: &str) -> QaReportDocument {
    let Some(object) = entry.as_object() else {
        return QaReportDocument {
            markdown: String::new(),
            verdict: QaWorkflowVerdict::NotReviewed,
            updated_at: None,
            revision: None,
            error: Some(format!("Failed to read {path}: expected an object")),
        };
    };

    let verdict = parse_workflow_verdict(object.get("verdict"));
    let fields = BaseDocumentFields::from_object(object, path).with_additional_error(
        verdict
            .is_none()
            .then(|| format!("{path}.verdict must be one of approved or rejected")),
    );
    let updated_at = fields.updated_at.clone();
    let revision = fields.revision;

    let markdown = match fields.decode_markdown(path) {
        Ok(markdown) => markdown,
        Err(error) => {
            return QaReportDocument {
                markdown: String::new(),
                verdict: verdict.unwrap_or(QaWorkflowVerdict::NotReviewed),
                updated_at,
                revision,
                error: Some(error),
            };
        }
    };

    QaReportDocument {
        markdown,
        verdict: verdict.expect("verdict checked above"),
        updated_at,
        revision,
        error: None,
    }
}

fn parse_required_u32_field(
    object: &Map<String, Value>,
    field: &str,
    path: &str,
    index: usize,
) -> Result<u32> {
    let value = object.get(field).and_then(Value::as_u64).ok_or_else(|| {
        anyhow!(
            "Invalid existing {path} metadata at index {index}: {field} must be a positive integer"
        )
    })?;
    u32::try_from(value).map_err(|_| {
        anyhow!("Invalid existing {path} metadata at index {index}: {field} exceeds u32")
    })
}

fn optional_u32_field(object: &Map<String, Value>, field: &str) -> Option<u32> {
    object
        .get(field)
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
}

fn optional_string_field(object: &Map<String, Value>, field: &str) -> Option<String> {
    object
        .get(field)
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
}

fn required_string_field<'a>(object: &'a Map<String, Value>, field: &str) -> Option<&'a str> {
    object.get(field).and_then(Value::as_str)
}

fn encoding_field(object: &Map<String, Value>) -> std::result::Result<Option<String>, String> {
    if !object.contains_key("encoding") {
        return Ok(None);
    }

    match object.get("encoding").and_then(Value::as_str) {
        Some(value) => Ok(Some(value.to_string())),
        None => Err("encoding must be a string when present".to_string()),
    }
}

fn parse_workflow_verdict(value: Option<&Value>) -> Option<QaWorkflowVerdict> {
    match value.and_then(Value::as_str) {
        Some("approved") => Some(QaWorkflowVerdict::Approved),
        Some("rejected") => Some(QaWorkflowVerdict::Rejected),
        _ => None,
    }
}

fn field_errors(object: &Map<String, Value>, path: &str, fields: &[&str]) -> Vec<String> {
    let mut errors = Vec::new();
    for &field in fields {
        let invalid = match field {
            "updatedAt" => {
                object.contains_key(field) && object.get(field).and_then(Value::as_str).is_none()
            }
            "revision" => object.contains_key(field) && optional_u32_field(object, field).is_none(),
            _ => false,
        };

        if invalid {
            let description = match field {
                "updatedAt" => "must be a string",
                "revision" => "must be a positive integer",
                _ => "is invalid",
            };
            errors.push(format!("{path}.{field} {description}"));
        }
    }
    errors
}
