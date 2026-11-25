import { describe, expect, spyOn, test } from "bun:test";
import { render } from "@testing-library/react";
import { Activity, act, createElement, useRef } from "react";
import type { AgentChatTranscriptRow } from "@openducktor/frontend-core/sessions/transcript/agent-chat-transcript-model";
import { enableReactActEnvironment } from "@openducktor/frontend-core/test-support/react-act-environment";
import { restoreAfterTestBody } from "@/test-utils/restore-after-test-body";
import { createTranscriptSlideController } from "./agent-chat-transcript-slide-controller";
import {
  type TailOpenToolRun,
  useAgentChatRowEntryMotion,
} from "./use-agent-chat-row-entry-motion";

enableReactActEnvironment();

type RecordedAnimation = {
  element: HTMLElement;
  keyframes: Keyframe[] | PropertyIndexedKeyframes | null;
  cancelled: boolean;
  finish: () => void;
};

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const createMessageRow = (
  key: string,
  role: "user" | "assistant" = "assistant",
  content = key,
): AgentChatTranscriptRow => {
  if (role === "assistant") {
    return {
      kind: "message",
      key,
      message: {
        id: key,
        role: "assistant",
        content,
        timestamp: "2026-02-20T10:01:00.000Z",
        meta: { kind: "assistant", isFinal: true },
      },
    };
  }
  return {
    kind: "message",
    key,
    message: {
      id: key,
      role: "user",
      content,
      timestamp: "2026-02-20T10:01:00.000Z",
    },
  };
};

const createDurationRow = (key: string): AgentChatTranscriptRow => ({
  kind: "turn_duration",
  key,
  durationMs: 3_000,
});

const installAnimationRecorder = () => {
  const recorded: RecordedAnimation[] = [];
  const runAnimation = HTMLElement.prototype.animate;
  const animateSpy = spyOn(HTMLElement.prototype, "animate").mockImplementation(function (
    this: HTMLElement,
    keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
    options?: number | KeyframeAnimationOptions,
  ) {
    const animation = runAnimation.call(this, keyframes, options);
    const deferred = Promise.withResolvers<Animation>();
    const entry: RecordedAnimation = {
      element: this,
      keyframes,
      cancelled: false,
      finish: () => deferred.resolve(animation),
    };
    Object.defineProperty(animation, "finished", {
      configurable: true,
      value: deferred.promise,
    });
    animation.cancel = () => {
      entry.cancelled = true;
      deferred.reject(new DOMException("Cancelled", "AbortError"));
    };
    recorded.push(entry);
    return animation;
  });

  return {
    recorded,
    restore: () => animateSpy.mockRestore(),
  };
};

const createSyntheticSlideDom = ({
  clientHeight,
  getScrollHeight,
  initialScrollTop,
}: {
  clientHeight: number;
  getScrollHeight: () => number;
  initialScrollTop: number;
}) => {
  const container = document.createElement("div");
  const turnsClip = document.createElement("div");
  const turns = document.createElement("div");
  turnsClip.appendChild(turns);
  container.appendChild(turnsClip);
  document.body.appendChild(container);

  let scrollTopValue = initialScrollTop;
  Object.defineProperty(container, "clientHeight", {
    configurable: true,
    get: () => clientHeight,
  });
  Object.defineProperty(container, "scrollHeight", {
    configurable: true,
    get: () => getScrollHeight(),
  });
  Object.defineProperty(container, "scrollTop", {
    configurable: true,
    get: () => scrollTopValue,
    set: (value: number) => {
      const max = Math.max(0, container.scrollHeight - container.clientHeight);
      scrollTopValue = Math.max(0, Math.min(value, max));
    },
  });

  return { container, turnsClip, turns, remove: () => container.remove() };
};

type MotionHarnessProps = {
  sessionKey: string | null;
  isGrouped: boolean;
  rows: readonly AgentChatTranscriptRow[];
  mountedRows: readonly AgentChatTranscriptRow[];
  tailOpenRun?: TailOpenToolRun | null;
  isPinned?: () => boolean;
  isLatestWindow?: boolean;
  activityMode?: "visible" | "hidden";
};

