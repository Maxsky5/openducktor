use super::BuildResponseAction;
use crate::app_service::test_support::{build_service_with_state, make_emitter};
use std::sync::{Arc, Mutex};

#[test]
fn module_build_stop_reports_missing_run() {
    let (service, _task_state, _git_state) = build_service_with_state(vec![]);
    let events = Arc::new(Mutex::new(Vec::new()));

    let error = service
        .build_stop("missing-run", make_emitter(events))
        .expect_err("stopping unknown run should fail");

    assert!(error.to_string().contains("Run not found: missing-run"));
}

#[test]
fn module_build_respond_reports_missing_run() {
    let (service, _task_state, _git_state) = build_service_with_state(vec![]);
    let events = Arc::new(Mutex::new(Vec::new()));

    let error = service
        .build_respond(
            "missing-run",
            BuildResponseAction::Approve,
            None,
            make_emitter(events),
        )
        .expect_err("responding to unknown run should fail");

    assert!(error.to_string().contains("Run not found: missing-run"));
}
