import { EventEmitter } from "node:events";
import type { BrowserServerMessage } from "@openducktor/contracts";
import type { BrowserEngineEvent, CdpPayload } from "@openducktor/host";
import { createElectronBrowserEngine, type ElectronBrowserEngine } from "./electron-browser-engine";
import type {
  ElectronBrowserGuest,
  ElectronPopupWindow,
  GuestWindowOpenDetails,
  GuestWindowOpenResponse,
} from "./electron-browser-guest";
import type { ElectronBrowserPartitionSession } from "./electron-browser-session";
import type {
  ElectronBrowserView,
  ElectronBrowserViewPort,
  ElectronViewBox,
  ElectronViewOwner,
} from "./electron-browser-view-port";

type SentCommand = {
  method: string;
  params: CdpPayload | undefined;
  sessionId: string | undefined;
};

export class FakeDebugger extends EventEmitter {
  readonly sent: SentCommand[] = [];
  attached = false;
  private nextSession = 1;

  constructor(private readonly targetId: string) {
    super();
  }

  attach(): void {
    this.attached = true;
  }

  isAttached(): boolean {
    return this.attached;
  }

  sendCommand(method: string, params?: CdpPayload, sessionId?: string): Promise<CdpPayload> {
    this.sent.push({ method, params, sessionId });
    if (method === "Target.getTargetInfo") {
      return Promise.resolve({ targetInfo: { targetId: this.targetId, type: "page" } });
    }
    if (method === "Target.attachToTarget") {
      return Promise.resolve({ sessionId: `${this.targetId}-session-${this.nextSession++}` });
    }
    return Promise.resolve({});
  }

  methods(): string[] {
    return this.sent.map((command) => command.method);
  }

  emitEvent(method: string, params: CdpPayload, sessionId: string): void {
    this.emit("message", { preventDefault() {} }, method, params, sessionId);
  }
}

export class FakePartitionSession extends EventEmitter implements ElectronBrowserPartitionSession {
  requestHandler:
    | Parameters<ElectronBrowserPartitionSession["setPermissionRequestHandler"]>[0]
    | null = null;
  cleared: string[] = [];

  setPermissionRequestHandler(
    handler: Parameters<ElectronBrowserPartitionSession["setPermissionRequestHandler"]>[0],
  ): void {
    this.requestHandler = handler;
  }

  setPermissionCheckHandler(): void {}

  setDevicePermissionHandler(): void {}

  clearData(): Promise<void> {
    this.cleared.push("data");
    return Promise.resolve();
  }

  clearStorageData(): Promise<void> {
    this.cleared.push("storage");
    return Promise.resolve();
  }

  clearCache(): Promise<void> {
    this.cleared.push("cache");
    return Promise.resolve();
  }
}

export type CancelableEvent = { preventDefault(): void; prevented: boolean };

export const cancelableEvent = (): CancelableEvent => {
  const event = {
    prevented: false,
    preventDefault() {
      event.prevented = true;
    },
  };
  return event;
};

export class FakeGuest extends EventEmitter implements ElectronBrowserGuest {
  readonly debugger: FakeDebugger;
  url = "about:blank";
  loaded: string[] = [];
  /** One entry for each reload: true when it ignored the cache. */
  reloads: boolean[] = [];
  destroyed = false;
  closed = 0;
  focused = 0;
  backgroundThrottling = true;
  /** The JPEG bytes that `capturePage` returns for this page. */
  snapshotJpeg: Buffer = Buffer.from("AAAA", "base64");
  windowOpenHandler: ((details: GuestWindowOpenDetails) => GuestWindowOpenResponse) | null = null;

  constructor(
    readonly id: number,
    readonly session: ElectronBrowserPartitionSession,
  ) {
    super();
    this.debugger = new FakeDebugger(`target-${id}`);
    // Electron registers one internal dialog listener on each page.
    this.on("-run-dialog", () => {});
  }

  getURL(): string {
    return this.url;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  loadURL(url: string): Promise<void> {
    this.loaded.push(url);
    this.url = url;
    return Promise.resolve();
  }

  reload(): void {
    this.reloads.push(false);
  }

  reloadIgnoringCache(): void {
    this.reloads.push(true);
  }

  focus(): void {
    this.focused += 1;
  }

  capturePage(): Promise<{ toJPEG(quality: number): Buffer }> {
    return Promise.resolve({ toJPEG: () => this.snapshotJpeg });
  }

  setBackgroundThrottling(allowed: boolean): void {
    this.backgroundThrottling = allowed;
  }

  close(): void {
    this.closed += 1;
    this.destroy();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.debugger.emit("detach", { preventDefault() {} }, "target closed");
    this.emit("destroyed");
  }

  setWindowOpenHandler(handler: (details: GuestWindowOpenDetails) => GuestWindowOpenResponse) {
    this.windowOpenHandler = handler;
  }

  navigate(url: string): void {
    this.url = url;
    this.emit("did-navigate", { preventDefault() {} }, url);
  }
}

export class FakePopupWindow implements ElectronPopupWindow {
  shown = 0;
  shownInactive = 0;
  focused = 0;

