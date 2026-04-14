use super::{OpencodeStartupReadinessConfig, RuntimeConfig, TestRuntimeStoreHarness};
use std::collections::BTreeMap;
use std::fs;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

#[test]
fn runtime_store_defaults_and_normalizes_startup_readiness() {
    assert_eq!(
        RuntimeConfig::default().runtimes["opencode"].timeout_ms,
        15_000
    );

    let harness = TestRuntimeStoreHarness::new("runtime-config-startup-readiness");
    let store = harness.store();
    let config = RuntimeConfig {
        runtimes: BTreeMap::from([(
            "opencode".to_string(),
            OpencodeStartupReadinessConfig {
                timeout_ms: 10,
                connect_timeout_ms: 0,
                initial_retry_delay_ms: 3_000,
                max_retry_delay_ms: 20,
                child_check_interval_ms: 1,
            },
        )]),
        ..RuntimeConfig::default()
    };
    store.save(&config).expect("save config");

    let loaded = store.load().expect("runtime config should load");
    let readiness = loaded
        .runtimes
        .get("opencode")
        .cloned()
        .expect("opencode runtime config should exist");
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
        runtimes: BTreeMap::from([(
            "opencode".to_string(),
            OpencodeStartupReadinessConfig {
                timeout_ms: 30_000,
                ..RuntimeConfig::default().runtimes["opencode"].clone()
            },
        )]),
        ..RuntimeConfig::default()
    };
    store.save(&config).expect("save config");

    let readiness = store
        .load()
        .expect("runtime config should load")
        .runtimes
        .get("opencode")
        .cloned()
        .expect("opencode runtime config should exist");
    assert_eq!(readiness.timeout_ms, 30_000);
}

#[test]
fn runtime_store_migrates_legacy_opencode_startup_field() {
    let harness = TestRuntimeStoreHarness::new("runtime-config-legacy-opencode-startup");
    let store = harness.store();
    fs::create_dir_all(
        store
            .path()
            .parent()
            .expect("runtime config path should have a parent directory"),
    )
    .expect("runtime config directory should exist");
    fs::write(
        store.path(),
        r#"{
  "version": 1,
  "opencodeStartup": {
    "timeoutMs": 17000,
    "connectTimeoutMs": 300,
    "initialRetryDelayMs": 40,
    "maxRetryDelayMs": 80,
    "childCheckIntervalMs": 90
  },
  "scheduler": {}
}"#,
    )
    .expect("legacy runtime config should be written");
    #[cfg(unix)]
    fs::set_permissions(store.path(), fs::Permissions::from_mode(0o600))
        .expect("legacy runtime config should have private permissions");

    let loaded = store.load().expect("legacy runtime config should load");
    let readiness = loaded
        .runtimes
        .get("opencode")
        .cloned()
        .expect("legacy opencode startup config should migrate into runtimes map");

    assert_eq!(readiness.timeout_ms, 17_000);
    assert_eq!(readiness.connect_timeout_ms, 300);
    assert_eq!(readiness.initial_retry_delay_ms, 40);
    assert_eq!(readiness.max_retry_delay_ms, 80);
    assert_eq!(readiness.child_check_interval_ms, 90);
}
