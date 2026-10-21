import type {
  BrowserDownload,
  BrowserEngineKind,
  BrowserEngineState,
  BrowserPermissionKind,
  BrowserTabSurface,
} from "@openducktor/contracts";
import { Data, Effect, type Scope } from "effect";
import type { JSONType } from "zod";
import { errorMessage } from "../effect/host-errors";

/** CDP command parameters, results, and event parameters. Each consumer parses what it reads. */
export type CdpPayload = Record<string, JSONType>;

export type CdpEvent = {
  readonly method: string;
  readonly params: CdpPayload;
  /** The session that sent the event: a tab session or one of its child sessions. */
  readonly sessionId: string;
};

/** A protocol error that Chromium returned for one command. */
export class CdpProtocolError extends Error {
  readonly code: number | null;
  readonly method: string;

  constructor(method: string, message: string, code: number | null) {
    super(message);
    this.name = "CdpProtocolError";
    this.method = method;
    this.code = code;
  }
}

export class CdpCommandError extends Data.TaggedError("CdpCommandError")<{
  readonly message: string;
  readonly cause: unknown;
}> {}

/**
 * One Chromium DevTools session for one tab. Each client gets its own session, so the domains
 * that one client enables and its detach do not change another client.
 */
export type CdpSession = {
  readonly sessionId: string;
  readonly targetId: string;
  /**
   * Sends a command to this session, or to one of its child sessions. Rejects with
   * `CdpProtocolError`. The CDP proxy forwards client commands with it: the reply reaches the
   * client in one promise job, so it keeps its order with the events that follow it.
   */
  request(method: string, params?: CdpPayload, childSessionId?: string): Promise<CdpPayload>;
  send(
    method: string,
    params?: CdpPayload,
    childSessionId?: string,
  ): Effect.Effect<CdpPayload, CdpCommandError>;
  /** Events of this session and of the child sessions that it attached. */
  subscribe(listener: (event: CdpEvent) => void): () => void;
  /** Calls the listener once when the session ends. */
  onDetached(listener: (reason: string) => void): () => void;
  /** True for this session and its child sessions. */
  ownsSession(sessionId: string): boolean;
};

/** Runs one CDP request as an Effect. A rejection becomes a `CdpCommandError`. */
export const sendCdp = <A>(request: () => Promise<A>): Effect.Effect<A, CdpCommandError> =>
  Effect.tryPromise({
    try: request,
    catch: (cause) => new CdpCommandError({ message: errorMessage(cause), cause }),
  });

export class BrowserEngineError extends Data.TaggedError("BrowserEngineError")<{
  readonly code:
    | "tab_not_found"
    | "download_not_found"
    | "not_ready"
    | "unsupported"
    | "operation_failed";
  readonly operation: string;
  readonly message: string;
  readonly tabId?: string;
  readonly cause?: unknown;
}> {}

export type BrowserEngineTabSpec = {
  readonly tabId: string;
  readonly workspaceId: string;
  readonly url: string;
};

export type BrowserEngineEvent =
  /** The page of the tab exists and accepts sessions. */
  | { readonly type: "tab_attached"; readonly tabId: string }
  /** The page ended without a close from the host, for example after an Electron renderer reload. */
  | { readonly type: "tab_detached"; readonly tabId: string }
  /**
   * The page closed by itself, for example with `window.close()`, or its browser stopped. The
   * engine forgot the tab, so it cannot come back.
   */
  | { readonly type: "tab_ended"; readonly tabId: string }
  /** The engine created a tab for a popup. The host closes it when the owner is at its limit. */
  | {
      readonly type: "popup_opened";
      readonly openerTabId: string;
      readonly tabId: string;
      readonly url: string;
      readonly surface: BrowserTabSurface;
      readonly keepsOpener: boolean;
    }
  | {
      readonly type: "permission_requested";
      readonly tabId: string;
      readonly origin: string;
      readonly permission: BrowserPermissionKind;
      respond(granted: boolean): void;
      /**
       * Calls the listener once when the document that asked ends, for example after a navigation
       * of its frame. The engine then denies the request, and a later `respond` does nothing. A
       * listener that comes after the end runs at once.
       */
      onEnded(listener: () => void): () => void;
    }
  | {
      readonly type: "certificate_error";
      readonly tabId: string;
      readonly url: string;
      readonly host: string;
      readonly error: string;
      /**
       * False for a subresource, such as an image or a script. The host answers it from the
       * exceptions that the user accepted and never asks the user.
       */
      readonly mainFrame: boolean;
      respond(proceed: boolean): void;
    }
  | {
      readonly type: "download_updated";
      readonly tabId: string;
      readonly download: BrowserDownload;
    }
  | {
      readonly type: "page_notification";
      readonly tabId: string;
      readonly origin: string;
      readonly title: string;
      readonly body: string;
    }
  /** Electron kept the page after `beforeunload`. `url` is the navigation that the page stopped. */
  | { readonly type: "navigation_held"; readonly tabId: string; readonly url: string | null }
  /** The engine blocked a top-level navigation to a scheme other than `http` or `https`. */
  | { readonly type: "scheme_refused"; readonly tabId: string; readonly scheme: string }
  | { readonly type: "state_changed"; readonly state: BrowserEngineState };