const mountMotionHarness = async ({
  initialProps,
  clientHeight,
  initialScrollTop,
  rowHeightFor,
  extraHeightPx = { current: 0 },
  autoSyncOnCommit = true,
}: {
  initialProps: MotionHarnessProps;
  clientHeight: number;
  initialScrollTop: number;
  rowHeightFor: (rowKey: string) => number;
  extraHeightPx?: { current: number };
  autoSyncOnCommit?: boolean;
}) => {
  const recorder = installAnimationRecorder();
  const rectSpy = spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const key = this.getAttribute("data-row-key");
      if (key !== null) {
        return new DOMRect(0, 0, 600, rowHeightFor(key));
      }
      return new DOMRect(0, 0, 600, clientHeight);
    },
  );

  let mountedRowsRef: readonly AgentChatTranscriptRow[] = initialProps.mountedRows;
  let scrollTopValue = initialScrollTop;
  let containerEl: HTMLDivElement | null = null;
  let turnsClipEl: HTMLDivElement | null = null;
  let turnsEl: HTMLDivElement | null = null;
  const slideController = createTranscriptSlideController();

  const configureContainer = (element: HTMLDivElement | null) => {
    if (!element || element === containerEl) return;
    containerEl = element;
    Object.defineProperty(element, "clientHeight", {
      configurable: true,
      get: () => clientHeight,
    });
    Object.defineProperty(element, "scrollHeight", {
      configurable: true,
      get: () =>
        mountedRowsRef.reduce((sum, row) => sum + rowHeightFor(row.key), 0) + extraHeightPx.current,
    });
    Object.defineProperty(element, "scrollTop", {
      configurable: true,
      get: () => scrollTopValue,
      set: (value: number) => {
        const max = Math.max(0, element.scrollHeight - element.clientHeight);
        scrollTopValue = Math.max(0, Math.min(value, max));
      },
    });
  };

  const syncScrollPosition = () => {
    if (!containerEl) return;
    containerEl.scrollTop = containerEl.scrollHeight;
  };

  const Inner = (props: Omit<MotionHarnessProps, "activityMode">) => {
    mountedRowsRef = props.mountedRows;
    const containerRef = useRef<HTMLDivElement | null>(null);
    const turnsClipRef = useRef<HTMLDivElement | null>(null);
    const turnsRef = useRef<HTMLDivElement | null>(null);

    const setContainerRef = (element: HTMLDivElement | null) => {
      containerRef.current = element;
      configureContainer(element);
    };
    const setTurnsClipRef = (element: HTMLDivElement | null) => {
      turnsClipRef.current = element;
      if (element) turnsClipEl = element;
    };
    const setTurnsRef = (element: HTMLDivElement | null) => {
      turnsRef.current = element;
      if (element) turnsEl = element;
    };

    useAgentChatRowEntryMotion({
      sessionKey: props.sessionKey,
      isGrouped: props.isGrouped,
      rows: props.rows,
      containerRef,
      turnsClipRef,
      turnsRef,
      mountedRows: props.mountedRows,
      tailOpenRun: props.tailOpenRun ?? null,
      isPinned: props.isPinned ?? (() => true),
      isLatestWindow: props.isLatestWindow ?? true,
      syncScrollPosition,
      slideController,
    });

    return createElement(
      "div",
      { ref: setContainerRef },
      createElement(
        "div",
        { ref: setTurnsClipRef },
        createElement(
          "div",
          { ref: setTurnsRef },
          props.mountedRows.map((row) =>
            createElement("div", { key: row.key, "data-row-key": row.key }, row.key),
          ),
        ),
      ),
    );
  };

  const Wrapper = (props: MotionHarnessProps) => {
    const { activityMode = "visible", ...innerProps } = props;
    return createElement(Activity, {
      mode: activityMode,
      children: createElement(Inner, innerProps),
    });
  };

  const rendered = render(createElement(Wrapper, initialProps));
  const dispose = restoreAfterTestBody(() => {
    rectSpy.mockRestore();
    recorder.restore();
    rendered.unmount();
  });
  await act(flush);

  const getElements = () => {
    if (!containerEl || !turnsClipEl || !turnsEl) {
      throw new Error("Expected mounted synthetic transcript elements");
    }
    return {
      container: containerEl,
      turnsClip: turnsClipEl,
      turns: turnsEl,
    };
  };

  const rerender = async (nextProps: MotionHarnessProps) => {
    const previousMountedCount = mountedRowsRef.length;
    const previousFirstKey = mountedRowsRef[0]?.key ?? null;
    mountedRowsRef = nextProps.mountedRows;
    if (
      autoSyncOnCommit &&
      (nextProps.activityMode ?? "visible") === "visible" &&
      (nextProps.isPinned?.() ?? true) &&
      (nextProps.isLatestWindow ?? true) &&
      (nextProps.mountedRows.length !== previousMountedCount ||
        (nextProps.mountedRows[0]?.key ?? null) !== previousFirstKey)
    ) {
      // Mirrors useAgentChatWindow's committedRowWindowVersion syncScrollPosition effect.
      syncScrollPosition();
    }
    rendered.rerender(createElement(Wrapper, nextProps));
    await act(flush);
  };

  return {
    getElements,
    recorded: recorder.recorded,
    slideController,
    syncScrollPosition,
    rerender,
    dispose,
  };
};

