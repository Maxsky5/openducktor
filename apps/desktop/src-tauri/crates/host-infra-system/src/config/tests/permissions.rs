use super::{unique_temp_path, AppConfigStore, GlobalConfig, RuntimeConfig, RuntimeConfigStore};
use std::fs;
use std::path::PathBuf;

#[cfg(unix)]
use std::{fs::Permissions, os::unix::fs::PermissionsExt};

#[cfg(unix)]
fn strict_app_store(name: &str) -> (AppConfigStore, PathBuf) {
    let root = unique_temp_path(name);
    let path = root.join("config.json");
    (
        AppConfigStore {
            path,
            enforce_private_parent_permissions: true,
        },
        root,
    )
}

#[cfg(unix)]
fn strict_runtime_store(name: &str) -> (RuntimeConfigStore, PathBuf) {
    let root = unique_temp_path(name);
    let path = root.join("runtime-config.json");
    (
        RuntimeConfigStore {
            path,
            enforce_private_parent_permissions: true,
        },
        root,
    )
}

#[cfg(unix)]
#[test]
fn app_save_enforces_private_permissions_for_config_directory_and_file() {
    let (store, root) = strict_app_store("app-config-permissions-save");
    store.save(&GlobalConfig::default()).expect("save config");

    let parent = store.path().parent().expect("config parent should exist");
    let dir_mode = fs::metadata(parent)
        .expect("directory metadata")
        .permissions()
        .mode()
        & 0o777;
    let file_mode = fs::metadata(store.path())
        .expect("file metadata")
        .permissions()
        .mode()
        & 0o777;
    assert_eq!(dir_mode, 0o700);
    assert_eq!(file_mode, 0o600);

    let _ = fs::remove_dir_all(root);
}

#[cfg(unix)]
#[test]
fn app_load_rejects_config_file_mode_that_is_not_0600() {
    let (store, root) = strict_app_store("app-config-permissions-file-load");
    store.save(&GlobalConfig::default()).expect("save config");

    fs::set_permissions(store.path(), Permissions::from_mode(0o400))
        .expect("config file permission should change");

    let error = store
        .load()
        .expect_err("load should reject unsupported config file mode");
    assert!(error.to_string().contains("Expected 0600 exactly"));
    assert!(error.to_string().contains("chmod 600"));

    let _ = fs::remove_dir_all(root);
}

#[cfg(unix)]
#[test]
fn app_load_rejects_config_directory_mode_that_is_not_0700() {
    let (store, root) = strict_app_store("app-config-permissions-dir-load");
    store.save(&GlobalConfig::default()).expect("save config");

    let parent = store.path().parent().expect("config parent should exist");
    fs::set_permissions(parent, Permissions::from_mode(0o500))
        .expect("config directory permission should change");

    let error = store
        .load()
        .expect_err("load should reject unsupported config directory mode");
    assert!(error.to_string().contains("Expected 0700 exactly"));
    assert!(error.to_string().contains("chmod 700"));

    let _ = fs::remove_dir_all(root);
}

#[cfg(unix)]
#[test]
fn app_from_path_does_not_enforce_private_parent_directory_permissions() {
    let root = unique_temp_path("app-custom-config-parent-permissions");
    let custom_parent = root.join("shared-config-dir");
    fs::create_dir_all(&custom_parent).expect("custom parent should be created");
    fs::set_permissions(&custom_parent, Permissions::from_mode(0o755))
        .expect("custom parent should be non-private");

    let store = AppConfigStore::from_path(custom_parent.join("config.json"));
    store
        .save(&GlobalConfig::default())
        .expect("save should succeed");
    store.load().expect("load should succeed");

    let parent_mode = fs::metadata(&custom_parent)
        .expect("parent metadata")
        .permissions()
        .mode()
        & 0o777;
    let file_mode = fs::metadata(store.path())
        .expect("file metadata")
        .permissions()
        .mode()
        & 0o777;
    assert_eq!(parent_mode, 0o755);
    assert_eq!(file_mode, 0o600);

    let _ = fs::remove_dir_all(root);
}

#[cfg(unix)]
#[test]
fn runtime_save_enforces_private_permissions_for_config_directory_and_file() {
    let (store, root) = strict_runtime_store("runtime-config-permissions-save");
    store.save(&RuntimeConfig::default()).expect("save config");

    let parent = store.path().parent().expect("config parent should exist");
    let dir_mode = fs::metadata(parent)
        .expect("directory metadata")
        .permissions()
        .mode()
        & 0o777;
    let file_mode = fs::metadata(store.path())
        .expect("file metadata")
        .permissions()
        .mode()
        & 0o777;
    assert_eq!(dir_mode, 0o700);
    assert_eq!(file_mode, 0o600);

    let _ = fs::remove_dir_all(root);
}

#[cfg(unix)]
#[test]
fn runtime_load_rejects_config_file_mode_that_is_not_0600() {
    let (store, root) = strict_runtime_store("runtime-config-permissions-file-load");
    store.save(&RuntimeConfig::default()).expect("save config");

    fs::set_permissions(store.path(), Permissions::from_mode(0o400))
        .expect("config file permission should change");

    let error = store
        .load()
        .expect_err("load should reject unsupported config file mode");
    assert!(error.to_string().contains("Expected 0600 exactly"));
    assert!(error.to_string().contains("chmod 600"));

    let _ = fs::remove_dir_all(root);
}

#[cfg(unix)]
#[test]
fn runtime_load_rejects_config_directory_mode_that_is_not_0700() {
    let (store, root) = strict_runtime_store("runtime-config-permissions-dir-load");
    store.save(&RuntimeConfig::default()).expect("save config");

    let parent = store.path().parent().expect("config parent should exist");
    fs::set_permissions(parent, Permissions::from_mode(0o500))
        .expect("config directory permission should change");

    let error = store
        .load()
        .expect_err("load should reject unsupported config directory mode");
    assert!(error.to_string().contains("Expected 0700 exactly"));
    assert!(error.to_string().contains("chmod 700"));

    let _ = fs::remove_dir_all(root);
}

#[cfg(unix)]
#[test]
fn runtime_from_path_does_not_enforce_private_parent_directory_permissions() {
    let root = unique_temp_path("runtime-custom-config-parent-permissions");
    let custom_parent = root.join("shared-runtime-config-dir");
    fs::create_dir_all(&custom_parent).expect("custom parent should be created");
    fs::set_permissions(&custom_parent, Permissions::from_mode(0o755))
        .expect("custom parent should be non-private");

    let store = RuntimeConfigStore::from_path(custom_parent.join("runtime-config.json"));
    store
        .save(&RuntimeConfig::default())
        .expect("save should succeed");
    store.load().expect("load should succeed");

    let parent_mode = fs::metadata(&custom_parent)
        .expect("parent metadata")
        .permissions()
        .mode()
        & 0o777;
    let file_mode = fs::metadata(store.path())
        .expect("file metadata")
        .permissions()
        .mode()
        & 0o777;
    assert_eq!(parent_mode, 0o755);
    assert_eq!(file_mode, 0o600);

    let _ = fs::remove_dir_all(root);
}
