import {
  type BrowserPermissionKind,
  browserUrlScheme,
  isBrowserBlankUrl,
  isBrowserNavigableUrl,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { answerOnce, createBrowserPermissionRequest } from "../browser-engine-lifecycle";
import { z } from "zod";
import {
  type BrowserEngineEvent,
  type CdpCommandError,
  type CdpEvent,
  type CdpPayload,
  sendCdp,
} from "../../../ports/browser-engine-port";
import {
  bindingCalledSchema,
  executionContextCreatedSchema,
  executionContextDestroyedSchema,
  frameIdEventSchema,
  frameNavigatedSchema,
  requestWillBeSentSchema,
} from "../../../ports/browser-cdp-schemas";
import { type CdpConnection, cdpCommand } from "../cdp/cdp-target-session";
import {
  CHROME_PAGE_BINDING,
  CHROME_PAGE_SCRIPT,
  chromePageAnswerExpression,
  chromePermissionName,
  parseChromePageMessage,
} from "./chrome-page-script";

/** One page target and the engine session that the engine keeps attached to it. */
export type ChromePageTarget = {
  readonly targetId: string;
  readonly sessionId: string;
  /** Null until `createTab` claims the target or the target opens as a popup tab. */
  tabId: string | null;
  /**
   * `createTab` opens each target on `about:blank`, which leaves a history entry before the first
   * page. The history restarts when the first page has its content: after its main-frame commit,
   * at the next `DOMContentLoaded`, when the commit is complete.
   */
  historyRestart: "none" | "after_commit" | "after_content";
  /** The URL of the last main-frame document request. A certificate error of another URL is a subresource. */
  mainDocumentUrl: string | null;
  /** Frames of the page, for download events that name a subframe. */
  readonly frames: Set<string>;
  /** Execution contexts of the page. `isDefault` marks the main world of a frame. */
  readonly contexts: Map<number, { origin: string; frameId: string | null; isDefault: boolean }>;
  /** The ends of the permission requests that wait, by the execution context that asked. */
  readonly permissionRequests: Map<number, Set<() => void>>;
};

/** A `Browser.setPermission` value that the engine set for a site in a top-level site. */
type ChromePermissionOverride = {
  readonly embeddingOrigin: string;
  readonly embeddedOrigin: string;
  readonly permission: BrowserPermissionKind;
};

export type ChromePageTargetContext = {
  readonly connection: CdpConnection;
  readonly emit: (event: BrowserEngineEvent) => void;
  /** Origins that the engine granted notifications in this process. */
  readonly notificationOrigins: Set<string>;
  /** The permission values that the engine set in this process, by `overrideKey`. */
  readonly permissionOverrides: Map<string, ChromePermissionOverride>;
  readonly runBackground: (effect: Effect.Effect<void>) => void;
};

/**
 * Prepares a new page target before it runs: certificate errors wait for the host, the page script
 * asks for permissions, and the domains that the script and the events need stay enabled.
 */
export const setUpChromePageTarget = (
  connection: CdpConnection,
  sessionId: string,
): Effect.Effect<void, CdpCommandError> =>
  Effect.gen(function* () {
    const send = (method: string, params?: CdpPayload) =>
      cdpCommand(connection, sessionId, method, params);
    // `Page.enable` keeps the script across navigations; `Runtime.enable` keeps the binding.
    yield* send("Page.enable");
    yield* send("Runtime.enable");
    yield* send("Security.enable");
    // Only the request events are needed, so the session keeps no response bodies.
    yield* send("Network.enable", { maxTotalBufferSize: 0, maxResourceBufferSize: 0 });
    yield* send("Security.setOverrideCertificateErrors", { override: true });
    yield* send("Runtime.addBinding", { name: CHROME_PAGE_BINDING });
    yield* send("Page.addScriptToEvaluateOnNewDocument", {
      source: CHROME_PAGE_SCRIPT,
      runImmediately: true,
    });
  });

/** Handles one event of the engine session of a page target. */
export const handleChromePageTargetEvent = (
  context: ChromePageTargetContext,
  target: ChromePageTarget,
  event: CdpEvent,
): void => {
  switch (event.method) {
    case "Runtime.executionContextCreated": {
      const { context: created } = executionContextCreatedSchema.parse(event.params);
      target.contexts.set(created.id, {
        origin: created.origin,
        frameId: created.auxData?.frameId ?? null,
        isDefault: created.auxData?.isDefault === true,
      });
      return;
    }
    case "Runtime.executionContextDestroyed": {
      const { executionContextId } = executionContextDestroyedSchema.parse(event.params);
      target.contexts.delete(executionContextId);
      endChromePermissionRequests(target, executionContextId);
      return;
    }
    case "Runtime.executionContextsCleared":
      target.contexts.clear();
      endChromePermissionRequests(target, null);
      return;
    case "Runtime.bindingCalled":
      onBindingCalled(context, target, bindingCalledSchema.parse(event.params));
      return;
    case "Network.requestWillBeSent": {
      const request = requestWillBeSentSchema.parse(event.params);
      if (request.type === "Document" && request.frameId === target.targetId) {
        target.mainDocumentUrl = request.request.url;
      }
      return;
    }
    case "Security.certificateError":
      onCertificateError(context, target, certificateErrorSchema.parse(event.params));
      return;
    case "Page.frameStartedNavigating":
      onFrameStartedNavigating(context, target, frameStartedNavigatingSchema.parse(event.params));
      return;
    case "Page.frameAttached":
      target.frames.add(frameIdEventSchema.parse(event.params).frameId);
      return;
    case "Page.frameNavigated": {
      const { frame } = frameNavigatedSchema.parse(event.params);
      if (
        target.historyRestart === "after_commit" &&
        frame.parentId === undefined &&
        !isBrowserBlankUrl(frame.url)
      ) {
        target.historyRestart = "after_content";
      }
      return;
    }
    case "Page.domContentEventFired":
      if (target.historyRestart === "after_content") {
        target.historyRestart = "none";
        context.runBackground(
          cdpCommand(context.connection, target.sessionId, "Page.resetNavigationHistory").pipe(
            // Without the restart, Back only shows the blank start page.
            Effect.ignore,
          ),
        );
      }
      return;
    case "Page.frameDetached": {
      const detached = frameDetachedSchema.parse(event.params);
      // A `swap` moves the frame to another process. The frame stays in the page.
      if (detached.reason !== "swap") target.frames.delete(detached.frameId);
      return;
    }
  }
};

/**
 * Sets the permission values of a site back to `prompt`, so its next request asks the host again.
 * `null` covers every permission kind. The site also stops reporting notifications.
 */
export const revokeChromeSitePermissions = (
  context: Pick<
    ChromePageTargetContext,
    "connection" | "notificationOrigins" | "permissionOverrides"
  >,
  origin: string,
  permission: BrowserPermissionKind | null,
): Effect.Effect<void, CdpCommandError> =>
  Effect.suspend(() => {
    if (permission === null || permission === "notifications") {
      context.notificationOrigins.delete(origin);
    }
    const sent: Array<Promise<CdpPayload>> = [];
    for (const [key, override] of Array.from(context.permissionOverrides)) {
      if (override.embeddedOrigin !== origin) continue;
      if (permission !== null && override.permission !== permission) continue;
      context.permissionOverrides.delete(key);
      sent.push(sendPermission(context.connection, override, "prompt"));
    }
    return sendCdp(() => Promise.all(sent));
  }).pipe(Effect.asVoid);

/**
 * Ends the waiting permission requests of one execution context, or of the whole page for `null`,
 * because their documents ended.
 */
export const endChromePermissionRequests = (
  target: ChromePageTarget,
  executionContextId: number | null,
): void => {
  const ends =
    executionContextId === null
      ? Array.from(target.permissionRequests.values()).flatMap((set) => Array.from(set))
      : Array.from(target.permissionRequests.get(executionContextId) ?? []);
  for (const end of ends) end();
};

const overrideKey = (override: ChromePermissionOverride): string =>
  `${override.embeddingOrigin} ${override.embeddedOrigin} ${override.permission}`;

/**
 * Sends `Browser.setPermission` at once, not when an Effect runs. Chrome applies the commands of
 * one connection in order, so a reset after an answer always ends the grant of the answer.
 */
const sendPermission = (
  connection: CdpConnection,
  override: ChromePermissionOverride,
  setting: "granted" | "denied" | "prompt",
): Promise<CdpPayload> =>
  connection.request(
    "Browser.setPermission",
    {
      permission: { name: chromePermissionName(override.permission) },
      setting,
      origin: override.embeddingOrigin,
      embeddedOrigin: override.embeddedOrigin,
    },
    "",
  );

const certificateErrorSchema = z.object({
  eventId: z.number(),
  errorType: z.string(),
  requestURL: z.string(),
});
const frameStartedNavigatingSchema = z.object({ frameId: z.string(), url: z.string() });
const frameDetachedSchema = z.object({ frameId: z.string(), reason: z.string().optional() });

const hostName = (url: string): string => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};

