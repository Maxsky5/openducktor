import {
  type BrowserAnnotationCapture,
  type BrowserAnnotationElement,
  type BrowserBox,
  browserAnnotationElementSchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { z } from "zod";
import type {
  BrowserEngineError,
  BrowserEnginePort,
  CdpCommandError,
  CdpPayload,
  CdpSession,
} from "../../ports/browser-engine-port";
import {
  boxModelResultSchema,
  evaluateResultSchema,
  layoutMetricsResultSchema,
  nodeForLocationResultSchema,
  partialAxTreeResultSchema,
  resolveNodeResultSchema,
  screenshotResultSchema,
} from "../../ports/browser-cdp-schemas";
import { BROWSER_PAGE_CAPTURE_BUNDLE } from "./page-capture/browser-page-capture.generated";
import { BrowserServiceError } from "./browser-service-error";
import type { BrowserTabRegistry } from "./browser-tab-registry";
import type { BrowserTabService } from "./browser-tab-service";

const SCREENSHOT_PADDING = 8;

/** Finds the nearest React component name of an element, or null. It runs in the page. */
const LABEL_FUNCTION = `function () {
  const key = Object.keys(this).find((name) => name.startsWith("__reactFiber$"));
  let fiber = key ? this[key] : null;
  while (fiber) {
    const type = fiber.type;
    if (type && typeof type !== "string") {
      const inner = type.render || type.type || type;
      const name = type.displayName || type.name || inner.displayName || inner.name;
      if (name) return name;
    }
    fiber = fiber.return;
  }
  return null;
}`;

/** Runs the bundled capture code once in the main world of the page, with bippy for React data. */
const CAPTURE_FUNCTION = `async function (...elements) {
  ${BROWSER_PAGE_CAPTURE_BUNDLE}
  const capture = globalThis.__openducktorPageCapture;
  delete globalThis.__openducktorPageCapture;
  return await capture(elements);
}`;

const capturedElementsSchema = z.array(browserAnnotationElementSchema.omit({ accessible: true }));

/** Chromium errors for a point with no element, or an element without a box or a node. */
const MISSING_NODE_MESSAGES = [
  "No node found at given location",
  "Could not compute box model.",
  "No node with given id found",
];

type Cdp = (method: string, params?: CdpPayload) => Effect.Effect<CdpPayload, BrowserServiceError>;

export type BrowserPickerInput = {
  engine: Pick<BrowserEnginePort, "captureScreenshot">;
  registry: Pick<BrowserTabRegistry, "get">;
  requireLive: BrowserTabService["requireLive"];
  stageImage(base64Png: string, name: string): Effect.Effect<{ path: string }, BrowserServiceError>;
};

/**
 * The element picker. It injects no highlight script: the host finds the element under the
 * pointer with CDP, and the OpenDucktor overlay draws the highlight over the page surface.
 */
export const createBrowserPicker = ({
  engine,
  registry,
  requireLive,
  stageImage,
}: BrowserPickerInput) => {
  const enabledTabs = new Set<string>();

  const setEnabled = (tabId: string, enabled: boolean) =>
    Effect.gen(function* () {
      const host = yield* requireLive(tabId, "browser.picker.set");
      const cdp = cdpFor(host.session, tabId, "browser.picker.set");
      if (enabled) {
        yield* cdp("Animation.enable");
        yield* cdp("Animation.setPlaybackRate", { playbackRate: 0 });
        enabledTabs.add(tabId);
      } else {
        enabledTabs.delete(tabId);
        yield* cdp("Animation.setPlaybackRate", { playbackRate: 1 });
        yield* cdp("Animation.disable");
      }
    });

  /**
   * The element under a point in CSS pixels of the viewport, with its box and label, or null when
   * no element is there. `DOM.getNodeForLocation` takes document points, so the point gets the
   * scroll offset. The box of `DOM.getBoxModel` is already in viewport points.
   */
  const hover = (tabId: string, x: number, y: number) =>
    Effect.gen(function* () {
      if (!enabledTabs.has(tabId)) {
        return null;
      }
      const operation = "browser.picker.hover";
      const host = yield* requireLive(tabId, operation);
      const cdp = cdpFor(host.session, tabId, operation);
      const viewport = layoutMetricsResultSchema.parse(
        yield* cdp("Page.getLayoutMetrics"),
      ).cssVisualViewport;
      const located = yield* host.session
        .send("DOM.getNodeForLocation", {
          x: Math.round(x + viewport.pageX),
          y: Math.round(y + viewport.pageY),
          includeUserAgentShadowDOM: false,
          ignorePointerEventsNone: true,
        })
        .pipe(
          Effect.map((result) => nodeForLocationResultSchema.parse(result)),
          // The pointer can be over no element, or over one that has no box or just left the page.
          Effect.catchIf(isMissingNodeError, () => Effect.succeed(null)),
          Effect.mapError(actionFailure(tabId, operation)),
        );
      if (located === null) {
        return null;
      }
      const box = yield* host.session
        .send("DOM.getBoxModel", { backendNodeId: located.backendNodeId })
        .pipe(
          Effect.map((result) => borderBox(boxModelResultSchema.parse(result).model.border)),
          Effect.catchIf(isMissingNodeError, () => Effect.succeed(null)),
          Effect.mapError(actionFailure(tabId, operation)),
        );
      if (box === null) {
        return null;
      }
      const objectId = yield* nodeObject(cdp, tabId, located.backendNodeId, operation);
      const label = evaluateResultSchema.parse(
        yield* cdp("Runtime.callFunctionOn", {
          objectId,
          functionDeclaration: `function () { const component = (${LABEL_FUNCTION}).call(this); return component || this.localName; }`,
          returnByValue: true,
        }),
      );
      yield* cdp("Runtime.releaseObject", { objectId });
      return {
        nodeRef: String(located.backendNodeId),
        box,
        label: z.string().min(1).catch("element").parse(label.result.value),
      };
    });

  const capture = (
    tabId: string,
    nodeRefs: readonly string[],
  ): Effect.Effect<BrowserAnnotationCapture, BrowserServiceError> =>
    Effect.gen(function* () {
      const operation = "browser.annotation.capture";
      const host = yield* requireLive(tabId, operation);
      const record = registry.get(tabId);
      const cdp = cdpFor(host.session, tabId, operation);
      const nodeIds = yield* Effect.forEach(nodeRefs, (nodeRef) =>
        parseNodeRef(tabId, nodeRef, operation),
      );
      const objectIds = yield* Effect.forEach(nodeIds, (nodeId) =>
        nodeObject(cdp, tabId, nodeId, operation),
      );
      const [first, ...rest] = objectIds;
      if (first === undefined) {
        return yield* new BrowserServiceError({
          code: "browser_action_failed",
          operation,
          message: "Select at least one element.",
          tabId,
        });
      }
      const captured = evaluateResultSchema.parse(
        yield* cdp("Runtime.callFunctionOn", {
          objectId: first,
          functionDeclaration: CAPTURE_FUNCTION,
          arguments: [first, ...rest].map((objectId) => ({ objectId })),
          awaitPromise: true,
          returnByValue: true,
        }),
      );
      if (captured.exceptionDetails) {
        return yield* new BrowserServiceError({
          code: "browser_action_failed",
          operation,
          message: `Could not read the elements: ${captured.exceptionDetails.text}`,
          tabId,
        });
      }
      const pageElements = capturedElementsSchema.parse(captured.result.value);
      const elements: BrowserAnnotationElement[] = [];
      for (const [index, element] of pageElements.entries()) {
        const nodeId = nodeIds[index] ?? 0;
        elements.push({ ...element, accessible: yield* accessibleOf(cdp, nodeId) });
      }
      yield* Effect.forEach(objectIds, (objectId) => cdp("Runtime.releaseObject", { objectId }), {
        discard: true,
      });
      const boxes = yield* Effect.forEach(nodeIds, (nodeId) => nodeBox(cdp, nodeId));
      const shot = yield* screenshotOf(cdp, boxes, (params) =>
        engine
          .captureScreenshot(tabId, params)
          .pipe(Effect.mapError(actionFailure(tabId, operation))),
      );
      const image =
        shot === null
          ? null
          : { ...pngSize(shot), path: (yield* stageImage(shot, "browser-annotation.png")).path };
      const selectedText = yield* host.readSelectedText();
      return {
        page: { url: record?.summary.url ?? "", title: record?.summary.title ?? "" },
        selectedText,
        elements,
        image,
      };
    });

  return {
    setEnabled,
    hover,
    capture,
    forget: (tabId: string) => enabledTabs.delete(tabId),
  };
};

export type BrowserPicker = ReturnType<typeof createBrowserPicker>;

/** CDP calls of one picker operation. A CDP failure becomes an action failure of the tab. */
const cdpFor =
  (session: CdpSession, tabId: string, operation: string): Cdp =>
  (method, params) =>
    session.send(method, params).pipe(Effect.mapError(actionFailure(tabId, operation)));

const nodeBox = (cdp: Cdp, backendNodeId: number) =>
  cdp("DOM.getBoxModel", { backendNodeId }).pipe(
    Effect.map((result) => borderBox(boxModelResultSchema.parse(result).model.border)),
  );

const nodeObject = (cdp: Cdp, tabId: string, backendNodeId: number, operation: string) =>
  cdp("DOM.resolveNode", { backendNodeId }).pipe(
    Effect.map((result) => resolveNodeResultSchema.parse(result).object.objectId),
    Effect.flatMap((objectId) =>
      objectId === undefined
        ? Effect.fail(
            new BrowserServiceError({
              code: "browser_action_failed",
              operation,
              message: "The element is no longer on the page.",
              tabId,
            }),
          )
        : Effect.succeed(objectId),
    ),
  );

const accessibleOf = (cdp: Cdp, backendNodeId: number) =>
  cdp("Accessibility.getPartialAXTree", { backendNodeId, fetchRelatives: false }).pipe(
    Effect.map((result) => {
      const node = partialAxTreeResultSchema.parse(result).nodes[0];
      if (!node || node.ignored) {
        return null;
      }
      return {
        role: z.string().catch("").parse(node.role?.value),
        name: z.string().catch("").parse(node.name?.value),
      };
    }),
  );

/** The selected boxes with some space around them, from the page as it shows. */
const screenshotOf = (
  cdp: Cdp,
  boxes: BrowserBox[],
  captureScreenshot: (params: CdpPayload) => Effect.Effect<CdpPayload, BrowserServiceError>,
) =>
  Effect.gen(function* () {
    const metrics = layoutMetricsResultSchema.parse(yield* cdp("Page.getLayoutMetrics"));
    const viewport = metrics.cssVisualViewport;
    const left = Math.max(0, Math.min(...boxes.map((box) => box.x)) - SCREENSHOT_PADDING);
    const top = Math.max(0, Math.min(...boxes.map((box) => box.y)) - SCREENSHOT_PADDING);
    const right = Math.min(
      viewport.clientWidth,
      Math.max(...boxes.map((box) => box.x + box.width)) + SCREENSHOT_PADDING,
    );
    const bottom = Math.min(
      viewport.clientHeight,
      Math.max(...boxes.map((box) => box.y + box.height)) + SCREENSHOT_PADDING,
    );
    if (right - left < 1 || bottom - top < 1) {
      return null;
    }
    const shot = screenshotResultSchema.parse(
      yield* captureScreenshot({
        format: "png",
        clip: {
          x: left + viewport.pageX,
          y: top + viewport.pageY,
          width: right - left,
          height: bottom - top,
          scale: 1,
        },
      }),
    );
    return shot.data;
  });

const isMissingNodeError = (error: CdpCommandError): boolean =>
  MISSING_NODE_MESSAGES.some((message) => error.message.includes(message));

const actionFailure =
  (tabId: string, operation: string) => (cause: CdpCommandError | BrowserEngineError) =>
    new BrowserServiceError({
      code: "browser_action_failed",
      operation,
      message: cause.message,
      tabId,
      cause,
    });

const borderBox = (quad: readonly number[]): BrowserBox => {
  const xs = [quad[0] ?? 0, quad[2] ?? 0, quad[4] ?? 0, quad[6] ?? 0];
  const ys = [quad[1] ?? 0, quad[3] ?? 0, quad[5] ?? 0, quad[7] ?? 0];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
};

const pngSize = (base64: string) => {
  const header = Uint8Array.from(atob(base64.slice(0, 64)), (char) => char.charCodeAt(0));
  const view = new DataView(header.buffer);
  return { width: view.getUint32(16, false), height: view.getUint32(20, false) };
};

const parseNodeRef = (tabId: string, nodeRef: string, operation: string) => {
  const backendNodeId = Number(nodeRef);
  return Number.isInteger(backendNodeId) && backendNodeId > 0
    ? Effect.succeed(backendNodeId)
    : Effect.fail(
        new BrowserServiceError({
          code: "browser_action_failed",
          operation,
          message: `Element ${nodeRef} is not a picker result.`,
          tabId,
        }),
      );
};
