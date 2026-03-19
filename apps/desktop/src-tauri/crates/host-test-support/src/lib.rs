use std::env;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex, MutexGuard};

pub static ENV_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

pub fn lock_env<'a>() -> MutexGuard<'a, ()> {
    ENV_LOCK.lock().unwrap_or_else(|poison| poison.into_inner())
}

pub struct EnvVarGuard {
    key: String,
    previous: Option<OsString>,
}

impl EnvVarGuard {
    pub fn set(key: &str, value: &str) -> Self {
        let previous = env::var_os(key);
        env::set_var(key, value);
        Self {
            key: key.to_string(),
            previous,
        }
    }

    pub fn set_os(key: &str, value: OsString) -> Self {
        let previous = env::var_os(key);
        env::set_var(key, &value);
        Self {
            key: key.to_string(),
            previous,
        }
    }

    pub fn remove(key: &str) -> Self {
        let previous = env::var_os(key);
        env::remove_var(key);
        Self {
            key: key.to_string(),
            previous,
        }
    }

    pub fn prepend_path(path_prefix: &Path) -> Self {
        let previous = env::var_os("PATH");
        let joined = joined_path_with_prefix(path_prefix, previous.as_ref());
        env::set_var("PATH", &joined);
        Self {
            key: "PATH".to_string(),
            previous,
        }
    }
}

impl Drop for EnvVarGuard {
    fn drop(&mut self) {
        match self.previous.as_ref() {
            Some(previous) => env::set_var(self.key.as_str(), previous),
            None => env::remove_var(self.key.as_str()),
        }
    }
}

fn joined_path_with_prefix(path_prefix: &Path, previous: Option<&OsString>) -> OsString {
    let entries = std::iter::once(path_prefix.to_path_buf())
        .chain(previous.into_iter().flat_map(env::split_paths))
        .collect::<Vec<PathBuf>>();
    env::join_paths(entries).expect("PATH entries should join successfully")
}

#[cfg(test)]
mod tests {
    use super::{lock_env, EnvVarGuard};
    use std::ffi::OsString;
    use std::path::Path;

    #[test]
    fn env_var_guard_restores_previous_value() {
        let _env_lock = lock_env();
        std::env::set_var("ODT_TEST_GUARD", "before");

        {
            let _guard = EnvVarGuard::set("ODT_TEST_GUARD", "after");
            assert_eq!(std::env::var("ODT_TEST_GUARD").as_deref(), Ok("after"));
        }

        assert_eq!(std::env::var("ODT_TEST_GUARD").as_deref(), Ok("before"));
        std::env::remove_var("ODT_TEST_GUARD");
    }

    #[test]
    fn prepend_path_keeps_existing_entries() {
        let _env_lock = lock_env();
        std::env::set_var("PATH", "/usr/bin:/bin");

        {
            let _guard = EnvVarGuard::prepend_path(Path::new("/tmp/tool"));
            let path = std::env::var_os("PATH").expect("PATH should be set");
            let entries = std::env::split_paths(&path).collect::<Vec<_>>();
            assert_eq!(entries[0], Path::new("/tmp/tool"));
            assert!(entries.iter().any(|entry| entry == Path::new("/usr/bin")));
            assert!(entries.iter().any(|entry| entry == Path::new("/bin")));
        }

        assert_eq!(std::env::var("PATH").as_deref(), Ok("/usr/bin:/bin"));
    }

    #[test]
    fn remove_and_set_os_round_trip() {
        let _env_lock = lock_env();
        std::env::remove_var("ODT_TEST_OS");

        {
            let _guard = EnvVarGuard::set_os("ODT_TEST_OS", OsString::from("value"));
            assert_eq!(std::env::var("ODT_TEST_OS").as_deref(), Ok("value"));
        }

        assert!(std::env::var_os("ODT_TEST_OS").is_none());

        std::env::set_var("ODT_TEST_OS", "value");
        {
            let _guard = EnvVarGuard::remove("ODT_TEST_OS");
            assert!(std::env::var_os("ODT_TEST_OS").is_none());
        }

        assert_eq!(std::env::var("ODT_TEST_OS").as_deref(), Ok("value"));
        std::env::remove_var("ODT_TEST_OS");
    }
}