export type BrowserInstaller = {
  start(): Effect.Effect<void, BrowserEngineError>;
  cancel(): Effect.Effect<void>;
};

type BrowserEngineWindows = {
  showPopupWindow(tabId: string): Effect.Effect<void, BrowserEngineError>;
  revealDownload(tabId: string, downloadId: string): Effect.Effect<void, BrowserEngineError>;
};

type BrowserEngineDevTools = {
  /** The bundled DevTools frontend URL that connects to the DevTools endpoint for this tab. */
  frontendUrl(tabId: string): Effect.Effect<string, BrowserEngineError>;
};

/**
 * A browser engine. The host drives every page feature over CDP sessions from `openSession`.
 * Engine events carry only the page events that CDP does not give in both engines.
 */
export type BrowserEnginePort = {
  readonly kind: BrowserEngineKind;
  /** Chrome for Testing only. */
  readonly installer: BrowserInstaller | null;
  /** Electron only. */
  readonly windows: BrowserEngineWindows | null;
  /** Electron only. */
  readonly devTools: BrowserEngineDevTools | null;
  /**
   * True when the panels show the pages of this engine, so the user can answer their prompts, such
   * as a certificate warning: Electron. The web runner shows user tabs in iframes of its app, so
   * its engine has only agent pages, which the user does not see.
   */
  readonly showsPagesToUser: boolean;
  state(): BrowserEngineState;
  createTab(spec: BrowserEngineTabSpec): Effect.Effect<void, BrowserEngineError>;
  /** Ends the page at once. The page cannot delay the close with `beforeunload`. */
  closeTab(tabId: string): Effect.Effect<void, BrowserEngineError>;
  openSession(tabId: string): Effect.Effect<CdpSession, BrowserEngineError, Scope.Scope>;
  /** Keeps the page drawn and unthrottled while the scope is open. */
  holdWake(tabId: string): Effect.Effect<void, never, Scope.Scope>;
  /**
   * Reloads the page of the tab. Electron reloads the guest itself: CDP `Page.reload` of a
   * `<webview>` guest reloads the window that holds it.
   */
  reloadPage(tabId: string, ignoreCache: boolean): Effect.Effect<void, BrowserEngineError>;
  /**
   * Runs CDP `Page.captureScreenshot` with the CDP parameters on the page of the tab, and returns
   * the CDP result. Electron takes a clip in the viewport from the drawn page: a CDP clip moves a
   * shown `<webview>` page for one frame.
   */
  captureScreenshot(
    tabId: string,
    params: CdpPayload,
  ): Effect.Effect<CdpPayload, BrowserEngineError>;
  /** Allows the next `beforeunload` of the tab, so a held navigation can leave the page. */
  allowNextUnload(tabId: string): Effect.Effect<void, BrowserEngineError>;
  /**
   * Ends the live permission grants of a site in a workspace, so the next request of the site asks
   * the host again. `null` covers every permission kind.
   */
  revokeSitePermissions(
    workspaceId: string,
    origin: string,
    permission: BrowserPermissionKind | null,
  ): Effect.Effect<void, BrowserEngineError>;
  deleteWorkspaceProfile(workspaceId: string): Effect.Effect<void, BrowserEngineError>;
  subscribe(listener: (event: BrowserEngineEvent) => void): () => void;
  dispose(): Effect.Effect<void>;
};
