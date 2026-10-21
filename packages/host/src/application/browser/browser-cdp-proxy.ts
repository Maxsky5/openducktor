import { isBrowserTabLoadableUrl } from "@openducktor/contracts";
import { Effect, Exit, Scope } from "effect";
import { z } from "zod";
import type { BrowserAutomationMessage } from "../../ports/browser-automation-port";
import {
  type CdpEvent,
  type CdpPayload,
  CdpProtocolError,
  type BrowserEnginePort,
} from "../../ports/browser-engine-port";
import { cdpPayloadSchema, targetInfoResultSchema } from "../../ports/browser-cdp-schemas";
import { BrowserServiceError } from "./browser-service-error";

export const cdpClientMessageSchema = z.object({
  id: z.number().int(),
  method: z.string().min(1),
  params: cdpPayloadSchema.optional(),
  sessionId: z.string().optional(),
});
export type CdpClientMessage = z.infer<typeof cdpClientMessageSchema>;

type CdpProxyClientKind = "agent" | "devtools";

export type CdpProxyClient = {
  /** One command from the client. */
  receive(message: CdpClientMessage): void;
  close(): Effect.Effect<void>;
};

export type CdpProxyClientInput = {
  tabId: string;
  engine: Pick<BrowserEnginePort, "openSession" | "reloadPage" | "captureScreenshot">;
  send(message: BrowserAutomationMessage): void;
  /** Runs when the page session ends without a close from this side. */
  onEnded(): void;
} & (
  | {
      kind: "agent";
      /**
       * `true` when a mouse press of the client starts, and `false` when the last running press
       * got its reply. A press moves the window focus to an Electron `<webview>`.
       */
      onPressing(pressing: boolean): void;
    }
  | { kind: "devtools" }
);

/**
 * One CDP client of one tab, with its own Chromium session.
 *
 * An `agent` client sees a browser target that holds only this tab, which is what Playwright
 * `connectOverCDP` expects. A `devtools` client talks to the page target directly, the way the
 * DevTools frontend does over `ws=`. Both clients reach only the tab and its child targets.
 */
