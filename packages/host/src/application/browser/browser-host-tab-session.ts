import type {
  BrowserAnnotationAnchor,
  BrowserBox,
  BrowserTabSummary,
} from "@openducktor/contracts";
import { browserBoxSchema } from "@openducktor/contracts";
import { Effect } from "effect";
import { type JSONType, z } from "zod";
import type { CdpCommandError, CdpEvent, CdpSession } from "../../ports/browser-engine-port";
import {
  bindingCalledSchema,
  evaluateResultSchema,
  executionContextCreatedSchema,
  executionContextDestroyedSchema,
  frameIdEventSchema,
  frameNavigatedSchema,
  frameRequestedNavigationSchema,
  frameTreeResultSchema,
  loadingFailedSchema,
  navigatedWithinDocumentSchema,
  navigationHistoryResultSchema,
  requestWillBeSentSchema,
} from "../../ports/browser-cdp-schemas";
import { type BrowserConsoleBuffer, createBrowserConsoleBuffer } from "./browser-console";
import { loadBrowserFavicon } from "./browser-favicon";
import {
  BROWSER_HOST_BINDING,
  BROWSER_HOST_WORLD,
  BROWSER_HOST_WORLD_SCRIPT,
} from "./browser-page-scripts";
import { createBrowserPagePrompts } from "./browser-page-prompts";
import type { BrowserPromptBook } from "./browser-prompt-book";
import { BrowserServiceError } from "./browser-service-error";

const hostWorldMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("page_info"),
    title: z.string(),
    icon: z.string().nullable(),
    origin: z.string(),
  }),
  z.object({
    type: z.literal("anchor_boxes"),
    boxes: z.array(z.object({ annotationId: z.string(), box: browserBoxSchema.nullable() })),
  }),
]);

const selectedTextSchema = z.string().nullable();

export type BrowserAnchorBoxes = { annotationId: string; box: BrowserBox | null }[];

/** A navigation that a page can stop with `beforeunload`, so the host can repeat it. */
export type BrowserHeldNavigation =
  | { kind: "url"; url: string }
  | { kind: "back" | "forward" | "reload" };

export type BrowserHostTabSessionInput = {
  tabId: string;
  session: CdpSession;
  update(change: (summary: BrowserTabSummary) => BrowserTabSummary): void;
  prompts: BrowserPromptBook;
  isAgentActing(): boolean;
  /** Forks a background job that the browser service owns. */
  runJob(job: Effect.Effect<void>): void;
  onAnchorBoxes(boxes: BrowserAnchorBoxes): void;
  /** The main frame committed a document. `failedUrl` names the load of an error page. */
  onNavigated(failedUrl: string | null): void;
};

export type BrowserHostTabSession = {
  readonly session: CdpSession;
  readonly console: Pick<BrowserConsoleBuffer, "read">;
  /** The last navigation that the host or the page started in the main frame. */
  lastNavigation(): BrowserHeldNavigation | null;
  noteNavigation(navigation: BrowserHeldNavigation): void;
  /** The text that the user selected on the page or in a text field, or null without one. */
  readSelectedText(): Effect.Effect<string | null, BrowserServiceError>;
  setAnchors(anchors: readonly BrowserAnnotationAnchor[]): Effect.Effect<void, BrowserServiceError>;
  /** Scrolls the page to the first element of an anchor. An unknown anchor does nothing. */
  revealAnchor(annotationId: string): Effect.Effect<void, BrowserServiceError>;
  close(): void;
};

/**
 * The host client of one live tab. It keeps the tab summary current, records console messages,
 * and turns dialogs and file choosers into prompts.
 */
