use super::{touch_recent, unique_temp_path, AppConfigStore, GlobalConfig, TestStoreHarness};
use std::fs;

#[test]
fn save_and_load_report_io_and_parse_errors() {
    let harness = TestStoreHarness::new("config-io-errors");
    let store = harness.store();
    let root = harness.root();

    fs::create_dir_all(root).expect("temp root should exist");
    fs::write(store.path(), "{ invalid json").expect("invalid config should write");
    let parse_error = store.load().expect_err("invalid json should fail parsing");
    assert!(parse_error
        .to_string()
        .contains("Failed parsing config file"));

    let blocked_parent = root.join("not-a-directory");
    fs::write(&blocked_parent, "file").expect("blocking file should write");
    let blocked_store = AppConfigStore::from_path(blocked_parent.join("config.json"));
    let save_error = blocked_store
        .save(&GlobalConfig::default())
        .expect_err("save should fail when parent is a file");
    assert!(save_error
        .to_string()
        .contains("Failed creating config directory"));
}

#[test]
fn app_config_store_constructors_expose_expected_paths() {
    let store = AppConfigStore::new().expect("new store should resolve home path");
    let resolved = store.path().to_string_lossy().to_string();
    assert!(
        resolved.ends_with("/.openducktor/config.json"),
        "unexpected config path: {resolved}"
    );

    let custom_path = unique_temp_path("custom-path").join("custom-config.json");
    let from_path = AppConfigStore::from_path(custom_path.clone());
    assert_eq!(from_path.path(), custom_path.as_path());
}

#[test]
fn touch_recent_keeps_latest_first_and_caps_size() {
    let mut recent = (0..25)
        .map(|index| format!("/tmp/repo-{index}"))
        .collect::<Vec<_>>();
    touch_recent(&mut recent, "/tmp/repo-3");

    assert_eq!(recent.first().map(String::as_str), Some("/tmp/repo-3"));
    assert_eq!(recent.len(), 20);
    assert_eq!(
        recent
            .iter()
            .filter(|entry| entry.as_str() == "/tmp/repo-3")
            .count(),
        1
    );
}