export const openCdpProxyClient = (
  input: CdpProxyClientInput,
): Effect.Effect<CdpProxyClient, BrowserServiceError> =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const session = yield* input.engine.openSession(input.tabId).pipe(
      Scope.provide(scope),
      Effect.tapError(() => Scope.close(scope, Exit.void)),
      Effect.mapError(
        (cause) =>
          new BrowserServiceError({
            code: "browser_engine_error",
            operation: "browser.cdp_proxy.open",
            message: `Could not connect to the page: ${cause.message}`,
            tabId: input.tabId,
            cause,
          }),
      ),
    );
    let closed = false;
    let pageAnnounced = false;
    let pressesRunning = 0;
    /** Child targets that this client attached, such as out-of-process frames. */
    const childTargets = new Set<string>();

    /** True for a command whose `targetId` names a target outside the tab and its children. */
    const namesOtherTarget = (request: CdpClientMessage): boolean => {
      const parsed = targetIdParamsSchema.safeParse(request.params);
      return (
        parsed.success &&
        parsed.data.targetId !== session.targetId &&
        !childTargets.has(parsed.data.targetId)
      );
    };

    const trackChildTarget = (event: CdpEvent): void => {
      if (event.method === "Target.attachedToTarget") {
        const attached = attachedTargetSchema.safeParse(event.params);
        if (attached.success) childTargets.add(attached.data.targetInfo.targetId);
      } else if (event.method === "Target.detachedFromTarget") {
        const detached = targetIdParamsSchema.safeParse(event.params);
        if (detached.success) childTargets.delete(detached.data.targetId);
      }
    };

    /** Counts the mouse presses of an agent client from the command to its reply. */
    const trackPress = (request: CdpClientMessage): (() => void) => {
      if (
        input.kind !== "agent" ||
        request.method !== "Input.dispatchMouseEvent" ||
        !mousePressSchema.safeParse(request.params).success
      ) {
        return () => {};
      }
      const { onPressing } = input;
      pressesRunning += 1;
      if (pressesRunning === 1) onPressing(true);
      return () => {
        pressesRunning -= 1;
        if (pressesRunning === 0) onPressing(false);
      };
    };

    /**
     * An Electron guest drops keyboard input until a mouse press reaches its page, also with focus
     * emulation. A press with no button outside the page reaches it and fires no page events. It
     * runs inside the press report, because a press moves the window focus to the `<webview>`.
     */
    const activateKeyboard = (childSessionId: string | undefined): Promise<void> =>
      Promise.all(
        KEYBOARD_ACTIVATION_PRESS.map((params) => {
          const pressDone = trackPress({ id: 0, method: "Input.dispatchMouseEvent", params });
          return session
            .request("Input.dispatchMouseEvent", params, childSessionId)
            .finally(pressDone);
        }),
      ).then(() => undefined);

    /** The tab as a `page` target. An Electron guest reports itself as a `webview` target. */
    const pageTargetInfo = () =>
      session.request("Target.getTargetInfo").then((result) => {
        const info = targetInfoResultSchema.parse(result).targetInfo;
        return {
          targetId: info.targetId,
          type: "page",
          title: info.title,
          url: info.url,
          attached: true,
          canAccessOpener: false,
          browserContextId: AGENT_BROWSER_CONTEXT_ID,
        };
      });

    /** A reply goes to the session of its request. */
    const toSessionOf = <Message extends object>(request: CdpClientMessage, message: Message) =>
      request.sessionId === undefined ? message : { ...message, sessionId: request.sessionId };

    const reply = (request: CdpClientMessage, result: CdpPayload): void => {
      if (closed) return;
      input.send(toSessionOf(request, { id: request.id, result }));
    };

    const replyError = (
      request: CdpClientMessage,
      message: string,
      code: number = REFUSED_CODE,
    ) => {
      if (closed) return;
      input.send(toSessionOf(request, { id: request.id, error: { code, message } }));
    };

    const forward = (request: CdpClientMessage, childSessionId: string | undefined): void => {
      const refusal = refuseCommand(input.kind, request.method, request.params);
      if (refusal !== null) {
        replyError(request, refusal);
        return;
      }
      // Chromium looks up a `targetId` in the whole browser, whatever session sends the command.
      if (namesOtherTarget(request)) {
        replyError(request, `${request.method} can reach only this tab and its frames.`);
        return;
      }
      if (request.method === "Page.reload") {
        reloadPage(request);
        return;
      }
      // Only the page session captures through the engine. A child session is a frame.
      if (request.method === "Page.captureScreenshot" && childSessionId === undefined) {
        captureScreenshot(request);
        return;
      }
      // The activation commands go first, and a session runs its commands in order.
      const keyboardReady =
        input.kind === "agent" && isKeyboardInput(request)
          ? activateKeyboard(childSessionId)
          : null;
      const pressDone = trackPress(request);
      const result = session.request(request.method, request.params, childSessionId);
      (keyboardReady === null ? result : keyboardReady.then(() => result)).then(
        (value) => {
          pressDone();
          reply(request, value);
        },
        (cause: Error) => {
          pressDone();
          replyError(
            request,
            cause.message,
            cause instanceof CdpProtocolError && cause.code !== null ? cause.code : REFUSED_CODE,
          );
        },
      );
    };

    /** The engine reloads the page, because Electron cannot reload a guest over CDP. */
    const reloadPage = (request: CdpClientMessage): void => {
      const ignoreCache = reloadParamsSchema.safeParse(request.params).data?.ignoreCache ?? false;
      Effect.runPromise(Effect.result(input.engine.reloadPage(input.tabId, ignoreCache))).then(
        (result) => {
          if (result._tag === "Success") reply(request, {});
          else replyError(request, result.failure.message);
        },
      );
    };

    /** The engine takes page screenshots, because a CDP clip moves a shown Electron page. */
    const captureScreenshot = (request: CdpClientMessage): void => {
      Effect.runPromise(
        Effect.result(input.engine.captureScreenshot(input.tabId, request.params ?? {})),
      ).then((result) => {
        if (result._tag === "Success") reply(request, result.success);
        else replyError(request, result.failure.message);
      });
    };

    const announcePage = (request: CdpClientMessage): void => {
      pageTargetInfo().then(
        (targetInfo) => {
          if (!pageAnnounced && !closed) {
            pageAnnounced = true;
            input.send({
              method: "Target.attachedToTarget",
              params: { sessionId: session.sessionId, targetInfo, waitingForDebugger: false },
            });
          }
          reply(request, {});
        },
        () => replyError(request, "The page closed."),
      );
    };

    const replyTargets = (request: CdpClientMessage): void => {
      pageTargetInfo().then(
        (targetInfo) => reply(request, { targetInfos: [targetInfo] }),
        () => replyError(request, "The page closed."),
      );
    };

    /** Browser-level calls of an agent client. The browser target holds only this tab. */
    const handleAgentRoot = (request: CdpClientMessage): void => {
      switch (request.method) {
        case "Browser.getVersion":
          forward(request, undefined);
          return;
        case "Target.setAutoAttach":
          announcePage(request);
          return;
        case "Target.getTargetInfo":
          reply(request, {
            targetInfo: {
              targetId: "browser",
              type: "browser",
              title: "",
              url: "",
              attached: true,
            },
          });
          return;
        case "Target.setDiscoverTargets":
        case "Browser.setDownloadBehavior":
          reply(request, {});
          return;
        case "Target.getTargets":
          replyTargets(request);
          return;
        default:
          replyError(request, `${request.method} is not available to agents.`);
      }
    };

    /** Answers the target discovery of a DevTools client. Returns false for other commands. */
    const answerDevToolsTargets = (request: CdpClientMessage): boolean => {
      if (request.method === "Target.setDiscoverTargets") {
        reply(request, {});
        return true;
      }
      if (request.method === "Target.getTargets") {
        replyTargets(request);
        return true;
      }
      return false;
    };

    const receive = (request: CdpClientMessage): void => {
      if (closed) return;
      if (input.kind === "agent") {
        if (request.sessionId === undefined) {
          handleAgentRoot(request);
        } else if (!session.ownsSession(request.sessionId)) {
          replyError(request, `Session ${request.sessionId} is not available.`);
        } else {
          forward(request, request.sessionId === session.sessionId ? undefined : request.sessionId);
        }
        return;
      }
      if (answerDevToolsTargets(request)) {
        return;
      }
      if (request.sessionId !== undefined && !session.ownsSession(request.sessionId)) {
        replyError(request, `Session ${request.sessionId} is not available.`);
        return;
      }
      forward(request, request.sessionId);
    };

    const forwardEvent = (event: CdpEvent): void => {
      if (closed) return;
      trackChildTarget(event);
      const toPage = input.kind === "devtools" && event.sessionId === session.sessionId;
      input.send(
        toPage
          ? { method: event.method, params: event.params }
          : { method: event.method, params: event.params, sessionId: event.sessionId },
      );
    };

    const unsubscribe = session.subscribe(forwardEvent);
    yield* Scope.addFinalizer(
      scope,
      Effect.sync(() => {
        // A press without a reply must not keep the focus guard of the renderer on.
        if (input.kind === "agent" && pressesRunning > 0) input.onPressing(false);
        pressesRunning = 0;
      }),
    );
    const unsubscribeDetach = session.onDetached(() => {
      if (closed) return;
      if (input.kind === "agent" && pageAnnounced) {
        input.send({
          method: "Target.detachedFromTarget",
          params: { sessionId: session.sessionId, targetId: session.targetId },
        });
      }
      closed = true;
      input.onEnded();
    });
    yield* Scope.addFinalizer(
      scope,
      Effect.sync(() => {
        unsubscribe();
        unsubscribeDetach();
      }),
    );

    if (input.kind === "agent") {
      // Agent input must not need the window focus, so the page behaves as focused for this client.
      yield* session.send("Emulation.setFocusEmulationEnabled", { enabled: true }).pipe(
        Effect.tapError(() => Scope.close(scope, Exit.void)),
        Effect.mapError(
          (cause) =>
            new BrowserServiceError({
              code: "browser_engine_error",
              operation: "browser.cdp_proxy.open",
              message: `Could not prepare the page for agent input: ${cause.message}`,
              tabId: input.tabId,
              cause,
            }),
        ),
      );
    }

    return {
      receive,
      close: () =>
        Effect.suspend(() => {
          closed = true;
          return Scope.close(scope, Exit.void);
        }),
    } satisfies CdpProxyClient;
  });

