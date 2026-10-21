import { type BrowserPrompt, ODT_BROWSER_TOOL_TIMEOUT_MS } from "@openducktor/contracts";
import { Deferred, Effect, Exit } from "effect";
import { createSerialGate } from "../../effect/serial-gate";
import type {
  BrowserAutomationMessage,
  BrowserAutomationPage,
  BrowserAutomationPort,
} from "../../ports/browser-automation-port";
import type { BrowserEnginePort } from "../../ports/browser-engine-port";
import { openCdpProxyClient } from "./browser-cdp-proxy";
import { BrowserServiceError } from "./browser-service-error";
import type { BrowserTabRegistry } from "./browser-tab-registry";

type AgentPage = { page: BrowserAutomationPage; close: Effect.Effect<void> };

/** A dialog or file chooser. It blocks the page until someone answers it. */
type BlockingPrompt = Extract<BrowserPrompt, { kind: "dialog" | "file_chooser" }>;

/** How an agent action ended. */
export type BrowserAgentActionOutcome<A> =
  | { kind: "done"; value: A }
  | { kind: "prompt"; prompt: BlockingPrompt };

export type BrowserAgentPagesInput = {
  engine: Pick<BrowserEnginePort, "openSession" | "holdWake" | "reloadPage" | "captureScreenshot">;
  automation: BrowserAutomationPort;
  registry: Pick<BrowserTabRegistry, "get" | "update" | "subscribe">;
  runJob(job: Effect.Effect<void>): void;
  /** An agent mouse press starts or ends in the tab. */
  onPressing(tabId: string, pressing: boolean): void;
};

