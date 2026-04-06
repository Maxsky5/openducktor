use crate::TauriRuntime;
use anyhow::{anyhow, Context, Result};
use objc2::{
    define_class, ffi, msg_send,
    rc::Retained,
    runtime::{AnyObject, Imp, NSObject, NSObjectProtocol, ProtocolObject, Sel},
    sel, DefinedClass, MainThreadMarker, MainThreadOnly,
};
use objc2_app_kit::{NSApp, NSApplication, NSApplicationDelegate, NSApplicationTerminateReply};
use objc2_foundation::NSArray;
use std::cell::RefCell;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use tauri::{App, AppHandle, Manager};

thread_local! {
    static QUIT_DELEGATE: RefCell<Option<Retained<QuitDelegate>>> = const { RefCell::new(None) };
}

static ORDERLY_QUIT_REQUESTED: AtomicBool = AtomicBool::new(false);
static QUIT_APP_HANDLE: OnceLock<AppHandle<TauriRuntime>> = OnceLock::new();
static ORIGINAL_TERMINATE_IMP: OnceLock<Imp> = OnceLock::new();
static TERMINATE_INTERPOSED: OnceLock<()> = OnceLock::new();

struct QuitDelegateIvars {
    app_handle: AppHandle<TauriRuntime>,
    original_delegate: Retained<ProtocolObject<dyn NSApplicationDelegate>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum QuitAction {
    StartOrderlyQuit,
    WaitForWindowTeardown,
    AllowTerminate,
}

define_class!(
    #[unsafe(super(NSObject))]
    #[name = "OpenDucktorCefQuitDelegate"]
    #[ivars = QuitDelegateIvars]
    #[thread_kind = MainThreadOnly]
    struct QuitDelegate;

    unsafe impl NSObjectProtocol for QuitDelegate {}

    #[allow(non_snake_case)]
    impl QuitDelegate {
        #[unsafe(method(forwardingTargetForSelector:))]
        unsafe fn forwardingTargetForSelector(&self, selector: Sel) -> *mut AnyObject {
            if selector == sel!(applicationShouldTerminate:)
                || selector == sel!(application:openURLs:)
            {
                std::ptr::null_mut()
            } else {
                Retained::as_ptr(&self.ivars().original_delegate)
                    .cast::<AnyObject>()
                    .cast_mut()
            }
        }
    }

    #[allow(non_snake_case)]
    unsafe impl NSApplicationDelegate for QuitDelegate {
        #[unsafe(method(application:openURLs:))]
        unsafe fn application_openURLs(
            &self,
            application: &NSApplication,
            urls: &NSArray<objc2_foundation::NSURL>,
        ) {
            if self
                .ivars()
                .original_delegate
                .respondsToSelector(sel!(application:openURLs:))
            {
                self.ivars()
                    .original_delegate
                    .application_openURLs(application, urls);
            }
        }

        #[unsafe(method(applicationShouldTerminate:))]
        unsafe fn applicationShouldTerminate(
            &self,
            sender: &NSApplication,
        ) -> NSApplicationTerminateReply {
            match decide_quit_action(
                self.ivars().app_handle.webview_windows().len(),
                ORDERLY_QUIT_REQUESTED.load(Ordering::SeqCst),
            ) {
                QuitAction::StartOrderlyQuit => {
                    ORDERLY_QUIT_REQUESTED.store(true, Ordering::SeqCst);
                    log_orderly_quit_start(self.ivars().app_handle.webview_windows().len());
                    request_orderly_quit(&self.ivars().app_handle);
                    return NSApplicationTerminateReply::TerminateCancel;
                }
                QuitAction::WaitForWindowTeardown => {
                    tracing::debug!(
                        target: "openducktor.cef.quit",
                        open_window_count = self.ivars().app_handle.webview_windows().len(),
                        "Ignoring applicationShouldTerminate while CEF windows are still closing"
                    );
                    return NSApplicationTerminateReply::TerminateCancel;
                }
                QuitAction::AllowTerminate => {
                    ORDERLY_QUIT_REQUESTED.store(false, Ordering::SeqCst);
                    tracing::debug!(
                        target: "openducktor.cef.quit",
                        "Allowing applicationShouldTerminate after CEF windows closed"
                    );
                }
            }

            if self
                .ivars()
                .original_delegate
                .respondsToSelector(sel!(applicationShouldTerminate:))
            {
                return self
                    .ivars()
                    .original_delegate
                    .applicationShouldTerminate(sender);
            }

            NSApplicationTerminateReply::TerminateNow
        }
    }
);

impl QuitDelegate {
    fn new(
        mtm: MainThreadMarker,
        app_handle: AppHandle<TauriRuntime>,
        original_delegate: Retained<ProtocolObject<dyn NSApplicationDelegate>>,
    ) -> Retained<Self> {
        let delegate = Self::alloc(mtm).set_ivars(QuitDelegateIvars {
            app_handle,
            original_delegate,
        });
        unsafe { msg_send![super(delegate), init] }
    }
}

type TerminateImp = unsafe extern "C-unwind" fn(&NSApplication, Sel, *mut AnyObject);

unsafe extern "C-unwind" fn intercept_terminate(
    this: &NSApplication,
    cmd: Sel,
    sender: *mut AnyObject,
) {
    let Some(app_handle) = QUIT_APP_HANDLE.get() else {
        call_original_terminate(this, cmd, sender);
        return;
    };

    match decide_quit_action(
        app_handle.webview_windows().len(),
        ORDERLY_QUIT_REQUESTED.load(Ordering::SeqCst),
    ) {
        QuitAction::StartOrderlyQuit => {
            ORDERLY_QUIT_REQUESTED.store(true, Ordering::SeqCst);
            log_orderly_quit_start(app_handle.webview_windows().len());
            request_orderly_quit(app_handle);
        }
        QuitAction::WaitForWindowTeardown => {
            tracing::debug!(
                target: "openducktor.cef.quit",
                open_window_count = app_handle.webview_windows().len(),
                "Ignoring repeated terminate: while CEF windows are still closing"
            );
        }
        QuitAction::AllowTerminate => {
            ORDERLY_QUIT_REQUESTED.store(false, Ordering::SeqCst);
            tracing::info!(
                target: "openducktor.cef.quit",
                "Forwarding native terminate: after all CEF windows closed"
            );
            call_original_terminate(this, cmd, sender);
        }
    }
}

fn log_orderly_quit_start(open_window_count: usize) {
    tracing::info!(
        target: "openducktor.cef.quit",
        open_window_count,
        "Starting orderly macOS CEF quit from native terminate:"
    );
}

fn call_original_terminate(this: &NSApplication, cmd: Sel, sender: *mut AnyObject) {
    let Some(original_imp) = ORIGINAL_TERMINATE_IMP.get().copied() else {
        return;
    };
    let original: TerminateImp = unsafe { std::mem::transmute(original_imp) };
    unsafe {
        original(this, cmd, sender);
    }
}

fn install_terminate_interpose(ns_app: &NSApplication) -> Result<()> {
    if TERMINATE_INTERPOSED.get().is_some() {
        return Ok(());
    }

    let app_class = ns_app.class() as *const _ as *mut _;
    let terminate_sel = sel!(terminate:);
    let terminate_method = unsafe { ffi::class_getInstanceMethod(app_class, terminate_sel) };
    let terminate_method = unsafe { terminate_method.as_ref() }
        .context("missing terminate: method on CEF NSApplication class")?;
    let original_imp = unsafe { ffi::method_getImplementation(terminate_method) }
        .context("missing terminate: implementation on CEF NSApplication class")?;
    let type_encoding = unsafe { ffi::method_getTypeEncoding(terminate_method) };

    ORIGINAL_TERMINATE_IMP
        .set(original_imp)
        .map_err(|_| anyhow!("original terminate: implementation already registered"))?;

    let intercept_imp: Imp = unsafe { std::mem::transmute(intercept_terminate as TerminateImp) };

    unsafe {
        ffi::class_replaceMethod(app_class, terminate_sel, intercept_imp, type_encoding);
    }

    TERMINATE_INTERPOSED
        .set(())
        .map_err(|_| anyhow!("CEF terminate: interpose already installed"))?;

    tracing::info!(
        target: "openducktor.cef.quit",
        app_class = %ns_app.class().name().to_string_lossy(),
        "Installed macOS CEF terminate: interpose"
    );

    Ok(())
}

fn decide_quit_action(open_window_count: usize, orderly_quit_requested: bool) -> QuitAction {
    if open_window_count == 0 {
        return QuitAction::AllowTerminate;
    }

    if orderly_quit_requested {
        QuitAction::WaitForWindowTeardown
    } else {
        QuitAction::StartOrderlyQuit
    }
}

fn request_orderly_quit(app_handle: &AppHandle<TauriRuntime>) {
    for window in app_handle.webview_windows().into_values() {
        if let Err(error) = window.close() {
            tracing::warn!(
                target: "openducktor.cef.quit",
                error = %format!("{error:#}"),
                "Failed requesting graceful CEF window close during app quit"
            );
        }
    }
}

pub(crate) fn install(app: &mut App<TauriRuntime>) -> Result<()> {
    let mtm = MainThreadMarker::new().context("macOS quit delegate requires main thread")?;
    let ns_app = NSApp(mtm);
    let _ = QUIT_APP_HANDLE.set(app.handle().clone());
    install_terminate_interpose(&ns_app)?;
    let original_delegate = ns_app
        .delegate()
        .context("missing NSApplication delegate for CEF runtime")?;
    let delegate = QuitDelegate::new(mtm, app.handle().clone(), original_delegate);
    ns_app.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
    QUIT_DELEGATE.with(|slot| {
        slot.replace(Some(delegate));
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn intercepts_first_quit_with_open_windows() {
        assert_eq!(decide_quit_action(1, false), QuitAction::StartOrderlyQuit);
    }

    #[test]
    fn waits_for_open_windows_to_finish_closing_after_quit_request() {
        assert_eq!(
            decide_quit_action(3, true),
            QuitAction::WaitForWindowTeardown
        );
        assert_eq!(
            decide_quit_action(1, true),
            QuitAction::WaitForWindowTeardown
        );
    }

    #[test]
    fn allows_terminate_once_all_windows_are_gone() {
        assert_eq!(decide_quit_action(0, false), QuitAction::AllowTerminate);
        assert_eq!(decide_quit_action(0, true), QuitAction::AllowTerminate);
    }
}
