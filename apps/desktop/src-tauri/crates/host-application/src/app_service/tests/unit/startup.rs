use super::support::*;

#[test]
fn wait_for_local_server_returns_ok_when_port_is_open() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("listener");
    let port = listener.local_addr().expect("addr").port();
    let result = wait_for_local_server(port, Duration::from_millis(500));
    assert!(result.is_ok());
}

fn find_closed_low_port() -> u16 {
    for port in 1..1024 {
        if TcpStream::connect(("127.0.0.1", port)).is_err() {
            return port;
        }
    }
    panic!("expected at least one closed privileged localhost port");
}

#[test]
fn wait_for_local_server_times_out_when_port_is_closed() {
    let port = find_closed_low_port();
    let result = wait_for_local_server(port, Duration::from_millis(250));
    assert!(result.is_err());
}

fn test_startup_policy(timeout: Duration) -> OpencodeStartupReadinessPolicy {
    OpencodeStartupReadinessPolicy {
        timeout,
        connect_timeout: Duration::from_millis(50),
        initial_retry_delay: Duration::from_millis(10),
        max_retry_delay: Duration::from_millis(50),
        child_state_check_interval: Duration::from_millis(25),
    }
}

#[test]
fn opencode_startup_event_payload_contract_includes_correlation_and_metrics() {
    let policy = test_startup_policy(Duration::from_millis(8_000));
    let report = OpencodeStartupWaitReport::from_parts(7, Duration::from_millis(321));
    let mut metrics = OpencodeStartupMetricsSnapshot {
        total: 4,
        ready: 3,
        failed: 1,
        ..OpencodeStartupMetricsSnapshot::default()
    };
    metrics.failed_by_reason.insert("timeout".to_string(), 1);
    if let Some(bucket) = metrics.startup_ms_histogram.get_mut("<=500") {
        *bucket = 4;
    }
    if let Some(bucket) = metrics.attempts_histogram.get_mut("<=10") {
        *bucket = 4;
    }

    let event = StartupEventPayload::ready(
        StartupEventContext::new(
            "agent_runtime",
            "/tmp/repo",
            Some("task-42"),
            "qa",
            4242,
            Some(StartupEventCorrelation::new("runtime_id", "runtime-abc")),
            Some(policy),
        ),
        report,
    );
    let payload = build_opencode_startup_event_payload(
        &event,
        Some(metrics),
        vec!["startup_duration_high:321".to_string()],
    );
    let payload_json = serde_json::to_value(payload).expect("payload should serialize");

    assert_eq!(payload_json["event"], "startup_ready");
    assert_eq!(payload_json["scope"], "agent_runtime");
    assert_eq!(payload_json["repoPath"], "/tmp/repo");
    assert_eq!(payload_json["taskId"], "task-42");
    assert_eq!(payload_json["role"], "qa");
    assert_eq!(payload_json["port"], 4242);
    assert_eq!(payload_json["correlationType"], "runtime_id");
    assert_eq!(payload_json["correlationId"], "runtime-abc");
    assert_eq!(payload_json["policy"]["timeoutMs"], 8_000);
    assert_eq!(payload_json["report"]["startupMs"], 321);
    assert_eq!(payload_json["report"]["attempts"], 7);
    assert_eq!(payload_json["metrics"]["total"], 4);
    assert_eq!(payload_json["metrics"]["ready"], 3);
    assert_eq!(payload_json["metrics"]["failed"], 1);
    assert_eq!(payload_json["alerts"][0], "startup_duration_high:321");
}

