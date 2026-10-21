import {
  type BrowserPromptAnswer,
  type BrowserTabOwner,
  type BrowserTabSummary,
  browserTabOwnerKey,
  browserWaitCondition,
  ODT_BROWSER_TOOL_TIMEOUT_MS,
  ODT_BROWSER_WAIT_DEFAULT_TIMEOUT_MS,
  type OdtBrowserToolInput,
  type OdtBrowserToolName,
  type OdtBrowserToolResult,
} from "@openducktor/contracts";
import { Deferred, Duration, Effect, Exit } from "effect";
import type {
  BrowserAutomationError,
  BrowserAutomationPage,
} from "../../ports/browser-automation-port";
import type { BrowserEnginePort } from "../../ports/browser-engine-port";
import { readyBrowserEngineForAgent } from "./browser-agent-engine";
import type { BrowserAgentPages } from "./browser-agent-pages";
import {
  actionResult,
  describeCondition,
  describeTab,
  formatConsole,
  textResult,
} from "./browser-agent-tool-text";
import type { BrowserPromptBook } from "./browser-prompt-book";
import { BrowserServiceError } from "./browser-service-error";
import type { BrowserTabRegistry } from "./browser-tab-registry";
import type { BrowserTabService } from "./browser-tab-service";

const LOAD_WAIT_MS = 15_000;
const ACTION_TIMEOUT_MS = 10_000;

type MarkedAction = "click" | "hover" | "type";

export type BrowserAgentToolsInput = {
  engine: Pick<
    BrowserEnginePort,
    "kind" | "state" | "installer" | "subscribe" | "showsPagesToUser" | "holdWake"
  >;
  registry: BrowserTabRegistry;
  prompts: BrowserPromptBook;
  tabs: BrowserTabService;
  pages: BrowserAgentPages;
  newTabId(): string;
  /** Shows the clients where an agent clicks, hovers, or types. */
  mark(tabId: string, action: MarkedAction, point: { x: number; y: number }): void;
};