const mainFrameOrigin = (target: ChromePageTarget): string | null => {
  for (const context of target.contexts.values()) {
    if (context.isDefault && context.frameId === target.targetId) return context.origin;
  }
  return null;
};

/**
 * Asks the host for a permission of the frame that called. The answer applies to that frame origin
 * inside the top-level origin, the pair that Chrome checks for an embedded frame.
 */
const onPermissionRequest = (
  context: ChromePageTargetContext,
  target: ChromePageTarget,
  caller: { executionContextId: number; origin: string },
  request: { requestId: number; permission: BrowserPermissionKind },
): void => {
  const send = (method: string, params?: CdpPayload) =>
    cdpCommand(context.connection, target.sessionId, method, params);
  const resume = send("Runtime.evaluate", {
    expression: chromePageAnswerExpression(request.requestId),
    contextId: caller.executionContextId,
  }).pipe(
    // The document can be gone after a navigation. Its call then ends with it.
    Effect.ignore,
  );
  const embeddingOrigin = mainFrameOrigin(target);
  if (
    target.tabId === null ||
    embeddingOrigin === null ||
    !isBrowserNavigableUrl(embeddingOrigin) ||
    !isBrowserNavigableUrl(caller.origin)
  ) {
    // Chrome denies the call: the permission of the origin stays unset.
    context.runBackground(resume);
    return;
  }
  const override: ChromePermissionOverride = {
    embeddingOrigin,
    embeddedOrigin: caller.origin,
    permission: request.permission,
  };
  // The request belongs to the document of the calling context. When that context goes away, the
  // request ends: Chrome gets no permission value, and the page call ended with its document.
  const unregister = (): void => {
    const ends = target.permissionRequests.get(caller.executionContextId);
    ends?.delete(lifecycle.end);
    if (ends?.size === 0) target.permissionRequests.delete(caller.executionContextId);
  };
  const lifecycle = createBrowserPermissionRequest({
    onEnd: unregister,
    onRespond: (granted) => {
      unregister();
      // The command goes out and the engine records it at once, so a later reset covers it.
      const applied = sendPermission(context.connection, override, granted ? "granted" : "denied");
      context.permissionOverrides.set(overrideKey(override), override);
      if (request.permission === "notifications") {
        if (granted) context.notificationOrigins.add(caller.origin);
        else context.notificationOrigins.delete(caller.origin);
      }
      context.runBackground(
        sendCdp(() => applied).pipe(
          // Without a saved permission, Chrome denies the page call.
          Effect.ignore,
          Effect.andThen(resume),
        ),
      );
    },
  });
  const ends = target.permissionRequests.get(caller.executionContextId) ?? new Set();
  ends.add(lifecycle.end);
  target.permissionRequests.set(caller.executionContextId, ends);
  context.emit({
    type: "permission_requested",
    tabId: target.tabId,
    origin: caller.origin,
    permission: request.permission,
    onEnded: lifecycle.onEnded,
    respond: lifecycle.respond,
  });
};