export const startBrowserHostTabSession = (
  input: BrowserHostTabSessionInput,
): Effect.Effect<BrowserHostTabSession, CdpCommandError> =>
  Effect.gen(function* () {
    const { session, tabId, prompts } = input;
    const consoleBuffer = createBrowserConsoleBuffer();
    let mainFrameId = session.targetId;
    let lastNavigation: BrowserHeldNavigation | null = null;
    let documentRequest: { requestId: string; url: string } | null = null;
    let documentError: { url: string; errorText: string } | null = null;
    let hostWorldContextId: number | null = null;
    /** The anchors of the last client message. Each new document gets them again. */
    let anchors: readonly BrowserAnnotationAnchor[] = [];
    let pageGeneration = 0;

    const refreshHistory = (): Effect.Effect<void> =>
      session.send("Page.getNavigationHistory").pipe(
        Effect.map((result) => navigationHistoryResultSchema.parse(result)),
        Effect.map((history) => {
          const current = history.entries[history.currentIndex];
          input.update((summary) => ({
            ...summary,
            canGoBack: history.currentIndex > 0,
            canGoForward: history.currentIndex < history.entries.length - 1,
            title: current && current.title.length > 0 ? current.title : summary.title,
          }));
        }),
        Effect.ignore,
      );

    const updateFavicon = (iconUrl: string | null, origin: string): void => {
      const generation = pageGeneration;
      input.runJob(
        loadBrowserFavicon(session, { frameId: mainFrameId, iconUrl, origin }).pipe(
          Effect.map((favicon) => {
            if (generation === pageGeneration) {
              input.update((summary) => ({ ...summary, favicon }));
            }
          }),
        ),
      );
    };

    const anchorsExpression = (): string =>
      `globalThis.__odtSetAnchors(${JSON.stringify(anchors)})`;

    const resendAnchors = (contextId: number): void => {
      if (anchors.length === 0) return;
      // A fast navigation can end the context before the call. The next context gets the anchors.
      input.runJob(
        session
          .send("Runtime.evaluate", { expression: anchorsExpression(), contextId })
          .pipe(Effect.ignore),
      );
    };

    const handleHostWorldMessage = (payload: string, contextId: number): void => {
      // The script runs only in the top document. A message of another context is stale.
      if (contextId !== hostWorldContextId) return;
      const message = hostWorldMessageSchema.parse(JSON.parse(payload));
      switch (message.type) {
        case "page_info":
          input.update((summary) => ({
            ...summary,
            title: message.title.length > 0 ? message.title : null,
          }));
          updateFavicon(message.icon, message.origin);
          return;
        case "anchor_boxes":
          input.onAnchorBoxes(message.boxes);
          return;
      }
    };

    const onPageNavigated = (url: string, failedUrl: string | null): void => {
      pageGeneration += 1;
      const error =
        failedUrl === null
          ? null
          : {
              kind: "load_failed" as const,
              url: failedUrl,
              message:
                documentError?.url === failedUrl
                  ? `The page could not load: ${documentError.errorText}`
                  : "The page could not load.",
            };
      documentError = null;
      input.update((summary) => ({ ...summary, url, error, favicon: null }));
      input.onNavigated(failedUrl);
      input.runJob(refreshHistory());
    };

    const pagePrompts = createBrowserPagePrompts({
      tabId,
      session,
      prompts,
      isAgentActing: input.isAgentActing,
      runJob: input.runJob,
    });

    const handleEvent = (event: CdpEvent): void => {
      if (event.sessionId !== session.sessionId) {
        return;
      }
      if (consoleBuffer.capture(event) || pagePrompts.handleEvent(event)) {
        return;
      }
      switch (event.method) {
        case "Page.frameNavigated": {
          const { frame } = frameNavigatedSchema.parse(event.params);
          if (frame.parentId === undefined) {
            mainFrameId = frame.id;
            const url = frame.unreachableUrl ?? `${frame.url}${frame.urlFragment ?? ""}`;
            onPageNavigated(url, frame.unreachableUrl ?? null);
          }
          return;
        }
        case "Page.navigatedWithinDocument": {
          const params = navigatedWithinDocumentSchema.parse(event.params);
          if (params.frameId === mainFrameId) {
            input.update((summary) => ({ ...summary, url: params.url }));
            input.runJob(refreshHistory());
          }
          return;
        }
        case "Page.frameStartedLoading":
        case "Page.frameStoppedLoading": {
          const { frameId } = frameIdEventSchema.parse(event.params);
          if (frameId === mainFrameId) {
            const loading = event.method === "Page.frameStartedLoading";
            input.update((summary) => ({ ...summary, loading }));
            if (!loading) {
              input.runJob(refreshHistory());
            }
          }
          return;
        }
        case "Page.frameRequestedNavigation": {
          const params = frameRequestedNavigationSchema.parse(event.params);
          if (params.frameId === mainFrameId) {
            lastNavigation = { kind: "url", url: params.url };
          }
          return;
        }
        case "Network.requestWillBeSent": {
          const params = requestWillBeSentSchema.parse(event.params);
          if (params.type === "Document" && params.frameId === mainFrameId) {
            documentRequest = { requestId: params.requestId, url: params.request.url };
          }
          return;
        }
        case "Network.loadingFailed": {
          const params = loadingFailedSchema.parse(event.params);
          if (params.requestId === documentRequest?.requestId && params.canceled !== true) {
            documentError = { url: documentRequest.url, errorText: params.errorText };
          }
          return;
        }
        case "Inspector.targetCrashed":
          input.update((summary) => ({
            ...summary,
            loading: false,
            error: {
              kind: "crashed",
              url: summary.url,
              message: "The page crashed. Reload it to try again.",
            },
          }));
          return;
        case "Runtime.executionContextCreated": {
          const { context } = executionContextCreatedSchema.parse(event.params);
          if (context.name === BROWSER_HOST_WORLD && context.auxData?.frameId === mainFrameId) {
            hostWorldContextId = context.id;
            resendAnchors(context.id);
          }
          return;
        }
        case "Runtime.executionContextDestroyed": {
          const params = executionContextDestroyedSchema.parse(event.params);
          if (params.executionContextId === hostWorldContextId) {
            hostWorldContextId = null;
          }
          return;
        }
        case "Runtime.executionContextsCleared":
          hostWorldContextId = null;
          return;
        case "Runtime.bindingCalled": {
          const params = bindingCalledSchema.parse(event.params);
          if (params.name === BROWSER_HOST_BINDING) {
            handleHostWorldMessage(params.payload, params.executionContextId);
          }
          return;
        }
      }
    };

    const unsubscribe = session.subscribe(handleEvent);

    const setup = Effect.gen(function* () {
      yield* session.send("Page.enable");
      yield* session.send("Runtime.enable");
      yield* session.send("Log.enable");
      yield* session.send("Inspector.enable");
      yield* session.send("Network.enable", { maxTotalBufferSize: 0, maxResourceBufferSize: 0 });
      yield* session.send("Page.setInterceptFileChooserDialog", { enabled: true });
      yield* session.send("Runtime.addBinding", {
        name: BROWSER_HOST_BINDING,
        executionContextName: BROWSER_HOST_WORLD,
      });
      yield* session.send("Page.addScriptToEvaluateOnNewDocument", {
        source: BROWSER_HOST_WORLD_SCRIPT,
        worldName: BROWSER_HOST_WORLD,
        runImmediately: true,
      });
      const tree = frameTreeResultSchema.parse(yield* session.send("Page.getFrameTree"));
      mainFrameId = tree.frameTree.frame.id;
      input.update((summary) => ({ ...summary, url: tree.frameTree.frame.url }));
      yield* refreshHistory();
    });
    yield* setup.pipe(Effect.tapError(() => Effect.sync(unsubscribe)));

    const evaluateInHostWorld = (
      expression: string,
    ): Effect.Effect<JSONType | undefined, BrowserServiceError> =>
      Effect.gen(function* () {
        if (hostWorldContextId === null) {
          return yield* new BrowserServiceError({
            code: "browser_action_failed",
            operation: "browser.page.evaluate",
            message: "The page is not ready yet. Try again.",
            tabId,
          });
        }
        const result = evaluateResultSchema.parse(
          yield* session
            .send("Runtime.evaluate", {
              expression,
              contextId: hostWorldContextId,
              returnByValue: true,
            })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new BrowserServiceError({
                    code: "browser_action_failed",
                    operation: "browser.page.evaluate",
                    message: cause.message,
                    tabId,
                    cause,
                  }),
              ),
            ),
        );
        if (result.exceptionDetails) {
          return yield* new BrowserServiceError({
            code: "browser_action_failed",
            operation: "browser.page.evaluate",
            message: result.exceptionDetails.text,
            tabId,
          });
        }
        return result.result.value;
      });

    return {
      session,
      console: consoleBuffer,
      lastNavigation: () => lastNavigation,
      noteNavigation: (navigation) => {
        lastNavigation = navigation;
      },
      readSelectedText: () =>
        evaluateInHostWorld("globalThis.__odtSelectedText()").pipe(
          Effect.flatMap((value) => {
            const parsed = selectedTextSchema.safeParse(value);
            return parsed.success
              ? Effect.succeed(parsed.data)
              : Effect.fail(
                  new BrowserServiceError({
                    code: "browser_action_failed",
                    operation: "browser.page.evaluate",
                    message: "The page script returned an invalid selection.",
                    tabId,
                  }),
                );
          }),
        ),
      setAnchors: (next) => {
        anchors = next;
        return evaluateInHostWorld(anchorsExpression()).pipe(Effect.asVoid);
      },
      revealAnchor: (annotationId) =>
        evaluateInHostWorld(`globalThis.__odtRevealAnchor(${JSON.stringify(annotationId)})`).pipe(
          Effect.asVoid,
        ),
      close: unsubscribe,
    } satisfies BrowserHostTabSession;
  });
