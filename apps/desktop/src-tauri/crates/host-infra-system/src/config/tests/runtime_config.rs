use super::{OpencodeStartupReadinessConfig, RuntimeConfig, TestRuntimeStoreHarness};
use host_domain::{
    AgentRuntimeKind, RuntimeDefinition, RuntimeDescriptor, RuntimeRegistry,
    RuntimeStartupReadinessConfig,
};
use std::collections::BTreeMap;
use std::fs;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

fn runtime_registry_with_test_runtime() -> RuntimeRegistry {
    RuntimeRegistry::new_with_default_kind(
        vec![
            host_domain::builtin_runtime_registry()
                .definition_by_str("opencode")
                .expect("builtin opencode runtime should exist")
                .clone(),
            RuntimeDefinition::new(
                RuntimeDescriptor {
                    kind: AgentRuntimeKind::from("test-runtime"),
                    label: "Test Runtime".to_string(),
                    description: "Test runtime".to_string(),
                    read_only_role_blocked_tools: vec!["apply_patch".to_string()],
                    workflow_tool_aliases_by_canonical: Default::default(),
                    capabilities: host_domain::builtin_runtime_registry()
                        .definition_by_str("opencode")
                        .expect("builtin opencode runtime should exist")
                        .descriptor()
                        .capabilities
                        .clone(),
                },
                RuntimeStartupReadinessConfig::default(),
            ),
        ],
        Some(AgentRuntimeKind::opencode()),
    )
    .expect("test runtime registry should build")
}

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

#[test]
fn runtime_store_defaults_registered_non_builtin_runtimes_when_file_is_missing() {
    let harness = TestRuntimeStoreHarness::new_with_runtime_registry(
        "runtime-config-multi-runtime-defaults",
        runtime_registry_with_test_runtime(),
    );

    let loaded = harness
        .store()
        .load()
        .expect("missing runtime config should default from the registered runtimes");

    assert!(loaded.runtimes.contains_key("opencode"));
    assert!(loaded.runtimes.contains_key("test-runtime"));
    assert_eq!(loaded.runtimes["test-runtime"].timeout_ms, 15_000);
}

#[test]
fn runtime_store_normalizes_registered_non_builtin_runtime_entries() {
    let harness = TestRuntimeStoreHarness::new_with_runtime_registry(
        "runtime-config-multi-runtime-normalization",
        runtime_registry_with_test_runtime(),
    );
    let config = RuntimeConfig {
        runtimes: BTreeMap::from([(
            "test-runtime".to_string(),
            OpencodeStartupReadinessConfig {
                timeout_ms: 10,
                connect_timeout_ms: 0,
                initial_retry_delay_ms: 3_000,
                max_retry_delay_ms: 20,
                child_check_interval_ms: 1,
            },
        )]),
        ..RuntimeConfig::from_runtime_registry(&runtime_registry_with_test_runtime())
    };
    harness.store().save(&config).expect("save config");

    let loaded = harness.store().load().expect("runtime config should load");
    let readiness = loaded
        .runtimes
        .get("test-runtime")
        .cloned()
        .expect("registered non-builtin runtime config should exist");

    assert!(loaded.runtimes.contains_key("opencode"));
    assert_eq!(readiness.timeout_ms, 15_000);
    assert_eq!(readiness.connect_timeout_ms, 25);
    assert_eq!(readiness.initial_retry_delay_ms, 3_000);
    assert_eq!(readiness.max_retry_delay_ms, 3_000);
    assert_eq!(readiness.child_check_interval_ms, 10);
}