const onBindingCalled = (
  context: ChromePageTargetContext,
  target: ChromePageTarget,
  params: z.infer<typeof bindingCalledSchema>,
): void => {
  if (params.name !== CHROME_PAGE_BINDING) return;
  const message = parseChromePageMessage(params.payload);
  const caller = target.contexts.get(params.executionContextId);
  if (message === null || caller === undefined) return;
  if (message.type === "permission") {
    onPermissionRequest(
      context,
      target,
      { executionContextId: params.executionContextId, origin: caller.origin },
      message,
    );
    return;
  }
  // Page code can call the binding, so only origins that the engine granted report notifications.
  if (target.tabId !== null && context.notificationOrigins.has(caller.origin)) {
    context.emit({
      type: "page_notification",
      tabId: target.tabId,
      origin: caller.origin,
      title: message.title,
      body: message.body,
    });
  }
};

const onCertificateError = (
  context: ChromePageTargetContext,
  target: ChromePageTarget,
  params: z.infer<typeof certificateErrorSchema>,
): void => {
  const answer = (proceed: boolean) =>
    context.runBackground(
      cdpCommand(context.connection, target.sessionId, "Security.handleCertificateError", {
        eventId: params.eventId,
        action: proceed ? "continue" : "cancel",
      }).pipe(
        // The navigation can be gone, for example after the tab closed.
        Effect.ignore,
      ),
    );
  if (target.tabId === null) {
    answer(false);
    return;
  }
  context.emit({
    type: "certificate_error",
    tabId: target.tabId,
    url: params.requestURL,
    host: hostName(params.requestURL),
    error: params.errorType,
    mainFrame: params.requestURL === target.mainDocumentUrl,
    respond: answerOnce(answer),
  });
};

const onFrameStartedNavigating = (
  context: ChromePageTargetContext,
  target: ChromePageTarget,
  params: z.infer<typeof frameStartedNavigatingSchema>,
): void => {
  if (
    params.frameId !== target.targetId ||
    isBrowserNavigableUrl(params.url) ||
    isBrowserBlankUrl(params.url)
  ) {
    return;
  }
  context.runBackground(
    cdpCommand(context.connection, target.sessionId, "Page.stopLoading").pipe(
      // The target can close while the navigation starts.
      Effect.ignore,
    ),
  );
  if (target.tabId !== null) {
    context.emit({
      type: "scheme_refused",
      tabId: target.tabId,
      scheme: browserUrlScheme(params.url) ?? params.url,
    });
  }
};
