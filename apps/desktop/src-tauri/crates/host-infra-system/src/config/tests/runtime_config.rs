use super::{OpencodeStartupReadinessConfig, RuntimeConfig, TestRuntimeStoreHarness};

#[test]
fn runtime_store_defaults_and_normalizes_startup_readiness() {
    assert_eq!(RuntimeConfig::default().opencode_startup.timeout_ms, 15_000);

    let harness = TestRuntimeStoreHarness::new("runtime-config-startup-readiness");
    let store = harness.store();
    let config = RuntimeConfig {
        opencode_startup: OpencodeStartupReadinessConfig {
            timeout_ms: 10,
            connect_timeout_ms: 0,
            initial_retry_delay_ms: 3_000,
            max_retry_delay_ms: 20,
            child_check_interval_ms: 1,
        },
        ..RuntimeConfig::default()
    };
    store.save(&config).expect("save config");

    let readiness = store
        .load()
        .expect("runtime config should load")
        .opencode_startup;
    assert_eq!(readiness.timeout_ms, 15_000);
    assert_eq!(readiness.connect_timeout_ms, 25);
    assert_eq!(readiness.initial_retry_delay_ms, 3_000);
    assert_eq!(readiness.max_retry_delay_ms, 3_000);
    assert_eq!(readiness.child_check_interval_ms, 10);
}

#[test]
fn runtime_store_preserves_higher_custom_startup_timeout() {
    let harness = TestRuntimeStoreHarness::new("runtime-config-startup-readiness-high-timeout");
    let store = harness.store();
    let config = RuntimeConfig {
        opencode_startup: OpencodeStartupReadinessConfig {
            timeout_ms: 30_000,
            ..RuntimeConfig::default().opencode_startup
        },
        ..RuntimeConfig::default()
    };
    store.save(&config).expect("save config");

    let readiness = store
        .load()
        .expect("runtime config should load")
        .opencode_startup;
    assert_eq!(readiness.timeout_ms, 30_000);
}
