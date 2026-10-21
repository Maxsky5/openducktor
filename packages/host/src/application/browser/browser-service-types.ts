import type {
  BrowserAnnotationCapture,
  BrowserAnnotationCaptureRequest,
  BrowserClientMessage,
  BrowserEngineKind,
  BrowserEngineState,
  BrowserPickerSetRequest,
  BrowserPromptAnswerRequest,
  BrowserServerMessage,
  BrowserSitePermissionsRequest,
  BrowserSitePermissionsResetRequest,
  BrowserSitePermissionsResponse,
  BrowserTabFrameStateRequest,
  BrowserTabNavigateRequest,
  BrowserTabOpenRequest,
  BrowserTabOwner,
  BrowserTabSetSharedRequest,
  BrowserTabSummary,
  OdtBrowserToolInput,
  OdtBrowserToolName,
  OdtBrowserToolResult,
} from "@openducktor/contracts";
import type { Effect } from "effect";
import type { BrowserServiceError } from "./browser-service-error";

/** One Electron window connection over IPC. */
export type BrowserClientSession = {
  handle(message: BrowserClientMessage): Effect.Effect<void>;
  close(): Effect.Effect<void>;
};

export type BrowserClientSessionInput = {
  clientId: string;
  send(message: BrowserServerMessage): void;
};

/** One Electron DevTools frontend connection to one tab. Messages are CDP JSON text. */
export type BrowserDevToolsConnection = {
  handle(message: string): Effect.Effect<void, BrowserServiceError>;
  close(): Effect.Effect<void>;
};

export type BrowserDevToolsPeer = {
  send(message: string): void;
  /** The tab ended, so the connection ends too. */
  close(): void;
};

export type BrowserService = {
  readonly engineKind: BrowserEngineKind;
  state(): BrowserEngineState;
  listTabs(): Effect.Effect<BrowserTabSummary[], BrowserServiceError>;
  openTab(request: BrowserTabOpenRequest): Effect.Effect<BrowserTabSummary, BrowserServiceError>;
  /** Gives a saved tab its page. A tab that started stays as it is. */
  startTab(tabId: string): Effect.Effect<BrowserTabSummary, BrowserServiceError>;
  /** Takes the page state of a user tab that a client shows in a frame. */
  reportFrameState(request: BrowserTabFrameStateRequest): Effect.Effect<void, BrowserServiceError>;
  closeTab(tabId: string): Effect.Effect<void, BrowserServiceError>;
  navigate(request: BrowserTabNavigateRequest): Effect.Effect<void, BrowserServiceError>;
  setShared(
    request: BrowserTabSetSharedRequest,
  ): Effect.Effect<BrowserTabSummary, BrowserServiceError>;
  answerPrompt(request: BrowserPromptAnswerRequest): Effect.Effect<void, BrowserServiceError>;
  readSitePermissions(
    request: BrowserSitePermissionsRequest,
  ): Effect.Effect<BrowserSitePermissionsResponse, BrowserServiceError>;
  resetSitePermissions(
    request: BrowserSitePermissionsResetRequest,
  ): Effect.Effect<void, BrowserServiceError>;
  setPicker(request: BrowserPickerSetRequest): Effect.Effect<void, BrowserServiceError>;
  captureAnnotation(
    request: BrowserAnnotationCaptureRequest,
  ): Effect.Effect<BrowserAnnotationCapture, BrowserServiceError>;
  revealDownload(tabId: string, downloadId: string): Effect.Effect<void, BrowserServiceError>;
  showPopupWindow(tabId: string): Effect.Effect<void, BrowserServiceError>;
  openDevTools(tabId: string): Effect.Effect<{ frontendUrl: string }, BrowserServiceError>;
  connectClient(input: BrowserClientSessionInput): BrowserClientSession;
  connectDevTools(
    tabId: string,
    peer: BrowserDevToolsPeer,
  ): Effect.Effect<BrowserDevToolsConnection, BrowserServiceError>;
  runAgentTool<Name extends OdtBrowserToolName>(
    owner: BrowserTabOwner,
    name: Name,
    input: OdtBrowserToolInput<Name>,
  ): Effect.Effect<OdtBrowserToolResult, BrowserServiceError>;
  /** Closes the tabs of a deleted task or an archived Workspace Session. */
  closeOwnerTabs(owner: BrowserTabOwner): Effect.Effect<void, BrowserServiceError>;
  /** Closes the tabs of a removed workspace and deletes its profile and site permissions. */
  removeWorkspace(workspaceId: string): Effect.Effect<void, BrowserServiceError>;
  dispose(): Effect.Effect<void>;
};
