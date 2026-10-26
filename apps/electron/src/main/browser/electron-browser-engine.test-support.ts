import { EventEmitter } from "node:events";
import type { BrowserEngineEvent, CdpPayload } from "@openducktor/host";
import type { BrowserServerMessage } from "@openducktor/contracts";
import { Effect } from "effect";
import { createElectronBrowserEngine, type ElectronBrowserEngine } from "./electron-browser-engine";
import type {
  ElectronBrowserGuest,
  ElectronGuestHost,
  ElectronPopupWindow,
  GuestWindowOpenDetails,
  GuestWindowOpenResponse,
} from "./electron-browser-guest";
import type { ElectronBrowserPartitionSession } from "./electron-browser-session";

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
      return Promise.resolve({ targetInfo: { targetId: this.targetId, type: "webview" } });
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

/** The OpenDucktor window page of a guest. It records its background throttling. */
export class FakeGuestHost implements ElectronGuestHost {
  throttling: boolean[] = [];

  constructor(readonly id: number) {}

  isDestroyed(): boolean {
    return false;
  }

  setBackgroundThrottling(allowed: boolean): void {
    this.throttling.push(allowed);
  }
}

export class FakeGuest extends EventEmitter implements ElectronBrowserGuest {
  readonly debugger: FakeDebugger;
  private readonly host: FakeGuestHost | null;
  url = "about:blank";
  loaded: string[] = [];
  /** One entry for each reload: true when it ignored the cache. */
  reloads: boolean[] = [];
  destroyed = false;
  closed = 0;
  throttling: boolean[] = [];
  windowOpenHandler: ((details: GuestWindowOpenDetails) => GuestWindowOpenResponse) | null = null;

  constructor(
    readonly id: number,
    readonly session: ElectronBrowserPartitionSession,
    hostId: number | null,
    private readonly type = "webview",
  ) {
    super();
    this.debugger = new FakeDebugger(`target-${id}`);
    this.host = hostId === null ? null : new FakeGuestHost(hostId);
    // Electron registers one internal dialog listener on each page.
    this.on("-run-dialog", () => {});
  }

  /** Electron throws on the host of a destroyed page. */
  get hostWebContents(): FakeGuestHost | null {
    if (this.destroyed) throw new TypeError("Object has been destroyed");
    return this.host;
  }

  getType(): string {
    return this.type;
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

  setBackgroundThrottling(allowed: boolean): void {
    this.throttling.push(allowed);
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

export const MAIN_WINDOW_ID = 1;
export const WORKSPACE_ID = "repo";
export const TAB_ID = "11111111-1111-4111-8111-111111111111";

export type EngineHarness = {
  engine: ElectronBrowserEngine;
  events: BrowserEngineEvent[];
  rendererMessages: Array<{ hostId: number; message: BrowserServerMessage }>;
  revealed: string[];
  failures: string[];
  guests: Map<number, FakeGuest>;
  sessions: Map<string, FakePartitionSession>;
  workspaceSession: FakePartitionSession;
  addGuest(
    id: number,
    options?: { hostId?: number | null; session?: FakePartitionSession },
  ): FakeGuest;
  bind(tabId?: string, guestId?: number): Promise<FakeGuest>;
  flush(): Promise<void>;
};

/** An engine with one loaded OpenDucktor window and fake guests. */
export const createEngineHarness = (devToolsUrl: string | null = null): EngineHarness => {
  const events: BrowserEngineEvent[] = [];
  const rendererMessages: EngineHarness["rendererMessages"] = [];
  const revealed: string[] = [];
  const failures: string[] = [];
  const guests = new Map<number, FakeGuest>();
  const sessions = new Map<string, FakePartitionSession>();
  let nextId = 1;
  const partitionSession = (partition: string) => {
    let session = sessions.get(partition);
    if (!session) {
      session = new FakePartitionSession();
      sessions.set(partition, session);
    }
    return session;
  };
  const workspaceSession = partitionSession(`persist:openducktor-browser-${WORKSPACE_ID}`);
  const engine = createElectronBrowserEngine({
    platform: "darwin",
    findWebContents: (id) => guests.get(id) ?? null,
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

  const addGuest: EngineHarness["addGuest"] = (id, options = {}) => {
    const guest = new FakeGuest(
      id,
      options.session ?? workspaceSession,
      options.hostId === undefined ? MAIN_WINDOW_ID : options.hostId,
    );
    guests.set(id, guest);
    return guest;
  };

  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  return {
    engine,
    events,
    rendererMessages,
    revealed,
    failures,
    guests,
    sessions,
    workspaceSession,
    addGuest,
    flush,
    async bind(tabId = TAB_ID, guestId = 100) {
      const guest = guests.get(guestId) ?? addGuest(guestId);
      await Effect.runPromise(engine.bindGuest(MAIN_WINDOW_ID, tabId, guestId));
      return guest;
    },
  };
};
