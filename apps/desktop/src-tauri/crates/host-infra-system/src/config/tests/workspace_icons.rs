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
fn discover_workspace_icon_data_url_returns_svg_data_for_src_assets_logo() {
    let harness = TestStoreHarness::new("workspace-icon-helper-src-assets-svg");
    let repo = harness.root().join("repo");
    fake_git_workspace(&repo);
    fs::create_dir_all(repo.join("src/assets")).expect("src assets dir");
    fs::write(repo.join("src/assets/logo.svg"), b"<svg viewBox='0 0 1 1'></svg>")
        .expect("svg icon");

    let icon_data_url = discover_workspace_icon_data_url(repo.to_string_lossy().as_ref());

    assert!(icon_data_url
        .as_deref()
        .is_some_and(|value| value.starts_with("data:image/svg+xml;base64,")));
}

#[test]
fn discover_workspace_icon_data_url_returns_jpeg_data_for_app_icon() {
    let harness = TestStoreHarness::new("workspace-icon-helper-app-jpeg");
    let repo = harness.root().join("repo");
    fake_git_workspace(&repo);
    fs::create_dir_all(repo.join("app")).expect("app dir");
    fs::write(repo.join("app/icon.jpg"), [0xFF, 0xD8, 0xFF, 0xDB]).expect("jpeg icon");

    let icon_data_url = discover_workspace_icon_data_url(repo.to_string_lossy().as_ref());

    assert!(icon_data_url
        .as_deref()
        .is_some_and(|value| value.starts_with("data:image/jpeg;base64,")));
}

#[test]
fn discover_workspace_icon_data_url_invalidates_cache_when_icon_is_removed() {
    let harness = TestStoreHarness::new("workspace-icon-helper-cache-invalidate");
    let repo = harness.root().join("repo");
    fake_git_workspace(&repo);
    fs::write(repo.join("icon.svg"), b"<svg viewBox='0 0 1 1'></svg>").expect("svg icon");

    let first_icon_data_url = discover_workspace_icon_data_url(repo.to_string_lossy().as_ref());
    assert!(first_icon_data_url.is_some());

    fs::remove_file(repo.join("icon.svg")).expect("remove svg icon");

    let second_icon_data_url = discover_workspace_icon_data_url(repo.to_string_lossy().as_ref());
    assert!(second_icon_data_url.is_none());
}

#[test]
fn discover_workspace_icon_data_url_skips_large_icons() {
    let harness = TestStoreHarness::new("workspace-icon-helper-large");
    let repo = harness.root().join("repo");
    fake_git_workspace(&repo);
    fs::write(repo.join("logo.svg"), vec![b'a'; (512 * 1024) + 1]).expect("large icon");

    let icon_data_url = discover_workspace_icon_data_url(repo.to_string_lossy().as_ref());

    assert!(icon_data_url.is_none());
}

#[test]
fn discover_workspace_icon_data_url_skips_icons_that_grow_during_read() {
    let harness = TestStoreHarness::new("workspace-icon-helper-bounded-read");
    let repo = harness.root().join("repo");
    fake_git_workspace(&repo);
    fs::write(repo.join("logo.svg"), vec![b'a'; 32]).expect("small icon");

    let _metadata = fs::metadata(repo.join("logo.svg")).expect("metadata");
    fs::write(repo.join("logo.svg"), vec![b'a'; (512 * 1024) + 1]).expect("grown icon");

    let icon_data_url = discover_workspace_icon_data_url(repo.to_string_lossy().as_ref());

    assert!(icon_data_url.is_none());
}

#[test]
fn discover_workspace_icon_data_url_skips_unsupported_or_empty_candidates() {
    let harness = TestStoreHarness::new("workspace-icon-helper-empty");
    let repo = harness.root().join("repo");
    fake_git_workspace(&repo);
    fs::write(repo.join("icon.webp"), b"RIFF").expect("unsupported icon");
    fs::write(repo.join("favicon.png"), []).expect("empty png");

    let icon_data_url = discover_workspace_icon_data_url(repo.to_string_lossy().as_ref());

    assert!(icon_data_url.is_none());
}