#[test]
fn opencode_startup_readiness_policy_uses_config_overrides() -> Result<()> {
    let root = unique_temp_path("startup-policy-config");
    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let runtime_config_store = RuntimeConfigStore::from_user_settings_store(&config_store);
    let config = RuntimeConfig {
        runtimes: BTreeMap::from([(
            "opencode".to_string(),
            OpencodeStartupReadinessConfig {
                timeout_ms: 15_345,
                connect_timeout_ms: 456,
                initial_retry_delay_ms: 33,
                max_retry_delay_ms: 99,
                child_check_interval_ms: 77,
            },
        )]),
        ..RuntimeConfig::default()
    };
    runtime_config_store.save(&config)?;

    let task_store: Arc<dyn TaskStore> = Arc::new(FakeTaskStore {
        state: Arc::new(Mutex::new(TaskStoreState::default())),
    });
    let service = AppService::new(task_store, config_store);
    let policy = service.opencode_startup_readiness_policy()?;
    assert_eq!(policy.timeout, Duration::from_millis(15_345));
    assert_eq!(policy.connect_timeout, Duration::from_millis(456));
    assert_eq!(policy.initial_retry_delay, Duration::from_millis(33));
    assert_eq!(policy.max_retry_delay, Duration::from_millis(99));
    assert_eq!(policy.child_state_check_interval, Duration::from_millis(77));

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn opencode_startup_readiness_policy_returns_actionable_error_on_invalid_config() -> Result<()> {
    let root = unique_temp_path("startup-policy-invalid-config");
    let config_path = root.join("runtime-config.json");
    fs::create_dir_all(&root)?;
    write_private_file(&config_path, "{ invalid json")?;

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let task_store: Arc<dyn TaskStore> = Arc::new(FakeTaskStore {
        state: Arc::new(Mutex::new(TaskStoreState::default())),
    });
    let service = AppService::new(task_store, config_store);
    let error = service
        .opencode_startup_readiness_policy()
        .expect_err("invalid config should fail startup readiness policy load");
    let message = format!("{error:#}");
    assert!(
        message.contains(&format!(
            "Failed loading OpenCode startup readiness config from {}",
            config_path.display()
        )),
        "error should include startup context and config path: {message}"
    );
    assert!(
        message.contains(
            "Fix invalid JSON in this file or delete it so OpenDucktor can recreate defaults"
        ),
        "error should include recovery instruction: {message}"
    );
    assert!(
        message.contains("Failed parsing config file"),
        "error should preserve parse failure context: {message}"
    );

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn resolve_build_startup_policy_emits_config_failure_metrics() -> Result<()> {
    let root = unique_temp_path("build-startup-policy-invalid-config");
    let config_path = root.join("runtime-config.json");
    fs::create_dir_all(&root)?;
    write_private_file(&config_path, "{ invalid json")?;

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let task_store: Arc<dyn TaskStore> = Arc::new(FakeTaskStore {
        state: Arc::new(Mutex::new(TaskStoreState::default())),
    });
    let service = AppService::new(task_store, config_store);
    let error = service
        .resolve_build_startup_policy(&AgentRuntimeKind::opencode(), "/tmp/repo", "task-42")
        .expect_err("invalid config should fail build startup policy resolution");
    let message = format!("{error:#}");
    assert!(message.contains("opencode build runtime failed before worktree preparation"));
    assert!(message.contains("Failed loading OpenCode startup readiness config"));

    let metrics = service.startup_metrics_snapshot()?;
    assert_eq!(
        metrics.failed_by_reason.get("startup_config_invalid"),
        Some(&1)
    );
    Ok(())
}

#[test]
fn resolve_runtime_startup_policy_emits_config_failure_metrics() -> Result<()> {
    let root = unique_temp_path("runtime-startup-policy-invalid-config");
    let config_path = root.join("runtime-config.json");
    fs::create_dir_all(&root)?;
    write_private_file(&config_path, "{ invalid json")?;

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let task_store: Arc<dyn TaskStore> = Arc::new(FakeTaskStore {
        state: Arc::new(Mutex::new(TaskStoreState::default())),
    });
    let service = AppService::new(task_store, config_store);
    let error = service
        .resolve_runtime_startup_policy(
            &AgentRuntimeKind::opencode(),
            "agent_runtime",
            "/tmp/repo",
            "task-42",
            RuntimeRole::Qa,
            "opencode runtime failed to start for task task-42",
        )
        .expect_err("invalid config should fail runtime startup policy resolution");
    let message = format!("{error:#}");
    assert!(message.contains("opencode runtime failed to start for task task-42"));
    assert!(message.contains("Failed loading OpenCode startup readiness config"));

    let metrics = service.startup_metrics_snapshot()?;
    assert_eq!(
        metrics.failed_by_reason.get("startup_config_invalid"),
        Some(&1)
    );
    Ok(())
}

#[test]
fn terminate_child_process_stops_background_process() {
    let mut child = Command::new("/bin/sh")
        .arg("-lc")
        .arg("sleep 5")
        .spawn()
        .expect("spawn sleep");
    terminate_child_process(&mut child);
    let status = child.try_wait().expect("try_wait should succeed");
    assert!(status.is_some(), "child process should be terminated");
}

#[test]
fn wait_for_local_server_with_process_returns_early_when_child_exits() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("listener");
    let port = listener.local_addr().expect("addr").port();
    drop(listener);

    let mut child = Command::new("/bin/sh")
        .arg("-lc")
        .arg("echo startup failed >&2; exit 42")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .expect("spawn failing process");
    let cancel_epoch = Arc::new(AtomicU64::new(0));
    let error = wait_for_local_server_with_process(
        &mut child,
        port,
        test_startup_policy(Duration::from_secs(2)),
        &cancel_epoch,
        0,
        |_| {},
    )
    .expect_err("should report early process exit");
    assert!(error.to_string().contains("startup failed"));
    assert_eq!(error.reason(), RuntimeStartupFailureReason::ChildExited);
}

#[test]
fn wait_for_local_server_with_process_times_out_when_child_stays_alive() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("listener");
    let port = listener.local_addr().expect("addr").port();
    drop(listener);

    let mut child = Command::new("/bin/sh")
        .arg("-lc")
        .arg("sleep 5")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .expect("spawn sleeping process");
    let cancel_epoch = Arc::new(AtomicU64::new(0));
    let error = wait_for_local_server_with_process(
        &mut child,
        port,
        test_startup_policy(Duration::from_millis(250)),
        &cancel_epoch,
        0,
        |_| {},
    )
    .expect_err("should time out when child remains alive and port stays closed");
    terminate_child_process(&mut child);
    assert_eq!(error.reason(), RuntimeStartupFailureReason::Timeout);
}

