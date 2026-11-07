import { describe, expect, test } from "bun:test";
import type { BrowserPickedElement } from "@openducktor/contracts";
import { Effect, Exit } from "effect";
import { CdpCommandError, type CdpSession } from "../../ports/browser-engine-port";
import type { BrowserHostTabSession } from "./browser-host-tab-session";
import { createBrowserPicker, nextPickerSelection } from "./browser-picker";
import { BrowserServiceError } from "./browser-service-error";

const TAB_ID = "11111111-1111-4111-8111-111111111111";

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

const picked = (nodeRef: string): BrowserPickedElement => ({
  nodeRef,
  box: { x: 10, y: 20, width: 80, height: 30 },
  label: "button",
});

const createHarness = (
  options: {
    /** Runs inside the hit test, so a test can turn the picker off during a lookup. */
    duringHitTest?: () => void;
    /** Returns true for an expression that fails, as a page that lost its world does. */
    failEval?: (expression: string) => boolean;
    /** Returns true for a CDP command that fails. */
    failCommand?: (method: string) => boolean;
  } = {},
) => {
  const log: string[] = [];
  const hitTests: unknown[] = [];
  const reported: Array<[string, unknown]> = [];
  const session: CdpSession = {
    sessionId: "SESSION",
    targetId: "TARGET",
    request: async () => ({}),
    send: (method, params) => {
      if (options.failCommand?.(method)) {
        return Effect.fail(
          new CdpCommandError({ message: `The page refused ${method}.`, cause: null }),
        );
      }
      return Effect.sync(() => {
        log.push(`command:${method}`);
        switch (method) {
          case "Page.getLayoutMetrics":
            return {
              cssVisualViewport: { clientWidth: 800, clientHeight: 600, pageX: 0, pageY: 0 },
            };
          case "DOM.getNodeForLocation":
            options.duringHitTest?.();
            hitTests.push(params);
            return { backendNodeId: 42 };
          case "DOM.getBoxModel":
            return { model: { border: [10, 20, 90, 20, 90, 50, 10, 50] } };
          case "DOM.resolveNode":
            return { object: { type: "object", objectId: "object-42" } };
          case "Runtime.callFunctionOn":
            return { result: { type: "string", value: "button" } };
          default:
            return {};
        }
      });
    },
    subscribe: () => () => {},
    onDetached: () => () => {},
    ownsSession: () => true,
  };
  const host: BrowserHostTabSession = {
    session,
    console: { read: () => ({ entries: [], dropped: 0, lastSequence: 0 }) },
    lastNavigation: () => null,
    noteNavigation: () => {},
    evaluate: (expression) =>
      options.failEval?.(expression)
        ? Effect.fail(
            new BrowserServiceError({
              code: "browser_action_failed",
              operation: "browser.picker.test",
              message: `The page refused ${expression}.`,
            }),
          )
        : Effect.sync(() => {
            log.push(`eval:${expression}`);
            return undefined;
          }),
    readSelectedText: () => Effect.succeed(null),
    setAnchors: () => Effect.void,
    revealAnchor: () => Effect.void,
    close: () => {},
  };
  const picker = createBrowserPicker({
    engine: { captureScreenshot: () => Effect.die("unused") },
    registry: { get: () => undefined },
    requireLive: () => Effect.succeed(host),
    stageImage: () => Effect.die("unused"),
    reportFailure: (operation, cause) => reported.push([operation, cause]),
  });
  return { picker, log, hitTests, reported };
};