describe("createTranscriptSlideController", () => {
  test("slides overflowing content, composes mid-slide additions, and caps offset at maxScrollTop", async () => {
    const recorder = installAnimationRecorder();
    let scrollHeight = 600;
    const { container, turnsClip, turns, remove } = createSyntheticSlideDom({
      clientHeight: 200,
      getScrollHeight: () => scrollHeight,
      initialScrollTop: 400,
    });
    const dispose = restoreAfterTestBody(() => {
      remove();
      recorder.restore();
    });

    try {
      const controller = createTranscriptSlideController();
      controller.syncBaseline(container, "r0");

      scrollHeight = 640;
      container.scrollTop = 440;
      expect(controller.slide({ container, turnsClip, turns }, 40, "r0")).toBe(true);
      expect(controller.isSliding()).toBe(true);
      expect(turnsClip.style.overflowY).toBe("clip");
      expect(recorder.recorded[0]?.keyframes).toEqual([
        { transform: "translateY(40px)" },
        { transform: "none" },
      ]);

      turns.style.transform = "matrix(1, 0, 0, 1, 0, 18)";
      scrollHeight = 680;
      container.scrollTop = 480;
      expect(controller.slide({ container, turnsClip, turns }, 40, "r0")).toBe(true);
      turns.style.transform = "";
      expect(recorder.recorded[0]?.cancelled).toBe(true);
      expect(recorder.recorded[1]?.keyframes).toEqual([
        { transform: "translateY(58px)" },
        { transform: "none" },
      ]);

      // Exceeding maxScrollTop caps at maxScrollTop (not clientHeight).
      turns.style.transform = "matrix(1, 0, 0, 1, 0, 30)";
      scrollHeight = 1_000;
      container.scrollTop = 800;
      expect(controller.slide({ container, turnsClip, turns }, 900, "r0")).toBe(true);
      turns.style.transform = "";
      expect(recorder.recorded[2]?.keyframes).toEqual([
        { transform: "translateY(800px)" },
        { transform: "none" },
      ]);

      recorder.recorded[2]?.finish();
      await flush();
      expect(controller.isSliding()).toBe(false);
      expect(turnsClip.style.overflowY).toBe("");
    } finally {
      dispose();
    }
  });

  test("clears overflowY on the captured clip node when cancelling after ref detachment and preserves visual position only on user cancel", () => {
    const recorder = installAnimationRecorder();
    const { container, turnsClip, turns, remove } = createSyntheticSlideDom({
      clientHeight: 200,
      getScrollHeight: () => 600,
      initialScrollTop: 400,
    });
    const dispose = restoreAfterTestBody(() => {
      remove();
      recorder.restore();
    });

    try {
      const controller = createTranscriptSlideController();

      // User cancel absorbs the remaining translateY into scrollTop.
      controller.slide({ container, turnsClip, turns }, 80, "r0");
      turns.style.transform = "matrix(1, 0, 0, 1, 0, 30)";
      controller.cancel({ container, turnsClip, turns }, { preserveVisualPosition: true });
      turns.style.transform = "";
      expect(recorder.recorded[0]?.cancelled).toBe(true);
      expect(turnsClip.style.overflowY).toBe("");
      expect(container.scrollTop).toBe(370);

      // Programmatic cancel with detached refs (as in <Activity mode="hidden">) still clears clip.
      container.scrollTop = 400;
      controller.slide({ container, turnsClip, turns }, 60, "r0");
      expect(turnsClip.style.overflowY).toBe("clip");
      controller.cancel({ container: null, turnsClip: null, turns: null });
      expect(recorder.recorded[1]?.cancelled).toBe(true);
      expect(turnsClip.style.overflowY).toBe("");
      expect(container.scrollTop).toBe(400);
    } finally {
      dispose();
    }
  });

  test("replaces an existing pending entry animation when a second non-overflowing row arrives", async () => {
    const recorder = installAnimationRecorder();
    let scrollHeight = 160;
    const { container, turnsClip, turns, remove } = createSyntheticSlideDom({
      clientHeight: 200,
      getScrollHeight: () => scrollHeight,
      initialScrollTop: 0,
    });
    const dispose = restoreAfterTestBody(() => {
      remove();
      recorder.restore();
    });

    try {
      const controller = createTranscriptSlideController();

      const firstAnim = turns.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
      controller.trackPendingEntry(firstAnim, container, "r0");
      const secondAnim = turns.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
      controller.trackPendingEntry(secondAnim, container, "r0");

      // Finishing the first animation does not clear the newer pending entry.
      recorder.recorded[0]?.finish();
      await flush();
      expect(controller.isActive()).toBe(true);

      // Growing past overflow while the second animation is still running promotes to a slide.
      scrollHeight = 240;
      container.scrollTop = 40;
      controller.handlePinnedResize({ container, turnsClip, turns });
      expect(controller.isSliding()).toBe(true);
      expect(recorder.recorded.at(-1)?.keyframes).toEqual([
        { transform: "translateY(40px)" },
        { transform: "none" },
      ]);
    } finally {
      dispose();
    }
  });

  test("returns null growth when the first mounted row changes on sliding-window eviction", () => {
    let scrollHeight = 1_200;
    const { container, remove } = createSyntheticSlideDom({
      clientHeight: 400,
      getScrollHeight: () => scrollHeight,
      initialScrollTop: 800,
    });
    const dispose = restoreAfterTestBody(() => {
      remove();
    });
    try {
      const controller = createTranscriptSlideController();
      controller.syncBaseline(container, "r5");

      // Unchanged firstMountedKey reports the min of scrollTop and scrollHeight growth.
      scrollHeight = 1_260;
      container.scrollTop = 860;
      expect(controller.readGrowthPx(container, "r5")).toBe(60);

      // Evicting r5 (60px) while appending a 120px row leaves scrollHeight +60px, not +120px.
      expect(controller.readGrowthPx(container, "r6")).toBeNull();
    } finally {
      dispose();
    }
  });
});

