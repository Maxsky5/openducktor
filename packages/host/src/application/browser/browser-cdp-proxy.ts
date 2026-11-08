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
  /**
   * Makes the page behave as focused, so agent input does not need the window focus. Chromium
   * keeps an emulated page drawing at full speed, also while no panel shows it, so an agent turns
   * it on only while one of its actions runs.
   */
  emulateFocus(enabled: boolean): Effect.Effect<void, BrowserServiceError>;
  close(): Effect.Effect<void>;
};

export type CdpProxyClientInput = {
  tabId: string;
  engine: Pick<BrowserEnginePort, "openSession" | "reloadPage" | "captureScreenshot">;
  send(message: BrowserAutomationMessage): void;
  /** Runs when the page session ends without a close from this side. */
  onEnded(): void;
} & ({ kind: "agent" } | { kind: "devtools" });

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

    /** The tab as a `page` target. */
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
      // The proxy turns focus emulation on for each agent action. Playwright asks for it once when
      // it connects, and that would keep the page drawing while no action runs.
      if (input.kind === "agent" && request.method === "Emulation.setFocusEmulationEnabled") {
        reply(request, {});
        return;
      }
      // Only the page session captures through the engine. A child session is a frame.
      if (request.method === "Page.captureScreenshot" && childSessionId === undefined) {
        captureScreenshot(request);
        return;
      }
      session.request(request.method, request.params, childSessionId).then(
        (value) => reply(request, value),
        (cause: Error) =>
          replyError(
            request,
            cause.message,
            cause instanceof CdpProtocolError && cause.code !== null ? cause.code : REFUSED_CODE,
          ),
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

    return {
      receive,
      emulateFocus: (enabled) =>
        session.send("Emulation.setFocusEmulationEnabled", { enabled }).pipe(
          Effect.asVoid,
          Effect.mapError(
            (cause) =>
              new BrowserServiceError({
                code: "browser_engine_error",
                operation: "browser.cdp_proxy.emulate_focus",
                message: `Could not prepare the page for agent input: ${cause.message}`,
                tabId: input.tabId,
                cause,
              }),
          ),
        ),
      close: () =>
        Effect.suspend(() => {
          closed = true;
          return Scope.close(scope, Exit.void);
        }),
    } satisfies CdpProxyClient;
  });

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
