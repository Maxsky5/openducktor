use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

pub(super) struct TempPath {
    pub(super) path: PathBuf,
}

impl TempPath {
    pub(super) fn new(prefix: &str) -> Self {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "openducktor-git-{prefix}-{}-{nanos}",
            std::process::id()
        ));
        fs::create_dir_all(&path).expect("temporary directory should be created");
        Self { path }
    }
}

impl Drop for TempPath {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

pub(super) fn git_available() -> bool {
    Command::new("git")
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn run_git(cwd: &Path, args: &[&str]) -> Output {
    Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .expect("git command should execute")
}

pub(super) fn run_git_ok(cwd: &Path, args: &[&str]) -> String {
    let output = run_git(cwd, args);
    assert!(
        output.status.success(),
        "git {} failed\nstdout: {}\nstderr: {}",
        args.join(" "),
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

pub(super) fn setup_repo(prefix: &str) -> TempPath {
    let repo = TempPath::new(prefix);
    run_git_ok(&repo.path, &["init", "--initial-branch=main"]);
    run_git_ok(
        &repo.path,
        &["config", "user.email", "tests@openducktor.local"],
    );
    run_git_ok(&repo.path, &["config", "user.name", "OpenDucktor Tests"]);
    fs::write(repo.path.join("README.md"), "# OpenDucktor\n").expect("seed file should write");
    run_git_ok(&repo.path, &["add", "README.md"]);
    run_git_ok(&repo.path, &["commit", "-m", "initial"]);
    repo
}

pub(super) fn setup_bare_remote(prefix: &str) -> TempPath {
    let remote = TempPath::new(prefix);
    run_git_ok(&remote.path, &["init", "--bare", "--initial-branch=main"]);
    remote
}