describe("useAgentChatRowEntryMotion", () => {
  test("slides tall appends at full displacement, composes mid-slide streaming growth, and ignores post-slide growth", async () => {
    const initialRows = Array.from({ length: 10 }, (_, index) =>
      createMessageRow(`r-${index}`, index % 2 === 0 ? "user" : "assistant"),
    );
    let tallHeight = 300;
    let streamHeight = 58;
    let priorHeight = 60;
    const harness = await mountMotionHarness({
      initialProps: {
        sessionKey: "session-slide-stream",
        isGrouped: false,
        rows: initialRows,
        mountedRows: initialRows,
      },
      clientHeight: 400,
      initialScrollTop: 200,
      rowHeightFor: (key) => {
        if (key === "tall") return tallHeight;
        if (key === "stream") return streamHeight;
        if (key === "r-9") return priorHeight;
        return 60;
      },
    });
    const { container, turns, turnsClip } = harness.getElements();

    try {
      // 1. Tall 300px append in a 400px viewport starts at the full 300px displacement.
      const withTall = [...initialRows, createMessageRow("tall")];
      await harness.rerender({
        sessionKey: "session-slide-stream",
        isGrouped: false,
        rows: withTall,
        mountedRows: withTall,
      });

      const tallSlide = harness.recorded.find((entry) => entry.element === turns);
      const tallRowFade = harness.recorded.find(
        (entry) => entry.element.getAttribute("data-row-key") === "tall",
      );
      expect(tallSlide?.keyframes).toEqual([
        { transform: "translateY(300px)" },
        { transform: "none" },
      ]);
      expect(tallRowFade?.keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }]);

      tallSlide?.finish();
      await act(flush);
      expect(turnsClip.style.overflowY).toBe("");
      harness.recorded.length = 0;

      // 2. Streaming reply starts a 58px slide, then grows +102px mid-slide (42px remaining -> 144px).
      const withStream = [...withTall, createMessageRow("stream", "assistant", "Paragraph one")];
      await harness.rerender({
        sessionKey: "session-slide-stream",
        isGrouped: false,
        rows: withStream,
        mountedRows: withStream,
      });
      const initialStreamSlide = harness.recorded.find((entry) => entry.element === turns);
      expect(initialStreamSlide?.keyframes).toEqual([
        { transform: "translateY(58px)" },
        { transform: "none" },
      ]);

      turns.style.transform = "matrix(1, 0, 0, 1, 0, 42)";
      harness.recorded.length = 0;
      streamHeight = 160;
      const grownStream = [...withTall, createMessageRow("stream", "assistant", "Four paragraphs")];
      await harness.rerender({
        sessionKey: "session-slide-stream",
        isGrouped: false,
        rows: grownStream,
        mountedRows: grownStream,
      });
      turns.style.transform = "";

      expect(initialStreamSlide?.cancelled).toBe(true);
      const extendedSlide = harness.recorded.find((entry) => entry.element === turns);
      expect(extendedSlide?.keyframes).toEqual([
        { transform: "translateY(144px)" },
        { transform: "none" },
      ]);

      // 3. Simultaneous prior shrink (-20px) and append (+60px) mid-slide composes the net +40px delta.
      turns.style.transform = "matrix(1, 0, 0, 1, 0, 50)";
      harness.recorded.length = 0;
      priorHeight = 40;
      const withNextUser = [...grownStream, createMessageRow("next-user", "user")];
      await harness.rerender({
        sessionKey: "session-slide-stream",
        isGrouped: false,
        rows: withNextUser,
        mountedRows: withNextUser,
      });
      turns.style.transform = "";

      expect(extendedSlide?.cancelled).toBe(true);
      const netSlide = harness.recorded.find((entry) => entry.element === turns);
      expect(netSlide?.keyframes).toEqual([
        { transform: "translateY(90px)" },
        { transform: "none" },
      ]);

      // 4. After the slide finishes, further growth on an existing row does not start a new slide.
      netSlide?.finish();
      await act(flush);
      harness.recorded.length = 0;
      tallHeight = 360;
      harness.syncScrollPosition();
      const updatedAfterSettle = [...withNextUser];
      await harness.rerender({
        sessionKey: "session-slide-stream",
        isGrouped: false,
        rows: updatedAfterSettle,
        mountedRows: updatedAfterSettle,
      });
      expect(harness.recorded.some((entry) => entry.element === turns)).toBe(false);
      expect(turnsClip.style.overflowY).toBe("");
      expect(container.scrollTop).toBe(container.scrollHeight - container.clientHeight);
    } finally {
      harness.dispose();
    }
  });

  test("measures entering row height directly when a sliding window evicts top rows", async () => {
    const allRows = Array.from({ length: 25 }, (_, index) => createMessageRow(`r-${index}`));
    const mountedInitial = allRows.slice(5);
    const harness = await mountMotionHarness({
      initialProps: {
        sessionKey: "session-eviction",
        isGrouped: false,
        rows: allRows,
        mountedRows: mountedInitial,
      },
      clientHeight: 400,
      initialScrollTop: 800,
      rowHeightFor: (key) => (key === "r-26" ? 120 : 60),
    });
    const { turns } = harness.getElements();

    try {
      // Appending r-25 (60px) while evicting r-5 (60px) leaves scrollHeight unchanged (delta = 0),
      // so the hook must measure r-25 directly to slide by 60px.
      const rows26 = [...allRows, createMessageRow("r-25")];
      await harness.rerender({
        sessionKey: "session-eviction",
        isGrouped: false,
        rows: rows26,
        mountedRows: rows26.slice(6),
      });

      const firstSlide = harness.recorded.find((entry) => entry.element === turns);
      expect(firstSlide?.keyframes).toEqual([
        { transform: "translateY(60px)" },
        { transform: "none" },
      ]);

      // Mid-slide (30px remaining), appending r-26 (120px) while evicting r-6 (60px) shifts
      // scrollHeight by only +60px; the composed slide must use the full 120px row height (150px).
      turns.style.transform = "matrix(1, 0, 0, 1, 0, 30)";
      harness.recorded.length = 0;
      const rows27 = [...rows26, createMessageRow("r-26")];
      await harness.rerender({
        sessionKey: "session-eviction",
        isGrouped: false,
        rows: rows27,
        mountedRows: rows27.slice(7),
      });
      turns.style.transform = "";

      expect(firstSlide?.cancelled).toBe(true);
      const secondSlide = harness.recorded.find((entry) => entry.element === turns);
      expect(secondSlide?.keyframes).toEqual([
        { transform: "translateY(150px)" },
        { transform: "none" },
      ]);
    } finally {
      harness.dispose();
    }
  });

  test("fades an inserted turn_duration separator in place without sliding, including across window eviction", async () => {
    const allRows = Array.from({ length: 25 }, (_, index) => createMessageRow(`r-${index}`));
    const harness = await mountMotionHarness({
      initialProps: {
        sessionKey: "session-duration",
        isGrouped: false,
        rows: allRows,
        mountedRows: allRows.slice(5),
      },
      clientHeight: 400,
      initialScrollTop: 800,
      rowHeightFor: (key) => (key.includes(":duration") ? 28 : 60),
    });
    const { turns, turnsClip } = harness.getElements();

    try {
      // Insert turn_duration right before r-24 while evicting r-5.
      const lastRow = allRows.at(-1);
      if (!lastRow) throw new Error("Expected last row");
      const withDuration = [...allRows.slice(0, -1), createDurationRow("r-24:duration"), lastRow];
      await harness.rerender({
        sessionKey: "session-duration",
        isGrouped: false,
        rows: withDuration,
        mountedRows: withDuration.slice(6),
      });

      expect(harness.recorded.some((entry) => entry.element === turns)).toBe(false);
      expect(turnsClip.style.overflowY).toBe("");
      const durationFade = harness.recorded.find(
        (entry) => entry.element.getAttribute("data-row-key") === "r-24:duration",
      );
      expect(durationFade?.keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    } finally {
      harness.dispose();
    }
  });

  test("does not animate or slide historical tool rows when isGrouped toggles off", async () => {
    const groupedRows = [
      createMessageRow("u-0", "user"),
      createMessageRow("r-1"),
      createMessageRow("r-2"),
      createMessageRow("r-3"),
      createMessageRow("r-4"),
      createMessageRow("r-5"),
      createMessageRow("tool-run-1"),
    ];
    const harness = await mountMotionHarness({
      initialProps: {
        sessionKey: "session-group-toggle",
        isGrouped: true,
        rows: groupedRows,
        mountedRows: groupedRows,
      },
      clientHeight: 200,
      initialScrollTop: 220,
      rowHeightFor: () => 60,
    });
    const { turns } = harness.getElements();

    try {
      // Ungrouping expands tool-run-1 into three individual tool rows.
      const ungroupedRows = [
        ...groupedRows.slice(0, -1),
        createMessageRow("tool-call-1"),
        createMessageRow("tool-call-2"),
        createMessageRow("tool-call-3"),
      ];
      await harness.rerender({
        sessionKey: "session-group-toggle",
        isGrouped: false,
        rows: ungroupedRows,
        mountedRows: ungroupedRows,
      });

      expect(harness.recorded).toEqual([]);

      // Subsequent genuine live appends in ungrouped mode still slide normally.
      const withLiveAnswer = [...ungroupedRows, createMessageRow("live-answer")];
      await harness.rerender({
        sessionKey: "session-group-toggle",
        isGrouped: false,
        rows: withLiveAnswer,
        mountedRows: withLiveAnswer,
      });

      expect(harness.recorded.find((entry) => entry.element === turns)?.keyframes).toEqual([
        { transform: "translateY(60px)" },
        { transform: "none" },
      ]);
    } finally {
      harness.dispose();
    }
  });

  test("cancels active slides and suppresses background animations across Activity hide and show", async () => {
    const initialRows = Array.from({ length: 8 }, (_, index) => createMessageRow(`r-${index}`));
    const harness = await mountMotionHarness({
      initialProps: {
        sessionKey: "session-activity",
        isGrouped: false,
        rows: initialRows,
        mountedRows: initialRows,
        activityMode: "visible",
      },
      clientHeight: 200,
      initialScrollTop: 280,
      rowHeightFor: () => 60,
    });
    const { turns, turnsClip } = harness.getElements();

    try {
      // Start an active slide while visible.
      const withLiveOne = [...initialRows, createMessageRow("live-1")];
      await harness.rerender({
        sessionKey: "session-activity",
        isGrouped: false,
        rows: withLiveOne,
        mountedRows: withLiveOne,
        activityMode: "visible",
      });
      const activeSlide = harness.recorded.find((entry) => entry.element === turns);
      expect(activeSlide).toBeDefined();
      expect(turnsClip.style.overflowY).toBe("clip");

      // Hiding via <Activity mode="hidden"> cancels the slide and clears overflowY.
      await harness.rerender({
        sessionKey: "session-activity",
        isGrouped: false,
        rows: withLiveOne,
        mountedRows: withLiveOne,
        activityMode: "hidden",
      });
      expect(activeSlide?.cancelled).toBe(true);
      expect(turnsClip.style.overflowY).toBe("");

      // Messages arriving while hidden must not animate when returning to visible.
      harness.recorded.length = 0;
      const withBackgroundRows = [
        ...withLiveOne,
        createMessageRow("bg-1"),
        createMessageRow("bg-2"),
      ];
      await harness.rerender({
        sessionKey: "session-activity",
        isGrouped: false,
        rows: withBackgroundRows,
        mountedRows: withBackgroundRows,
        activityMode: "visible",
      });
      expect(harness.recorded).toEqual([]);

      // Live messages after returning to visible slide normally again.
      const withLiveAfterReturn = [...withBackgroundRows, createMessageRow("live-2")];
      await harness.rerender({
        sessionKey: "session-activity",
        isGrouped: false,
        rows: withLiveAfterReturn,
        mountedRows: withLiveAfterReturn,
        activityMode: "visible",
      });
      expect(harness.recorded.find((entry) => entry.element === turns)?.keyframes).toEqual([
        { transform: "translateY(60px)" },
        { transform: "none" },
      ]);
    } finally {
      harness.dispose();
    }
  });

  test("tracks a second rapid non-overflowing append and slides when it streams past overflow", async () => {
    const initialRows = [createMessageRow("r-0", "user"), createMessageRow("r-1")];
    let secondRowHeight = 30;
    const harness = await mountMotionHarness({
      initialProps: {
        sessionKey: "session-pending-overflow",
        isGrouped: false,
        rows: initialRows,
        mountedRows: initialRows,
      },
      clientHeight: 200,
      initialScrollTop: 0,
      rowHeightFor: (key) => {
        if (key === "append-1") return 30;
        if (key === "append-2") return secondRowHeight;
        return 60;
      },
    });
    const { turns } = harness.getElements();

    try {
      // First append (150px <= 200px) enters as pending.
      const withFirst = [...initialRows, createMessageRow("append-1")];
      await harness.rerender({
        sessionKey: "session-pending-overflow",
        isGrouped: false,
        rows: withFirst,
        mountedRows: withFirst,
      });
      const firstAnim = harness.recorded.find(
        (entry) => entry.element.getAttribute("data-row-key") === "append-1",
      );
      expect(firstAnim?.keyframes).toEqual([
        { opacity: 0, transform: "translateY(6px)" },
        { opacity: 1, transform: "none" },
      ]);

      // Second rapid append (180px <= 200px) replaces pending entry tracking.
      const withSecond = [...withFirst, createMessageRow("append-2")];
      await harness.rerender({
        sessionKey: "session-pending-overflow",
        isGrouped: false,
        rows: withSecond,
        mountedRows: withSecond,
      });

      // Finishing the first row's animation does not drop tracking of append-2.
      firstAnim?.finish();
      await act(flush);
      harness.recorded.length = 0;

      // Streaming append-2 past the 200px viewport (240px -> 40px overflow) starts a 40px slide.
      secondRowHeight = 90;
      const grownSecond = [...withFirst, createMessageRow("append-2", "assistant", "Longer text")];
      await harness.rerender({
        sessionKey: "session-pending-overflow",
        isGrouped: false,
        rows: grownSecond,
        mountedRows: grownSecond,
      });

      expect(harness.recorded.find((entry) => entry.element === turns)?.keyframes).toEqual([
        { transform: "translateY(40px)" },
        { transform: "none" },
      ]);
    } finally {
      harness.dispose();
    }
  });

  test("slides open tail tool runs when callCount grows and skips all motion under reduced motion", async () => {
    const initialRows = Array.from({ length: 6 }, (_, index) => createMessageRow(`r-${index}`));
    const extraHeightPx = { current: 26 };
    const harness = await mountMotionHarness({
      initialProps: {
        sessionKey: "session-tail-run",
        isGrouped: true,
        rows: initialRows,
        mountedRows: initialRows,
        tailOpenRun: { runKey: "run-1", callCount: 1 },
      },
      clientHeight: 200,
      initialScrollTop: 186,
      rowHeightFor: () => 60,
      extraHeightPx,
    });
    const { container, turns } = harness.getElements();

    const originalMatchMedia = window.matchMedia.bind(window);
    let reducedMotion = false;
    const matchMediaSpy = spyOn(window, "matchMedia").mockImplementation((query: string) => {
      const list = originalMatchMedia(query);
      Object.defineProperty(list, "matches", {
        configurable: true,
        value: reducedMotion && query === "(prefers-reduced-motion: reduce)",
      });
      return list;
    });
    const disposeReducedMotion = restoreAfterTestBody(() => {
      matchMediaSpy.mockRestore();
    });

    try {
      // Growing the tail open run by one call (+26px) syncs scrollTop and slides 26px.
      extraHeightPx.current = 52;
      await harness.rerender({
        sessionKey: "session-tail-run",
        isGrouped: true,
        rows: initialRows,
        mountedRows: initialRows,
        tailOpenRun: { runKey: "run-1", callCount: 2 },
      });

      expect(container.scrollTop).toBe(container.scrollHeight - container.clientHeight);
      const runSlide = harness.recorded.find((entry) => entry.element === turns);
      expect(runSlide?.keyframes).toEqual([
        { transform: "translateY(26px)" },
        { transform: "none" },
      ]);

      runSlide?.finish();
      await act(flush);
      harness.recorded.length = 0;

      // With reduced motion enabled, neither tool-run growth nor new rows animate.
      reducedMotion = true;
      extraHeightPx.current = 78;
      await harness.rerender({
        sessionKey: "session-tail-run",
        isGrouped: true,
        rows: [...initialRows, createMessageRow("r-6")],
        mountedRows: [...initialRows, createMessageRow("r-6")],
        tailOpenRun: { runKey: "run-1", callCount: 3 },
      });

      expect(harness.recorded).toEqual([]);
    } finally {
      disposeReducedMotion();
      harness.dispose();
    }
  });

  test("slides same-commit id swap plus append, fades non-tail inserts without sliding, ignores history prepends, and slides idle tail-row growth", async () => {
    const initialRows = Array.from({ length: 8 }, (_, index) => createMessageRow(`r-${index}`));
    let toolHeight = 28;
    const harness = await mountMotionHarness({
      initialProps: {
        sessionKey: "session-live-variants",
        isGrouped: false,
        rows: initialRows,
        mountedRows: initialRows,
      },
      clientHeight: 300,
      initialScrollTop: 180,
      rowHeightFor: (key) => {
        if (key === "tool-after" || key === "tool-earlier") return toolHeight;
        return 60;
      },
    });
    const { container, turns } = harness.getElements();

    try {
      // 1. Replacing the last row's id while appending a new tool row slides smoothly and fades only the new row.
      const swappedAndAppended = [
        ...initialRows.slice(0, -1),
        createMessageRow("r-7:part-1"),
        createMessageRow("tool-after"),
      ];
      await harness.rerender({
        sessionKey: "session-live-variants",
        isGrouped: false,
        rows: swappedAndAppended,
        mountedRows: swappedAndAppended,
      });

      const swapSlide = harness.recorded.find((entry) => entry.element === turns);
      expect(swapSlide?.keyframes).toEqual([
        { transform: "translateY(28px)" },
        { transform: "none" },
      ]);
      expect(
        harness.recorded
          .filter((entry) => entry.element !== turns)
          .map((entry) => entry.element.getAttribute("data-row-key")),
      ).toEqual(["tool-after"]);

      swapSlide?.finish();
      await act(flush);
      harness.recorded.length = 0;

      // 2. Tail row growing after the slide finished (e.g., completed file_edit diff card) slides smoothly.
      toolHeight = 108;
      const expandedTail = [
        ...swappedAndAppended.slice(0, -1),
        createMessageRow("tool-after", "assistant", "diff"),
      ];
      await harness.rerender({
        sessionKey: "session-live-variants",
        isGrouped: false,
        rows: expandedTail,
        mountedRows: expandedTail,
      });

      const tailGrowthSlide = harness.recorded.find((entry) => entry.element === turns);
      expect(tailGrowthSlide?.keyframes).toEqual([
        { transform: "translateY(80px)" },
        { transform: "none" },
      ]);
      expect(container.scrollTop).toBe(container.scrollHeight - container.clientHeight);

      tailGrowthSlide?.finish();
      await act(flush);
      harness.recorded.length = 0;

      // 3. A timestamp-ordered tool inserted before the tail fades in place without bouncing the tail row.
      toolHeight = 28;
      const insertedBeforeTail = [
        ...expandedTail.slice(0, -1),
        createMessageRow("tool-earlier"),
        expandedTail.at(-1)!,
      ];
      await harness.rerender({
        sessionKey: "session-live-variants",
        isGrouped: false,
        rows: insertedBeforeTail,
        mountedRows: insertedBeforeTail,
      });

      expect(harness.recorded.some((entry) => entry.element === turns)).toBe(false);
      expect(
        harness.recorded.find(
          (entry) => entry.element.getAttribute("data-row-key") === "tool-earlier",
        )?.keyframes,
      ).toEqual([{ opacity: 0 }, { opacity: 1 }]);

      harness.recorded.length = 0;

      // 4. History prepended before the first known row never animates or slides.
      const withPrependedHistory = [createMessageRow("older-0"), ...insertedBeforeTail];
      await harness.rerender({
        sessionKey: "session-live-variants",
        isGrouped: false,
        rows: withPrependedHistory,
        mountedRows: withPrependedHistory,
      });

      expect(harness.recorded).toEqual([]);
    } finally {
      harness.dispose();
    }
  });

  test("handles first-row optimistic id confirmation plus append while rejecting single-row history prepends and full reloads", async () => {
    const initialRows = [createMessageRow("optimistic-u1", "user")];
    const harness = await mountMotionHarness({
      initialProps: {
        sessionKey: "session-first-row-swap",
        isGrouped: false,
        rows: initialRows,
        mountedRows: initialRows,
      },
      clientHeight: 100,
      initialScrollTop: 0,
      rowHeightFor: () => 80,
    });
    const { turns } = harness.getElements();

    try {
      // Confirming the sole optimistic user row while appending an overflowing reply slides the reply.
      const confirmedWithReply = [
        createMessageRow("confirmed-u1", "user"),
        createMessageRow("reply-1"),
      ];
      await harness.rerender({
        sessionKey: "session-first-row-swap",
        isGrouped: false,
        rows: confirmedWithReply,
        mountedRows: confirmedWithReply,
      });

      const replySlide = harness.recorded.find((entry) => entry.element === turns);
      expect(replySlide?.keyframes).toEqual([
        { transform: "translateY(60px)" },
        { transform: "none" },
      ]);
      expect(
        harness.recorded
          .filter((entry) => entry.element !== turns)
          .map((entry) => entry.element.getAttribute("data-row-key")),
      ).toEqual(["reply-1"]);

      replySlide?.finish();
      await act(flush);
      harness.recorded.length = 0;

      // Full transcript replacement with no surviving prior rows does not animate.
      const replacedTranscript = [
        createMessageRow("other-1", "user"),
        createMessageRow("other-2"),
        createMessageRow("other-3"),
      ];
      await harness.rerender({
        sessionKey: "session-first-row-swap",
        isGrouped: false,
        rows: replacedTranscript,
        mountedRows: replacedTranscript,
      });
      expect(harness.recorded).toEqual([]);
    } finally {
      harness.dispose();
    }

    // Genuine history prepend above a single known row still produces no animation.
    const prependHarness = await mountMotionHarness({
      initialProps: {
        sessionKey: "session-single-prepend",
        isGrouped: false,
        rows: [createMessageRow("u-1", "user")],
        mountedRows: [createMessageRow("u-1", "user")],
      },
      clientHeight: 100,
      initialScrollTop: 0,
      rowHeightFor: () => 80,
    });
    try {
      const prepended = [createMessageRow("h-0", "user"), createMessageRow("u-1", "user")];
      await prependHarness.rerender({
        sessionKey: "session-single-prepend",
        isGrouped: false,
        rows: prepended,
        mountedRows: prepended,
      });
      expect(prependHarness.recorded).toEqual([]);
    } finally {
      prependHarness.dispose();
    }
  });

  test("slides tail footer growth and rows above an inserted turn_duration separator across window eviction", async () => {
    const allRows = Array.from({ length: 21 }, (_, index) => createMessageRow(`r-${index}`));
    let lastRowHeight = 100;
    const harness = await mountMotionHarness({
      initialProps: {
        sessionKey: "session-duration-tail-growth",
        isGrouped: false,
        rows: allRows,
        mountedRows: allRows.slice(1),
      },
      clientHeight: 400,
      initialScrollTop: 500,
      rowHeightFor: (key) => {
        if (key === "r-20:duration") return 56;
        if (key === "r-20") return lastRowHeight;
        return 40;
      },
    });
    const { container, turns, turnsClip } = harness.getElements();

    try {
      // Turn ends: r-20:duration (+56px) inserts before r-20, r-20 adds its footer (+24px),
      // and r-1 evicts from the 20-row window in the same commit.
      lastRowHeight = 124;
      const updatedTail = createMessageRow("r-20", "assistant", "Final answer with footer");
      const withDuration = [
        ...allRows.slice(0, -1),
        createDurationRow("r-20:duration"),
        updatedTail,
      ];
      await harness.rerender({
        sessionKey: "session-duration-tail-growth",
        isGrouped: false,
        rows: withDuration,
        mountedRows: withDuration.slice(2),
      });

      const turnsSlide = harness.recorded.find((entry) => entry.element === turns);
      expect(turnsSlide?.keyframes).toEqual([
        { transform: "translateY(24px)" },
        { transform: "none" },
      ]);
      const aboveRowSlide = harness.recorded.find(
        (entry) => entry.element.getAttribute("data-row-key") === "r-19",
      );
      expect(aboveRowSlide?.keyframes).toEqual([
        { transform: "translateY(56px)" },
        { transform: "none" },
      ]);
      const durationFade = harness.recorded.find(
        (entry) => entry.element.getAttribute("data-row-key") === "r-20:duration",
      );
      expect(durationFade?.keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }]);
      expect(
        harness.recorded.some((entry) => entry.element.getAttribute("data-row-key") === "r-20"),
      ).toBe(false);

      // Cancelling (e.g. user scroll up) cancels both the turns slide and above-row slides.
      harness.slideController.cancel({ container, turnsClip, turns });
      expect(turnsSlide?.cancelled).toBe(true);
      expect(aboveRowSlide?.cancelled).toBe(true);
    } finally {
      harness.dispose();
    }
  });
});