/** The automation client of each tab that an agent uses, and the rules of one agent action. */
export const createBrowserAgentPages = ({
  engine,
  automation,
  registry,
  runJob,
  onPressing,
}: BrowserAgentPagesInput) => {
  const pages = new Map<string, AgentPage>();
  const lanes = createSerialGate();

  /** The lane of a tab runs one action at a time, so the action owns the activity mark. */
  const setActive = (tabId: string, agentActive: boolean): void =>
    registry.update(tabId, (summary) => ({ ...summary, agentActive }));

  const connect = (tabId: string): Effect.Effect<BrowserAutomationPage, BrowserServiceError> =>
    Effect.gen(function* () {
      const existing = pages.get(tabId);
      if (existing) {
        return existing.page;
      }
      let receiver: ((message: BrowserAutomationMessage) => void) | null = null;
      let closeReceiver: ((reason: string) => void) | null = null;
      const proxy = yield* openCdpProxyClient({
        kind: "agent",
        tabId,
        engine,
        send: (message) => receiver?.(message),
        onEnded: () => {
          closeReceiver?.("The page closed.");
          pages.delete(tabId);
        },
        onPressing: (pressing) => onPressing(tabId, pressing),
      });
      const page = yield* automation
        .connect(
          {
            send: (command) => proxy.receive(command),
            receive: (listener) => {
              receiver = listener;
            },
            onClose: (listener) => {
              closeReceiver = listener;
            },
            close: () => runJob(proxy.close()),
          },
          ODT_BROWSER_TOOL_TIMEOUT_MS,
        )
        .pipe(
          Effect.tapError(() => proxy.close()),
          Effect.mapError(
            (cause) =>
              new BrowserServiceError({
                code: "browser_engine_error",
                operation: "browser.agent.connect",
                message: `Could not control the page: ${cause.message}`,
                tabId,
                cause,
              }),
          ),
        );
      pages.set(tabId, { page, close: page.close().pipe(Effect.andThen(proxy.close())) });
      return page;
    });

  const disconnect = (tabId: string): Effect.Effect<void> =>
    Effect.suspend(() => {
      const existing = pages.get(tabId);
      pages.delete(tabId);
      return existing ? existing.close : Effect.void;
    });

  /** Waits for a dialog or file chooser that opens on the tab after the action starts. */
  const waitForBlockingPrompt = (tabId: string, before: ReadonlySet<string>) =>
    Effect.gen(function* () {
      const opened = Deferred.makeUnsafe<BlockingPrompt>();
      const unsubscribe = registry.subscribe((event) => {
        if (event.type !== "tab_upserted" || event.tab.tabId !== tabId) {
          return;
        }
        const prompt = event.tab.prompts.find(
          (candidate) => isBlockingPrompt(candidate) && !before.has(candidate.promptId),
        );
        if (prompt && isBlockingPrompt(prompt)) {
          Deferred.doneUnsafe(opened, Effect.succeed(prompt));
        }
      });
      return yield* Deferred.await(opened).pipe(Effect.ensuring(Effect.sync(unsubscribe)));
    });

  /** Completes when the agent loses the tab, so its queued actions stop. */
  const stopSignals = new Map<string, Deferred.Deferred<void>>();
  const stopSignalOf = (tabId: string): Deferred.Deferred<void> => {
    let signal = stopSignals.get(tabId);
    if (!signal) {
      signal = Deferred.makeUnsafe<void>();
      stopSignals.set(tabId, signal);
    }
    return signal;
  };
  const stoppedFailure = (tabId: string) =>
    new BrowserServiceError({
      code: "browser_not_shared",
      operation: "browser.agent.action",
      message: "The user stopped sharing this tab, or its page ended. The action did not run.",
      tabId,
    });

  /**
   * Runs one agent action on a tab: one action at a time for each tab, the page stays drawn and
   * unthrottled, and the tab shows agent activity. An action that opens a dialog or file chooser
   * returns at once with the prompt. `check` runs again when the action gets its turn, so an
   * action that waited does not run after the agent lost the tab. An action that started
   * finishes after the agent loses the tab. The agent tool call sets the time limit.
   */
  const run = <A>(
    tabId: string,
    check: Effect.Effect<void, BrowserServiceError>,
    action: Effect.Effect<A, BrowserServiceError>,
  ): Effect.Effect<BrowserAgentActionOutcome<A>, BrowserServiceError> => {
    const stop = stopSignalOf(tabId);
    let started = false;
    const whenStopped = Deferred.await(stop).pipe(
      Effect.andThen(
        Effect.suspend(() => (started ? Effect.never : Effect.fail(stoppedFailure(tabId)))),
      ),
    );
    return lanes
      .run(
        tabId,
        Effect.scoped(
          Effect.gen(function* () {
            started = true;
            yield* check;
            yield* engine.holdWake(tabId);
            yield* Effect.acquireRelease(
              Effect.sync(() => setActive(tabId, true)),
              () => Effect.sync(() => setActive(tabId, false)),
            );
            const before = new Set(
              registry.get(tabId)?.summary.prompts.map((prompt) => prompt.promptId) ?? [],
            );
            const done = action.pipe(
              Effect.map((value): BrowserAgentActionOutcome<A> => ({ kind: "done", value })),
            );
            const prompt = waitForBlockingPrompt(tabId, before).pipe(
              Effect.map((opened): BrowserAgentActionOutcome<A> => ({
                kind: "prompt",
                prompt: opened,
              })),
            );
            return yield* Effect.raceFirst(done, prompt);
          }),
        ),
      )
      .pipe(Effect.raceFirst(whenStopped));
  };

  /** Runs an agent action with the page client of the tab. The client never takes the window focus. */
  const act = <A>(
    tabId: string,
    check: Effect.Effect<void, BrowserServiceError>,
    action: (page: BrowserAutomationPage) => Effect.Effect<A, BrowserServiceError>,
  ): Effect.Effect<BrowserAgentActionOutcome<A>, BrowserServiceError> =>
    run(tabId, check, connect(tabId).pipe(Effect.flatMap(action)));

  return {
    act,
    /** Runs an agent action that needs no page client, such as a navigation, with the same rules. */
    run,
    /** Stops the queued actions of a tab, then ends its client after the running action. */
    release: (tabId: string) =>
      Effect.suspend(() => {
        const signal = stopSignals.get(tabId);
        stopSignals.delete(tabId);
        if (signal) Deferred.doneUnsafe(signal, Exit.void);
        return lanes.run(tabId, disconnect(tabId));
      }),
    dispose: () => Effect.forEach(Array.from(pages.keys()), disconnect, { discard: true }),
  };
};

export type BrowserAgentPages = ReturnType<typeof createBrowserAgentPages>;

const isBlockingPrompt = (prompt: BrowserPrompt): prompt is BlockingPrompt =>
  prompt.kind === "dialog" || prompt.kind === "file_chooser";