const mousePressSchema = z.object({ type: z.literal("mousePressed") });
/** A key event that types. A key release alone types nothing. */
const keyTypingEventSchema = z.object({ type: z.enum(["keyDown", "rawKeyDown", "char"]) });

const isKeyboardInput = (request: CdpClientMessage): boolean =>
  request.method === "Input.insertText" ||
  request.method === "Input.imeSetComposition" ||
  (request.method === "Input.dispatchKeyEvent" &&
    keyTypingEventSchema.safeParse(request.params).success);

const KEYBOARD_ACTIVATION_PRESS = (["mousePressed", "mouseReleased"] as const).map((type) => ({
  type,
  x: -1,
  y: -1,
  button: "none",
  clickCount: 0,
}));
const targetIdParamsSchema = z.object({ targetId: z.string() });
const attachedTargetSchema = z.object({ targetInfo: z.object({ targetId: z.string() }) });

/** One browser context ID for every page that an agent client sees. */
const AGENT_BROWSER_CONTEXT_ID = "openducktor-agent-context";
/** The CDP error code of a command that the proxy refuses. */
const REFUSED_CODE = -32000;

const navigateParamsSchema = z.object({ url: z.string() });
const reloadParamsSchema = z.object({ ignoreCache: z.boolean().optional() });

