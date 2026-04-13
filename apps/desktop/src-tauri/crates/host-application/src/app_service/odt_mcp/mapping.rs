use super::types::{
    OdtMarkdownDocument, OdtPersistedDocument, OdtPublicTask, OdtQaReportDocument,
    OdtRequestedDocuments, OdtTaskDocumentPresence, OdtTaskDocumentsRead, OdtTaskSummary,
    OdtTaskSummaryTask,
};
use anyhow::{anyhow, Result};
use host_domain::{
    QaReportDocument, QaWorkflowVerdict, SpecDocument, TaskCard, TaskMetadata, TaskStatus,
};
use std::collections::HashSet;

fn qa_verdict(task: &TaskCard) -> QaWorkflowVerdict {
    task.document_summary.qa_report.verdict.clone()
}

pub(super) fn map_public_task(task: &TaskCard) -> OdtPublicTask {
    OdtPublicTask {
        id: task.id.clone(),
        title: task.title.clone(),
        description: task.description.clone(),
        status: task.status.clone(),
        priority: task.priority,
        issue_type: task.issue_type.clone(),
        ai_review_enabled: task.ai_review_enabled,
        labels: task.labels.clone(),
        target_branch: task.target_branch.clone(),
        created_at: task.created_at.clone(),
        updated_at: task.updated_at.clone(),
    }
}

pub(super) fn map_task_summary(task: &TaskCard) -> OdtTaskSummary {
    OdtTaskSummary {
        task: OdtTaskSummaryTask {
            task: map_public_task(task),
            qa_verdict: qa_verdict(task),
            documents: OdtTaskDocumentPresence {
                has_spec: task.document_summary.spec.has,
                has_plan: task.document_summary.plan.has,
                has_qa_report: task.document_summary.qa_report.has,
            },
        },
    }
}

fn map_markdown_document(document: SpecDocument) -> OdtMarkdownDocument {
    OdtMarkdownDocument {
        markdown: document.markdown,
        updated_at: document.updated_at,
        error: document.error,
    }
}

fn map_qa_report_document(report: Option<QaReportDocument>) -> OdtQaReportDocument {
    match report {
        Some(report) => OdtQaReportDocument {
            markdown: report.markdown,
            updated_at: report.updated_at,
            verdict: report.verdict,
            error: report.error,
        },
        None => OdtQaReportDocument {
            markdown: String::new(),
            updated_at: None,
            verdict: QaWorkflowVerdict::NotReviewed,
            error: None,
        },
    }
}

pub(super) fn map_task_documents(
    metadata: TaskMetadata,
    include_spec: bool,
    include_plan: bool,
    include_qa: bool,
) -> OdtTaskDocumentsRead {
    OdtTaskDocumentsRead {
        documents: OdtRequestedDocuments {
            spec: include_spec.then(|| map_markdown_document(metadata.spec)),
            implementation_plan: include_plan.then(|| map_markdown_document(metadata.plan)),
            latest_qa_report: include_qa.then(|| map_qa_report_document(metadata.qa_report)),
        },
    }
}

pub(super) fn map_persisted_document(
    document: SpecDocument,
    action: &str,
) -> Result<OdtPersistedDocument> {
    let updated_at = document
        .updated_at
        .ok_or_else(|| anyhow!("{action} did not return an updatedAt timestamp"))?;
    let revision = document
        .revision
        .ok_or_else(|| anyhow!("{action} did not return a document revision"))?;

    Ok(OdtPersistedDocument {
        markdown: document.markdown,
        updated_at,
        revision,
    })
}

pub(super) fn is_active_status(status: &TaskStatus) -> bool {
    matches!(
        status,
        TaskStatus::Open
            | TaskStatus::SpecReady
            | TaskStatus::ReadyForDev
            | TaskStatus::InProgress
            | TaskStatus::Blocked
            | TaskStatus::AiReview
            | TaskStatus::HumanReview
    )
}

pub(super) fn direct_subtask_ids(tasks: &[TaskCard], parent_id: &str) -> HashSet<String> {
    tasks
        .iter()
        .filter(|task| task.parent_id.as_deref() == Some(parent_id))
        .map(|task| task.id.clone())
        .collect()
}