describe("browser picker", () => {
  test("hides the pointer capture for the hit test and shows it again", async () => {
    const { picker, log, hitTests } = createHarness();
    await run(picker.setEnabled(TAB_ID, true));
    const result = await run(
      picker.handlePageMessage(TAB_ID, {
        type: "picker_pick",
        x: 100,
        y: 50,
        shiftKey: false,
      }),
    );

    expect(result).toEqual({ kind: "selection", selection: [picked("42")] });
    const hide = log.indexOf("eval:globalThis.__odtPickerHitTest(true)");
    const hitTest = log.indexOf("command:DOM.getNodeForLocation");
    const show = log.indexOf("eval:globalThis.__odtPickerHitTest(false)");
    expect(hide).toBeGreaterThanOrEqual(0);
    expect(hitTest).toBeGreaterThan(hide);
    expect(show).toBeGreaterThan(hitTest);
    // The picker visuals rely on pointer-events: none, so the hit test must respect that property.
    expect(hitTests).toEqual([
      {
        x: 100,
        y: 50,
        includeUserAgentShadowDOM: false,
        ignorePointerEventsNone: false,
      },
    ]);
  });

  test("rolls back a failed enable and leaves the picker off", async () => {
    const { picker, log } = createHarness({
      failEval: (expression) => expression === "globalThis.__odtPickerActive(true)",
    });

    const exit = await Effect.runPromiseExit(picker.setEnabled(TAB_ID, true));

    expect(Exit.isFailure(exit)).toBe(true);
    expect(log).toContain("eval:globalThis.__odtPickerActive(false)");
    expect(log).toContain("command:Animation.disable");
    const result = await run(
      picker.handlePageMessage(TAB_ID, { type: "picker_pick", x: 100, y: 50, shiftKey: false }),
    );
    expect(result).toEqual({ kind: "none" });
  });

  test("tells the client about a cancel when animation cleanup fails", async () => {
    let failCleanup = false;
    const { picker, reported } = createHarness({
      failCommand: (method) => failCleanup && method === "Animation.setPlaybackRate",
    });
    await run(picker.setEnabled(TAB_ID, true));
    failCleanup = true;

    const result = await run(picker.handlePageMessage(TAB_ID, { type: "picker_cancel" }));

    expect(result).toEqual({ kind: "cancelled" });
    expect(reported).toHaveLength(1);
    expect(reported[0]?.[0]).toBe("browser.picker.cleanup");
  });

  test("clears host state when a repeated enable fails", async () => {
    let failEnable = false;
    const { picker } = createHarness({
      failEval: (expression) => failEnable && expression === "globalThis.__odtPickerActive(true)",
    });
    await run(picker.setEnabled(TAB_ID, true));
    failEnable = true;

    const exit = await Effect.runPromiseExit(picker.setEnabled(TAB_ID, true));
    expect(Exit.isFailure(exit)).toBe(true);
    const result = await run(
      picker.handlePageMessage(TAB_ID, { type: "picker_pick", x: 100, y: 50, shiftKey: false }),
    );
    expect(result).toEqual({ kind: "none" });
  });

  test("does not draw a late hover after the picker turns off", async () => {
    let picker: ReturnType<typeof createBrowserPicker>;
    const harness = createHarness({
      duringHitTest: () => {
        Effect.runSync(picker.setEnabled(TAB_ID, false));
      },
    });
    picker = harness.picker;
    await run(picker.setEnabled(TAB_ID, true));
    harness.log.length = 0;

    await run(picker.handlePageMessage(TAB_ID, { type: "picker_hover", x: 100, y: 50 }));

    expect(
      harness.log.filter((entry) => entry.startsWith('eval:globalThis.__odtPickerTarget({"')),
    ).toEqual([]);
  });

  test("does not select when the picker turns off during the lookup", async () => {
    let picker: ReturnType<typeof createBrowserPicker>;
    const harness = createHarness({
      duringHitTest: () => {
        Effect.runSync(picker.setEnabled(TAB_ID, false));
      },
    });
    picker = harness.picker;
    await run(picker.setEnabled(TAB_ID, true));
    harness.log.length = 0;

    const result = await run(
      picker.handlePageMessage(TAB_ID, { type: "picker_pick", x: 100, y: 50, shiftKey: false }),
    );

    expect(result).toEqual({ kind: "none" });
    expect(
      harness.log.filter((entry) => entry.startsWith("eval:globalThis.__odtPickerSelection(")),
    ).toEqual([]);
  });
});

describe("nextPickerSelection", () => {
  test("replaces without Shift, and adds or removes with Shift", () => {
    const first = picked("1");
    const second = picked("2");

    expect(nextPickerSelection([first], second, false)).toEqual([second]);
    expect(nextPickerSelection([first], second, true)).toEqual([first, second]);
    expect(nextPickerSelection([first, second], first, true)).toEqual([second]);
  });
});