/** `Target` calls that stay inside the tab and its child targets. */
const TAB_TARGET_METHODS = new Set([
  "Target.setAutoAttach",
  "Target.getTargetInfo",
  "Target.detachFromTarget",
]);

const CERTIFICATE_OVERRIDE_METHODS = new Set([
  "Security.setIgnoreCertificateErrors",
  "Security.handleCertificateError",
  "Security.setOverrideCertificateErrors",
]);

/** Agent calls that could upload files, answer dialogs for the user, or change the page for everyone. */
const AGENT_BLOCKED_METHODS = new Set([
  "DOM.setFileInputFiles",
  "Page.handleJavaScriptDialog",
  "Page.bringToFront",
  "Page.close",
  "Page.setDownloadBehavior",
]);

/**
 * Checks one command from an agent or DevTools client. Returns the refusal message, or null when
 * the proxy may forward the command. The proxy answers some `Target` calls itself before this
 * check.
 */
const refuseCommand = (
  kind: CdpProxyClientKind,
  method: string,
  params: CdpPayload | undefined,
): string | null => {
  const domain = method.slice(0, method.indexOf("."));
  if (domain === "Target" && !TAB_TARGET_METHODS.has(method)) {
    return `${method} reaches other targets and is not available here.`;
  }
  if (domain === "Browser" && method !== "Browser.getVersion") {
    return `${method} changes the whole browser and is not available here.`;
  }
  if (CERTIFICATE_OVERRIDE_METHODS.has(method)) {
    return "Certificate errors can only be bypassed by the user in the tab.";
  }
  if (method === "Page.navigate") {
    const parsed = navigateParamsSchema.safeParse(params);
    if (!parsed.success) {
      return "Page.navigate needs a url.";
    }
    if (!isBrowserTabLoadableUrl(parsed.data.url)) {
      return "Browser tabs load only http and https pages.";
    }
  }
  if (kind === "agent") {
    if (AGENT_BLOCKED_METHODS.has(method) || domain === "Fetch") {
      return `${method} is not available to agents.`;
    }
    if (domain === "Emulation" && method !== "Emulation.setFocusEmulationEnabled") {
      return `${method} would change the page for the user and is not available to agents.`;
    }
  }
  return null;
};