/** The `odt_browser_*` tools. Each call acts only on the tabs that the calling owner may use. */
export const createBrowserAgentTools = ({
  engine,
  registry,
  prompts,
  tabs,
  pages,
  newTabId,
  mark,
}: BrowserAgentToolsInput) => {
  /** The agent tabs of the owner and the user tabs that the user shares. */
  const usableTabs = (owner: BrowserTabOwner) =>
    registry
      .ownerTabs(owner)
      .filter((record) => record.summary.createdBy === "agent" || record.summary.shared)
      .map((record) => record.summary);

  /** Waits until the tab loads or closes, or until the time limit. It follows registry events. */
  const waitForLoad = (tabId: string): Effect.Effect<void> =>
    Effect.suspend(() => {
      const current = registry.get(tabId);
      if (!current || isLoaded(current.summary)) {
        return Effect.void;
      }
      const done = Deferred.makeUnsafe<void>();
      const unsubscribe = registry.subscribe((event) => {
        if (
          (event.type === "tab_closed" && event.tabId === tabId) ||
          (event.type === "tab_upserted" && event.tab.tabId === tabId && isLoaded(event.tab))
        ) {
          Deferred.doneUnsafe(done, Exit.void);
        }
      });
      return Deferred.await(done).pipe(
        Effect.timeoutOption(LOAD_WAIT_MS),
        Effect.asVoid,
        Effect.ensuring(Effect.sync(unsubscribe)),
      );
    });

  const requireTab = (owner: BrowserTabOwner, tabId: string, operation: string) =>
    Effect.gen(function* () {
      yield* readyBrowserEngineForAgent(engine, operation);
      const summary = usableTabs(owner).find((candidate) => candidate.tabId === tabId);
      if (!summary) {
        const record = registry.get(tabId);
        const hidden = record?.ownerKey === browserTabOwnerKey(owner);
        return yield* new BrowserServiceError({
          code: hidden ? "browser_not_shared" : "browser_tab_not_found",
          operation,
          message: hidden
            ? `Tab ${tabId} is a user tab that the user does not share with agents.`
            : `No browser tab with ID ${tabId} is available to you. Call odt_browser_list to see your tabs.`,
          tabId,
        });
      }
      return summary;
    });

  /** Like `requireTab`. A saved tab of an earlier run gets its page first. */
  const requirePage = (owner: BrowserTabOwner, tabId: string, operation: string) =>
    requireTab(owner, tabId, operation).pipe(
      Effect.tap((summary) =>
        summary.started
          ? Effect.void
          : tabs.startTab(tabId, operation).pipe(Effect.andThen(waitForLoad(tabId))),
      ),
    );

  /** Fails while the tab shows a certificate warning. Only the user can pass it. */
  const checkCertificate = (tabId: string, operation: string) => {
    const prompt = prompts.find(tabId, "certificate");
    return prompt
      ? Effect.fail(
          new BrowserServiceError({
            code: "browser_certificate_error",
            operation,
            message: `The page at ${prompt.url} has a certificate error (${prompt.error}). Agents cannot bypass it. ${
              engine.showsPagesToUser
                ? "Ask the user to choose Proceed to this site in the tab."
                : "The web runner does not show agent tabs to the user, so use a page with a valid certificate."
            }`,
            tabId,
          }),
        )
      : Effect.void;
  };

  /** Waits for the page to load, then describes the tab. */
  const settle = (tabId: string, operation: string) =>
    Effect.gen(function* () {
      yield* waitForLoad(tabId);
      const summary = registry.get(tabId)?.summary;
      if (!summary) {
        return yield* new BrowserServiceError({
          code: "browser_tab_not_found",
          operation,
          message: "The tab closed.",
          tabId,
        });
      }
      yield* checkCertificate(tabId, operation);
      const status = isLoaded(summary) ? "" : " The page is still loading.";
      const error = summary.error ? ` ${summary.error.message}` : "";
      return `Tab ${tabId}: ${JSON.stringify(summary.title ?? "")} ${summary.url}.${status}${error}`;
    });

  const pageAction = (
    owner: BrowserTabOwner,
    tabId: string,
    operation: string,
    action: (
      page: BrowserAutomationPage,
    ) => Effect.Effect<OdtBrowserToolResult, BrowserAutomationError | BrowserServiceError>,
  ) =>
    Effect.gen(function* () {
      const check = requirePage(owner, tabId, operation);
      yield* check;
      const outcome = yield* pages.act(tabId, check, (page) =>
        action(page).pipe(
          Effect.mapError((cause) =>
            cause._tag === "BrowserAutomationError"
              ? automationFailure(tabId, operation)(cause)
              : cause,
          ),
        ),
      );
      return actionResult(tabId, outcome);
    });

  const markElement = (
    page: BrowserAutomationPage,
    tabId: string,
    ref: string,
    action: MarkedAction,
  ) =>
    page
      .elementPoint(ref, ACTION_TIMEOUT_MS)
      .pipe(Effect.tap((point) => Effect.sync(() => point && mark(tabId, action, point))));

  type Handlers = {
    [Name in OdtBrowserToolName]: (
      owner: BrowserTabOwner,
      input: OdtBrowserToolInput<Name>,
      operation: string,
    ) => Effect.Effect<OdtBrowserToolResult, BrowserServiceError>;
  };

  const handlers: Handlers = {
    odt_browser_list: (owner) => {
      const listed = usableTabs(owner);
      return Effect.succeed(
        textResult(
          listed.length === 0
            ? "No browser tabs are available to you. Open one with odt_browser_open."
            : listed.map(describeTab).join("\n"),
        ),
      );
    },
    odt_browser_open: (owner, { url }, operation) =>
      Effect.gen(function* () {
        yield* readyBrowserEngineForAgent(engine, operation);
        const tabId = newTabId();
        // Opening is an agent action: a dialog or file chooser of the first page is its result.
        const outcome = yield* pages.run(
          tabId,
          Effect.void,
          tabs.openTab({ tabId, owner, address: url, createdBy: "agent" }).pipe(
            // The action took its wake hold before the tab existed, so the load takes its own.
            Effect.andThen(
              Effect.scoped(engine.holdWake(tabId).pipe(Effect.andThen(settle(tabId, operation)))),
            ),
            Effect.map((loaded) => textResult(`Opened a new agent tab. ${loaded}`)),
          ),
        );
        return actionResult(tabId, outcome);
      }),
    odt_browser_navigate: (owner, params, operation) =>
      Effect.gen(function* () {
        const check = requirePage(owner, params.tabId, operation);
        yield* check;
        // A navigation is an agent action: a `beforeunload` dialog that it opens is its result.
        const outcome = yield* pages.run(
          params.tabId,
          check,
          tabs
            .navigate(
              params.tabId,
              params.url === undefined
                ? { kind: params.action ?? "reload" }
                : { kind: "address", address: params.url },
            )
            .pipe(Effect.andThen(settle(params.tabId, operation)), Effect.map(textResult)),
        );
        return actionResult(params.tabId, outcome);
      }),
    odt_browser_close: (owner, { tabId }, operation) =>
      Effect.gen(function* () {
        const summary = yield* requireTab(owner, tabId, operation);
        if (summary.createdBy !== "agent") {
          return yield* new BrowserServiceError({
            code: "browser_not_closable",
            operation,
            message: `Tab ${tabId} is a user tab that the user shared. Only the user can close it.`,
            tabId,
          });
        }
        yield* tabs.closeTab(tabId);
        return textResult(`Closed tab ${tabId}.`);
      }),
    odt_browser_snapshot: (owner, { tabId }, operation) =>
      pageAction(owner, tabId, operation, (page) =>
        page.snapshot(ACTION_TIMEOUT_MS).pipe(
          Effect.map((snapshot) => {
            const summary = registry.get(tabId)?.summary;
            return textResult(
              `Tab ${tabId}: ${JSON.stringify(summary?.title ?? "")} ${summary?.url ?? ""}\n${snapshot}`,
            );
          }),
        ),
      ),
    odt_browser_click: (owner, params, operation) =>
      pageAction(owner, params.tabId, operation, (page) =>
        markElement(page, params.tabId, params.ref, "click").pipe(
          Effect.andThen(
            page.click(
              params.ref,
              {
                button: params.button ?? "left",
                doubleClick: params.doubleClick ?? false,
                modifiers: params.modifiers ?? [],
              },
              ACTION_TIMEOUT_MS,
            ),
          ),
          Effect.as(textResult(`Clicked ${params.ref} in tab ${params.tabId}.`)),
        ),
      ),
    odt_browser_hover: (owner, params, operation) =>
      pageAction(owner, params.tabId, operation, (page) =>
        markElement(page, params.tabId, params.ref, "hover").pipe(
          Effect.andThen(page.hover(params.ref, ACTION_TIMEOUT_MS)),
          Effect.as(textResult(`Moved the pointer over ${params.ref} in tab ${params.tabId}.`)),
        ),
      ),
    odt_browser_type: (owner, params, operation) =>
      pageAction(owner, params.tabId, operation, (page) =>
        Effect.gen(function* () {
          yield* markElement(page, params.tabId, params.ref, "type");
          yield* page.fill(params.ref, params.text, ACTION_TIMEOUT_MS);
          if (params.submit === true) {
            yield* page.press(params.ref, "Enter", ACTION_TIMEOUT_MS);
          }
          return textResult(
            `Typed into ${params.ref} in tab ${params.tabId}${params.submit ? " and pressed Enter" : ""}.`,
          );
        }),
      ),
    odt_browser_press: (owner, params, operation) =>
      pageAction(owner, params.tabId, operation, (page) =>
        page
          .press(null, params.key, ACTION_TIMEOUT_MS)
          .pipe(Effect.as(textResult(`Pressed ${params.key} in tab ${params.tabId}.`))),
      ),
    odt_browser_select: (owner, params, operation) =>
      pageAction(owner, params.tabId, operation, (page) =>
        page
          .selectOptions(params.ref, params.values, ACTION_TIMEOUT_MS)
          .pipe(
            Effect.map((selected) =>
              textResult(`Selected ${JSON.stringify(selected)} in ${params.ref}.`),
            ),
          ),
      ),
    odt_browser_scroll: (owner, params, operation) =>
      pageAction(owner, params.tabId, operation, (page) =>
        (params.ref === undefined
          ? page.scrollBy(params.deltaX ?? 0, params.deltaY ?? 0)
          : page.scrollIntoView(params.ref, ACTION_TIMEOUT_MS)
        ).pipe(Effect.as(textResult(`Scrolled in tab ${params.tabId}.`))),
      ),
    odt_browser_screenshot: (owner, params, operation) =>
      pageAction(owner, params.tabId, operation, (page) =>
        page.screenshot(params.ref ?? null, ACTION_TIMEOUT_MS).pipe(
          Effect.map((png): OdtBrowserToolResult => ({
            content: [
              {
                type: "text",
                text: `Screenshot of ${params.ref === undefined ? "the visible page" : `element ${params.ref}`} in tab ${params.tabId}.`,
              },
              {
                type: "image",
                mimeType: "image/png",
                dataBase64: Buffer.from(png).toString("base64"),
              },
            ],
          })),
        ),
      ),
    odt_browser_console: (owner, params, operation) =>
      Effect.gen(function* () {
        yield* requirePage(owner, params.tabId, operation);
        const host = yield* tabs.requireLive(params.tabId, operation);
        const read = host.console.read({
          levels: params.levels ?? null,
          afterSequence: params.afterSequence ?? null,
          limit: params.limit ?? 100,
        });
        const header = `Console of tab ${params.tabId}. Last sequence: ${read.lastSequence}.${read.dropped > 0 ? ` ${read.dropped} older entries were dropped.` : ""}`;
        return textResult(
          read.entries.length === 0
            ? `${header}\nNo matching entries.`
            : `${header}\n${formatConsole(read.entries)}`,
        );
      }),
    odt_browser_wait: (owner, params, operation) => {
      const timeoutMs = params.timeoutMs ?? ODT_BROWSER_WAIT_DEFAULT_TIMEOUT_MS;
      const condition = browserWaitCondition(params);
      return pageAction(owner, params.tabId, operation, (page) =>
        page.waitFor(condition, timeoutMs).pipe(
          Effect.mapError((cause) =>
            cause.kind === "timeout"
              ? new BrowserServiceError({
                  code: "browser_timeout",
                  operation,
                  message: `Waited ${timeoutMs} ms for ${describeCondition(condition)}, but it did not happen.`,
                  tabId: params.tabId,
                })
              : automationFailure(params.tabId, operation)(cause),
          ),
          Effect.as(textResult(`The wait for ${describeCondition(condition)} ended.`)),
        ),
      );
    },
    odt_browser_dialog: (owner, params, operation) =>
      Effect.gen(function* () {
        yield* requireTab(owner, params.tabId, operation);
        const dialog = prompts.find(params.tabId, "dialog");
        if (!dialog) {
          return yield* new BrowserServiceError({
            code: "browser_no_dialog",
            operation,
            message: "No dialog is open in this tab.",
            tabId: params.tabId,
          });
        }
        const answer: BrowserPromptAnswer = { kind: "dialog", accept: params.accept };
        if (params.promptText !== undefined) {
          answer.promptText = params.promptText;
        }
        yield* prompts.answer(params.tabId, dialog.promptId, answer);
        return textResult(
          `${params.accept ? "Accepted" : "Dismissed"} the ${dialog.type} dialog in tab ${params.tabId}.`,
        );
      }),
  };

  /**
   * Runs one tool call. The time limit covers the whole call: the install wait, the page start,
   * the turn of the tab, and the action. It is shorter than the wait of the MCP client, so the agent
   * always gets the host result.
   */
  const run = <Name extends OdtBrowserToolName>(
    owner: BrowserTabOwner,
    name: Name,
    input: OdtBrowserToolInput<Name>,
  ): Effect.Effect<OdtBrowserToolResult, BrowserServiceError> => {
    const operation = `browser.agent.${name}`;
    // SAFETY: `handlers` has one handler for each tool name, and `Name` selects the handler whose
    // input type is `OdtBrowserToolInput<Name>`. TypeScript cannot relate the two indexes.
    const handler = handlers[name] as (
      owner: BrowserTabOwner,
      input: OdtBrowserToolInput<Name>,
      operation: string,
    ) => Effect.Effect<OdtBrowserToolResult, BrowserServiceError>;
    return handler(owner, input, operation).pipe(
      Effect.timeoutOrElse({
        duration: Duration.millis(ODT_BROWSER_TOOL_TIMEOUT_MS),
        orElse: () =>
          Effect.fail(
            new BrowserServiceError({
              code: "browser_timeout",
              operation,
              message: `The browser call did not finish within ${ODT_BROWSER_TOOL_TIMEOUT_MS / 1000} seconds. Its action can still complete, so take a snapshot before you try again.`,
            }),
          ),
      }),
    );
  };

  return { run };
};

const isLoaded = (summary: BrowserTabSummary): boolean => summary.live && !summary.loading;

const automationFailure = (tabId: string, operation: string) => (cause: BrowserAutomationError) => {
  if (cause.kind === "ref_stale") {
    return new BrowserServiceError({
      code: "browser_ref_stale",
      operation,
      message: `${cause.message} The page changed since the last snapshot. Take a new snapshot with odt_browser_snapshot and use its refs.`,
      tabId,
      cause,
    });
  }
  return new BrowserServiceError({
    code: cause.kind === "timeout" ? "browser_timeout" : "browser_action_failed",
    operation,
    message: cause.message,
    tabId,
    cause,
  });
};
