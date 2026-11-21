//! Reads live processes and their TCP listeners, and stops one process instance.
//!
//! The host owns every policy decision. This module only reports operating system facts and
//! performs the checked signal or termination that the host requests.
//!
//! Each platform module gives the same functions: `list_processes`, `inspect_processes`,
//! `read_standard_inputs`, `stop_process`, and `stop_mode`. Windows also gives `open_url`.
//! `parse` holds the pure parsers of the system data formats, which every target tests.

mod issues;
mod model;
mod parse;

#[cfg(unix)]
mod unix;
#[cfg(windows)]
mod windows;

#[cfg(target_os = "linux")]
use unix::linux as platform;
#[cfg(target_os = "macos")]
use unix::macos as platform;
#[cfg(windows)]
use windows as platform;

#[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
compile_error!("The process module supports Linux, macOS, and Windows only.");

use napi::bindgen_prelude::{AsyncTask, Object, ToNapiValue, TypeName};
use napi::{Env, Task};
use napi_derive::napi;
use std::panic::{AssertUnwindSafe, catch_unwind};

pub use model::{
  EvidenceKind, InputKind, NativeInspection, NativeListener, NativeProcess, NativeProcessTarget, NativeStandardInput,
  NativeStopOutcome, NativeStopRequest, StopMode, StopOutcomeKind,
};

/// The text of a panic payload.
fn panic_message(payload: &(dyn std::any::Any + Send)) -> &str {
  payload
    .downcast_ref::<&str>()
    .copied()
    .or_else(|| payload.downcast_ref::<String>().map(String::as_str))
    .unwrap_or("no message")
}

/// Runs `run` and turns a panic into an error. Node-API calls each task from a C callback, where an
/// unwinding panic stops the host process.
fn without_panic<T>(operation: &str, run: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
  catch_unwind(AssertUnwindSafe(run)).unwrap_or_else(|payload| {
    Err(format!(
      "The native {operation} failed unexpectedly: {}. Report this error to OpenDucktor.",
      panic_message(payload.as_ref())
    ))
  })
}

/// Runs one blocking read on the libuv thread pool and resolves its value.
pub struct BlockingTask<T> {
  operation: &'static str,
  run: Option<Box<dyn FnOnce() -> Result<T, String> + Send>>,
}

impl<T: ToNapiValue + TypeName + Send + 'static> Task for BlockingTask<T> {
  type Output = T;
  type JsValue = T;

  fn compute(&mut self) -> napi::Result<Self::Output> {
    let run = self
      .run
      .take()
      .ok_or_else(|| napi::Error::from_reason("The read already ran."))?;
    without_panic(self.operation, run).map_err(napi::Error::from_reason)
  }

  fn resolve(&mut self, _env: Env, output: Self::Output) -> napi::Result<Self::JsValue> {
    Ok(output)
  }
}

fn blocking<T>(
  operation: &'static str,
  run: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> AsyncTask<BlockingTask<T>>
where
  T: ToNapiValue + TypeName + Send + 'static,
{
  AsyncTask::new(BlockingTask {
    operation,
    run: Some(Box::new(run)),
  })
}

/// Lists the live processes that the host account can see.
#[napi(ts_return_type = "Promise<NativeProcess[]>")]
pub fn list_processes() -> AsyncTask<BlockingTask<Vec<NativeProcess>>> {
  blocking("process list", || {
    platform::list_processes().map_err(|error| format!("The system did not list processes: {error}"))
  })
}

/// Reads the TCP listeners and signal permission of each process instance.
#[napi(ts_return_type = "Promise<NativeInspection[]>")]
pub fn inspect_processes(targets: Vec<NativeProcessTarget>) -> AsyncTask<BlockingTask<Vec<NativeInspection>>> {
  blocking("process inspection", move || Ok(platform::inspect_processes(&targets)))
}

/// Reads what the standard input of each instance reads from. On Windows, it also reads which
/// process serves an input pipe.
#[napi(ts_return_type = "Promise<NativeStandardInput[]>")]
pub fn read_standard_inputs(targets: Vec<NativeProcessTarget>) -> AsyncTask<BlockingTask<Vec<NativeStandardInput>>> {
  blocking("input read", move || Ok(platform::read_standard_inputs(&targets)))
}

/// Stops one process instance after it checks the instance identity and directory evidence.
/// The exit wait runs on its own thread, so it never holds a thread of the libuv pool.
///
/// # Errors
///
/// Fails when Node-API cannot create the promise or the system cannot start the thread.
#[napi(ts_return_type = "Promise<NativeStopOutcome>")]
pub fn stop_process(env: &Env, request: NativeStopRequest) -> napi::Result<Object<'_>> {
  let (deferred, promise) = env.create_deferred()?;
  std::thread::Builder::new()
    .name("odt-process-stop".to_string())
    .spawn(
      move || match without_panic("stop", || Ok(platform::stop_process(&request))) {
        Ok(outcome) => deferred.resolve(move |_| Ok(outcome)),
        Err(message) => deferred.reject(napi::Error::from_reason(message)),
      },
    )
    .map_err(|error| napi::Error::from_reason(format!("The stop request could not start: {error}")))?;
  Ok(promise)
}

/// Tells whether a stop signals the exact instance or a PID after a final check.
#[napi]
pub fn stop_mode() -> StopMode {
  platform::stop_mode()
}

/// Opens a URL with the default Windows handler and reports a failure.
#[napi(ts_return_type = "Promise<void>")]
pub fn open_url(url: String) -> AsyncTask<BlockingTask<()>> {
  blocking("URL open", move || {
    #[cfg(windows)]
    return platform::open_url(&url).map_err(|error| format!("Windows could not open the URL: {error}"));
    #[cfg(not(windows))]
    return Err(format!(
      "The native URL opener only runs on Windows. Use the system command for {url}."
    ));
  })
}

#[cfg(test)]
mod tests {
  use super::without_panic;

  #[test]
  fn turns_a_panic_into_an_error() {
    let result = without_panic::<()>("test read", || panic!("a broken table"));
    assert_eq!(
      result.err().as_deref(),
      Some("The native test read failed unexpectedly: a broken table. Report this error to OpenDucktor.")
    );
  }
}
