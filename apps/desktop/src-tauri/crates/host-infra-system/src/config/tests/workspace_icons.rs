use super::{fake_git_workspace, TestStoreHarness};
use crate::config::workspace_icons::discover_workspace_icon_data_url;
use std::fs;

#[test]
fn discover_workspace_icon_data_url_returns_png_data_for_supported_icon() {
    let harness = TestStoreHarness::new("workspace-icon-helper");
    let repo = harness.root().join("repo");
    fake_git_workspace(&repo);
    fs::create_dir_all(repo.join("public")).expect("public dir");
    fs::write(repo.join("public/icon.png"), [0x89, b'P', b'N', b'G']).expect("icon");

    let icon_data_url = discover_workspace_icon_data_url(repo.to_string_lossy().as_ref());

    assert!(icon_data_url
        .as_deref()
        .is_some_and(|value| value.starts_with("data:image/png;base64,")));
}

#[test]
fn discover_workspace_icon_data_url_skips_unsupported_or_empty_candidates() {
    let harness = TestStoreHarness::new("workspace-icon-helper-empty");
    let repo = harness.root().join("repo");
    fake_git_workspace(&repo);
    fs::write(repo.join("icon.svg"), b"<svg></svg>").expect("unsupported icon");
    fs::write(repo.join("favicon.png"), []).expect("empty png");

    let icon_data_url = discover_workspace_icon_data_url(repo.to_string_lossy().as_ref());

    assert!(icon_data_url.is_none());
}
