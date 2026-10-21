import { Effect } from "effect";
import type { CdpEvent, CdpPayload } from "../../../../ports/browser-engine-port";
import type { CdpConnection } from "../../cdp/cdp-target-session";
import type { ChromeProcess, ChromeProcessExit } from "../chrome-process";

type FakeChromeCommand = {
  readonly method: string;
  readonly params: CdpPayload;
  readonly sessionId: string;
};

type Responder = (command: FakeChromeCommand) => CdpPayload | Promise<CdpPayload>;

export type FakeChromePage = { readonly targetId: string; readonly sessionId: string };

/**
 * A Chrome process that answers CDP commands in memory. `Target.createTarget` makes a page that
 * auto-attaches and waits for the debugger, like the real browser-level auto-attach.
 */
export const createFakeChrome = () => {
  const commands: FakeChromeCommand[] = [];
  const listeners = new Set<(event: CdpEvent) => void>();
  const exitListeners = new Set<(exit: ChromeProcessExit) => void>();
  const responders = new Map<string, Responder>();
  let nextTarget = 1;
  let closed = false;
  let stopped = false;

  const emit = (method: string, params: CdpPayload, sessionId = ""): void => {
    for (const listener of Array.from(listeners)) listener({ method, params, sessionId });
  };

  const attachPage = (
    targetInfo: { url?: string; openerId?: string; canAccessOpener?: boolean } = {},
  ): FakeChromePage => {
    const index = nextTarget++;
    const targetId = `T${index}`;
    const sessionId = `S${index}`;
    const info: CdpPayload = {
      targetId,
      type: "page",
      url: targetInfo.url ?? "about:blank",
      canAccessOpener: targetInfo.canAccessOpener ?? false,
    };
    if (targetInfo.openerId !== undefined) info.openerId = targetInfo.openerId;
    emit("Target.attachedToTarget", { sessionId, targetInfo: info, waitingForDebugger: true });
    return { targetId, sessionId };
  };

  responders.set("Target.createTarget", () => ({ targetId: attachPage().targetId }));

  const connection: CdpConnection = {
    request(method, params, sessionId) {
      const command = { method, params: params ?? {}, sessionId };
      commands.push(command);
      if (closed) return Promise.reject(new Error("CDP connection closed: Chrome exited."));
      const responder = responders.get(method);
      return Promise.resolve(responder ? responder(command) : {});
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onClose: () => () => {},
    isClosed: () => closed,
  };

  const exit = (): void => {
    closed = true;
    for (const listener of Array.from(exitListeners)) listener({ code: 0, signal: null });
    exitListeners.clear();
  };

  const chrome: ChromeProcess = {
    connection,
    onExit(listener) {
      exitListeners.add(listener);
      return () => exitListeners.delete(listener);
    },
    stop: () =>
      Effect.sync(() => {
        stopped = true;
        exit();
      }),
  };

  return {
    chrome,
    commands,
    emit,
    attachPage,
    /** Ends the process without `stop`, like a crash. */
    exit,
    respond: (method: string, responder: Responder) => responders.set(method, responder),
    sent: (method: string) => commands.filter((command) => command.method === method),
    isStopped: () => stopped,
  };
};

export type FakeChrome = ReturnType<typeof createFakeChrome>;

/** Waits for background fibers and CDP promises of the engine. */
export const settle = async (): Promise<void> => {
  for (let round = 0; round < 10; round += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};