  constructor(readonly webContents: FakeGuest) {}

  show(): void {
    this.shown += 1;
  }

  showInactive(): void {
    this.shownInactive += 1;
  }

  focus(): void {
    this.focused += 1;
  }

  destroy(): void {
    this.webContents.destroy();
  }

  isDestroyed(): boolean {
    return this.webContents.destroyed;
  }
}

/** One page view that the engine created through the port. */
export class FakeView implements ElectronBrowserView {
  constructor(
    readonly partition: string,
    readonly webContents: FakeGuest,
  ) {}
}

/** The view port of a test: it records each placement instead of showing a window. */
export class FakeViewPort implements ElectronBrowserViewPort {
  readonly views: FakeView[] = [];
  readonly placed: Array<{ view: FakeView; windowId: number; box: ElectronViewBox }> = [];
  readonly kept: Array<{ view: FakeView; visible: boolean }> = [];
  readonly closed: FakeView[] = [];
  keeperCloses = 0;

  constructor(
    private readonly partitionSession: (partition: string) => ElectronBrowserPartitionSession,
    private readonly nextId: () => number,
  ) {}

  registerWindow(_windowId: number, _window: ElectronViewOwner): void {}

  unregisterWindow(_windowId: number): void {}

  create(partition: string): ElectronBrowserView {
    const guest = new FakeGuest(this.nextId(), this.partitionSession(partition));
    const view = new FakeView(partition, guest);
    this.views.push(view);
    return view;
  }

  showInWindow(view: ElectronBrowserView, windowId: number, box: ElectronViewBox): boolean {
    // SAFETY: the engine places only views that this port created, which are FakeView values.
    const own = view as FakeView;
    this.placed.push({ view: own, windowId, box });
    return true;
  }

  showInKeeper(view: ElectronBrowserView, visible: boolean): void {
    // SAFETY: the engine keeps only views that this port created, which are FakeView values.
    this.kept.push({ view: view as FakeView, visible });
  }

  close(view: ElectronBrowserView): void {
    // SAFETY: the engine closes only views that this port created, which are FakeView values.
    const own = view as FakeView;
    this.closed.push(own);
    own.webContents.close();
  }

  closeKeeper(): void {
    this.keeperCloses += 1;
  }
}

export const MAIN_WINDOW_ID = 1;
export const WORKSPACE_ID = "repo";
export const TAB_ID = "11111111-1111-4111-8111-111111111111";

export type EngineHarness = {
  engine: ElectronBrowserEngine;
  viewPort: FakeViewPort;
  events: BrowserEngineEvent[];
  rendererMessages: Array<{ hostId: number; message: BrowserServerMessage }>;
  revealed: string[];
  failures: string[];
  sessions: Map<string, FakePartitionSession>;
  workspaceSession: FakePartitionSession;
  /** The most recent page view. */
  view(): FakeView;
  /** The page of the most recent panel tab. */
  page(): FakeGuest;
  flush(): Promise<void>;
};

/** An engine with one loaded OpenDucktor window and a view port that records placements. */
export const createEngineHarness = (devToolsUrl: string | null = null): EngineHarness => {
  const events: BrowserEngineEvent[] = [];
  const rendererMessages: EngineHarness["rendererMessages"] = [];
  const revealed: string[] = [];
  const failures: string[] = [];
  const sessions = new Map<string, FakePartitionSession>();
  let nextId = 1;
  let nextGuestId = 1_000;
  const partitionSession = (partition: string) => {
    let session = sessions.get(partition);
    if (!session) {
      session = new FakePartitionSession();
      sessions.set(partition, session);
    }
    return session;
  };
  const workspaceSession = partitionSession(`persist:openducktor-browser-${WORKSPACE_ID}`);
  const viewPort = new FakeViewPort(partitionSession, () => nextGuestId++);
  const engine = createElectronBrowserEngine({
    platform: "darwin",
    viewPort,
    partitionSession,
    downloadsDirectory: () => "/downloads",
    fileExists: () => false,
    showItemInFolder: (filePath) => revealed.push(filePath),
    notifyRenderer: (hostId, message) => rendererMessages.push({ hostId, message }),
    devToolsFrontendUrl: () => devToolsUrl,
    decodePng: () => {
      throw new Error("The engine harness has no images. Test page screenshots on their own.");
    },
    newId: () => `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`,
    reportFailure: (operation) => failures.push(operation),
  });
  engine.subscribe((event) => events.push(event));
  engine.addMainWindow(MAIN_WINDOW_ID);
  engine.setMainWindowLoaded(MAIN_WINDOW_ID, true);

  const view = (): FakeView => {
    const found = viewPort.views.at(-1);
    if (found === undefined) throw new Error("The engine created no page view yet.");
    return found;
  };
  const page = (): FakeGuest => view().webContents;

  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  return {
    engine,
    viewPort,
    events,
    rendererMessages,
    revealed,
    failures,
    sessions,
    workspaceSession,
    view,
    page,
    flush,
  };
};