#[test]
fn wait_for_local_server_with_process_honors_total_timeout_budget_when_connect_timeout_is_large() {
    const MAX_PORT_RETRY_ATTEMPTS: usize = 5;

    for attempt in 0..MAX_PORT_RETRY_ATTEMPTS {
        let listener = TcpListener::bind("127.0.0.1:0").expect("listener");
        let port = listener.local_addr().expect("addr").port();
        drop(listener);

        let mut child = Command::new("/bin/sh")
            .arg("-lc")
            .arg("sleep 5")
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .expect("spawn sleeping process");
        let cancel_epoch = Arc::new(AtomicU64::new(0));
        let started_at = Instant::now();
        let result = wait_for_local_server_with_process(
            &mut child,
            port,
            OpencodeStartupReadinessPolicy {
                timeout: Duration::from_millis(250),
                connect_timeout: Duration::from_secs(10),
                initial_retry_delay: Duration::from_millis(10),
                max_retry_delay: Duration::from_millis(50),
                child_state_check_interval: Duration::from_millis(25),
            },
            &cancel_epoch,
            0,
            |_| {},
        );
        let elapsed = started_at.elapsed();
        terminate_child_process(&mut child);

        match result {
            Err(error) => {
                assert_eq!(error.reason(), RuntimeStartupFailureReason::Timeout);
                assert!(
                    elapsed < Duration::from_secs(2),
                    "startup wait should not exceed total budget window, elapsed={elapsed:?}"
                );
                return;
            }
            Ok(report) if attempt + 1 < MAX_PORT_RETRY_ATTEMPTS => {
                eprintln!(
                    "retrying flaky closed-port probe on reused port {port}, report={report:?}"
                );
            }
            Ok(report) => panic!(
                "total timeout budget should cap each connect attempt; port {port} became reachable in all retries, last report={report:?}"
            ),
        }
    }
}

#[test]
fn wait_for_local_server_with_process_honors_cancellation_epoch() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("listener");
    let port = listener.local_addr().expect("addr").port();
    drop(listener);

    let mut child = Command::new("/bin/sh")
        .arg("-lc")
        .arg("sleep 5")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .expect("spawn sleeping process");
    let cancel_epoch = Arc::new(AtomicU64::new(1));
    let snapshot = cancel_epoch.load(Ordering::SeqCst);
    cancel_epoch.fetch_add(1, Ordering::SeqCst);
    let error = wait_for_local_server_with_process(
        &mut child,
        port,
        test_startup_policy(Duration::from_secs(2)),
        &cancel_epoch,
        snapshot,
        |_| {},
    )
    .expect_err("should stop waiting when cancellation epoch changes");
    terminate_child_process(&mut child);
    assert_eq!(error.reason(), RuntimeStartupFailureReason::Cancelled);
}
