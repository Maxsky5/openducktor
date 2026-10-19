import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createAnimationFrameTestDriver } from "@/test-utils/animation-frame-test-driver";
import { buildMessage } from "../agent-chat-test-fixtures";
import type { AgentChatUserMessageAnchor } from "../agent-chat-transcript-model";
import type {
  AgentChatTranscriptNavigation,
  AgentChatTranscriptViewportRows,
} from "../use-agent-chat-transcript-navigation";
import { MINIMAP_TICK_SPACING_PX } from "./constants";
import { ConversationMinimap } from "./conversation-minimap";

const animationFrameDriver = createAnimationFrameTestDriver();
const originalResizeObserver = globalThis.ResizeObserver;
const resizeCallbacks = new Map<Element, () => void>();

class MockResizeObserver implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element): void {
    resizeCallbacks.set(target, () => this.callback([], this));
  }

  unobserve(target: Element): void {
    resizeCallbacks.delete(target);
  }

  disconnect(): void {
    resizeCallbacks.clear();
  }
}

// Each user message starts a section of two rows.
const buildAnchors = (count: number): AgentChatUserMessageAnchor[] =>
  Array.from({ length: count }, (_, index) => ({
    rowKey: `row-${index * 2}`,
    rowIndex: index * 2,
    message: buildMessage("user", `Question ${index + 1}\nMore detail`, { id: `user-${index}` }),
  }));

const createNavigation = (initialRows: AgentChatTranscriptViewportRows | null) => {
  let viewportRows = initialRows;
  const listeners = new Set<() => void>();
  const navigation = {
    jumpToRow: mock((_rowKey: string) => {}),
    readViewportRows: () => viewportRows,
    subscribeViewportRows: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    scrollByWheel: mock((_event: WheelEvent) => {}),
  } satisfies AgentChatTranscriptNavigation;
  const scrollTo = (next: AgentChatTranscriptViewportRows) => {
    viewportRows = next;
    for (const listener of listeners) listener();
  };
  return { navigation, scrollTo };
};

const renderMinimap = (
  anchors: AgentChatUserMessageAnchor[],
  navigation: AgentChatTranscriptNavigation,
  railMaxHeight = 400,
) => {
  render(
    <ConversationMinimap
      anchors={anchors}
      navigation={navigation}
      railMaxHeight={railMaxHeight}
      frame={document.body}
    />,
  );
  return screen.getByRole("listbox", { name: "User messages" });
};

const readTickStates = (rail: HTMLElement): Array<string | null> =>
  Array.from(rail.querySelectorAll(".conversation-minimap-tick")).map((tick) =>
    tick.getAttribute("data-state"),
  );

const readFocusedOption = (rail: HTMLElement): string | null | undefined => {
  const id = rail.getAttribute("aria-activedescendant");
  return id ? document.getElementById(id)?.textContent : null;
};

const readCard = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('[data-slot="popover-content"]');

const getCard = (): HTMLElement => {
  const card = readCard();
  if (!card) throw new Error("Expected the preview card");
  return card;
};

// The rail starts at the top of the page in happy-dom, so a tick center is its index times the spacing.
const tickCenterY = (tick: number, spacing = MINIMAP_TICK_SPACING_PX): number =>
  (tick + 0.5) * spacing;

beforeEach(() => {
  animationFrameDriver.install();
  globalThis.ResizeObserver = MockResizeObserver;
});

afterEach(() => {
  cleanup();
  animationFrameDriver.restore();
  globalThis.ResizeObserver = originalResizeObserver;
  resizeCallbacks.clear();
});

describe("ConversationMinimap", () => {
  test("names each message and marks the active and visible ticks", () => {
    const { navigation } = createNavigation({
      activeRow: 3,
      firstVisibleRow: 2,
      lastVisibleRow: 5,
    });
    const rail = renderMinimap(buildAnchors(4), navigation);

    const options = screen.getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "Message 1 of 4: Question 1",
      "Message 2 of 4: Question 2",
      "Message 3 of 4: Question 3",
      "Message 4 of 4: Question 4",
    ]);
    expect(options[1]?.getAttribute("aria-current")).toBe("location");
    expect(readTickStates(rail)).toEqual(["rest", "active", "visible", "rest"]);
  });

  test("follows the transcript viewport once per frame", async () => {
    const { navigation, scrollTo } = createNavigation({
      activeRow: 0,
      firstVisibleRow: 0,
      lastVisibleRow: 1,
    });
    const rail = renderMinimap(buildAnchors(3), navigation);

    scrollTo({ activeRow: 4, firstVisibleRow: 4, lastVisibleRow: 5 });
    expect(readTickStates(rail)).toEqual(["active", "rest", "rest"]);
    await animationFrameDriver.flushFrames();

    expect(readTickStates(rail)).toEqual(["rest", "rest", "active"]);
  });

  test("moves keyboard focus between messages and jumps with Enter", () => {
    const { navigation } = createNavigation({
      activeRow: 2,
      firstVisibleRow: 2,
      lastVisibleRow: 3,
    });
    const rail = renderMinimap(buildAnchors(4), navigation);

    act(() => rail.focus());
    expect(readFocusedOption(rail)).toBe("Message 2 of 4: Question 2");
    fireEvent.keyDown(rail, { key: "ArrowDown" });
    expect(readFocusedOption(rail)).toBe("Message 3 of 4: Question 3");
    fireEvent.keyDown(rail, { key: "End" });
    expect(readFocusedOption(rail)).toBe("Message 4 of 4: Question 4");
    fireEvent.keyDown(rail, { key: "ArrowRight" });
    expect(readFocusedOption(rail)).toBe("Message 4 of 4: Question 4");
    fireEvent.keyDown(rail, { key: "Home" });
    expect(readFocusedOption(rail)).toBe("Message 1 of 4: Question 1");
    fireEvent.keyDown(rail, { key: "ArrowUp" });
    expect(readFocusedOption(rail)).toBe("Message 1 of 4: Question 1");

    fireEvent.keyDown(rail, { key: "ArrowDown" });
    expect(fireEvent.keyDown(rail, { key: "Enter" })).toBe(false);

    expect(navigation.jumpToRow).toHaveBeenCalledWith("row-2");
    expect(document.activeElement).toBe(rail);
    act(() => rail.blur());
    expect(rail.getAttribute("aria-activedescendant")).toBeNull();
  });

  test("keeps keyboard focus on its message when older messages load above it", () => {
    const { navigation } = createNavigation(null);
    const anchors = buildAnchors(3);
    const view = render(
      <ConversationMinimap
        anchors={anchors}
        navigation={navigation}
        railMaxHeight={400}
        frame={document.body}
      />,
    );
    const rail = screen.getByRole("listbox", { name: "User messages" });
    act(() => rail.focus());
    fireEvent.keyDown(rail, { key: "End" });
    expect(readFocusedOption(rail)).toBe("Message 3 of 3: Question 3");

    const older = buildMessage("user", "Older question", { id: "older" });
    view.rerender(
      <ConversationMinimap
        anchors={[{ rowKey: "older-row", rowIndex: 0, message: older }, ...anchors]}
        navigation={navigation}
        railMaxHeight={400}
        frame={document.body}
      />,
    );

    expect(readFocusedOption(rail)).toBe("Message 4 of 4: Question 3");
  });

  test("leaves other keys and focus to the page", () => {
    const { navigation } = createNavigation(null);
    const rail = renderMinimap(buildAnchors(2), navigation);

    act(() => rail.focus());
    expect(fireEvent.keyDown(rail, { key: "Tab" })).toBe(true);
    expect(fireEvent.mouseDown(rail)).toBe(false);
  });

  test("jumps to the clicked message, or to the first message of a group", () => {
    const { navigation } = createNavigation(null);
    const rail = renderMinimap(buildAnchors(3), navigation);

    fireEvent.click(rail, { clientY: tickCenterY(2) });
    expect(navigation.jumpToRow).toHaveBeenLastCalledWith("row-4");
    cleanup();

    // Ten messages in a 30px rail share five ticks of 6px, two messages each.
    const grouped = renderMinimap(buildAnchors(10), navigation, 30);
    expect(readTickStates(grouped)).toHaveLength(5);
    fireEvent.click(grouped, { clientY: tickCenterY(1, 6) });
    expect(navigation.jumpToRow).toHaveBeenLastCalledWith("row-4");
  });

  test("previews the message under the pointer and jumps from the card", () => {
    const { navigation } = createNavigation(null);
    const rail = renderMinimap(buildAnchors(3), navigation);

    fireEvent.pointerEnter(rail, { clientY: tickCenterY(1) });
    expect(getCard().textContent).toBe("Question 2\nMore detail");
    // Chips in the card take no click or focus, so a click on the card always jumps.
    expect(
      within(getCard())
        .getByText(/Question 2/)
        .closest("[inert]"),
    ).not.toBeNull();
    fireEvent.pointerMove(rail, { clientY: tickCenterY(2) });
    expect(getCard().textContent).toBe("Question 3\nMore detail");

    // No button wraps the message, because a chip in it can be a button.
    expect(getCard().querySelector("button [inert]")).toBeNull();
    fireEvent.click(
      within(getCard()).getByRole("button", { hidden: true, name: "Jump to message" }),
    );
    expect(navigation.jumpToRow).toHaveBeenLastCalledWith("row-4");
  });

  test("fades a long message when the card caps its height after it opens", () => {
    const { navigation } = createNavigation(null);
    const rail = renderMinimap(buildAnchors(2), navigation);

    fireEvent.pointerEnter(rail, { clientY: tickCenterY(0) });
    const body = getCard().querySelector<HTMLElement>("[inert]");
    if (!body) throw new Error("Expected the preview body");
    expect(body.className).not.toContain("mask-b-from");

    // Radix sets the available height after it places the card, so the body gets smaller later.
    Object.defineProperty(body, "scrollHeight", { configurable: true, value: 1080 });
    Object.defineProperty(body, "clientHeight", { configurable: true, value: 144 });
    act(() => resizeCallbacks.get(body)?.());

    expect(body.className).toContain("mask-b-from");
  });

  test("lists the messages of a group tick and jumps to a row", () => {
    const { navigation } = createNavigation(null);
    const rail = renderMinimap(buildAnchors(10), navigation, 30);

    fireEvent.pointerEnter(rail, { clientY: tickCenterY(2, 6) });
    const rows = within(getCard()).getAllByRole("listitem", { hidden: true });
    expect(rows.map((row) => row.textContent)).toEqual([
      "Question 5\nMore detail",
      "Question 6\nMore detail",
    ]);
    const rowButtons = within(getCard()).getAllByRole("button", {
      hidden: true,
      name: "Jump to message",
    });
    const secondRow = rowButtons[1];
    if (!secondRow) throw new Error("Expected two rows in the group card");
    fireEvent.click(secondRow);

    expect(navigation.jumpToRow).toHaveBeenLastCalledWith("row-10");
  });

  test("closes the card shortly after the pointer leaves", async () => {
    const { navigation } = createNavigation(null);
    const rail = renderMinimap(buildAnchors(2), navigation);

    fireEvent.pointerEnter(rail, { clientY: tickCenterY(0) });
    expect(readCard()).not.toBeNull();
    fireEvent.pointerLeave(rail);
    expect(readCard()).not.toBeNull();
    await act(() => new Promise((resolve) => setTimeout(resolve, 200)));

    expect(readCard()?.getAttribute("data-state") ?? "closed").toBe("closed");
  });

  test("keeps the message on the card while the card closes", async () => {
    const nativeGetComputedStyle = globalThis.getComputedStyle;
    // The card has an exit animation, as popover.css gives it.
    const computedStyle = spyOn(globalThis, "getComputedStyle").mockImplementation((element) => {
      const style = nativeGetComputedStyle(element);
      if (element.getAttribute("data-slot") !== "popover-content") return style;
      return Object.create(style, {
        animationName: {
          get: () => (element.getAttribute("data-state") === "open" ? "popover-in" : "popover-out"),
        },
        getPropertyValue: { value: style.getPropertyValue.bind(style) },
      });
    });
    try {
      const { navigation } = createNavigation(null);
      const rail = renderMinimap(buildAnchors(2), navigation);

      fireEvent.pointerEnter(rail, { clientY: tickCenterY(1) });
      fireEvent.pointerLeave(rail);
      await act(() => new Promise((resolve) => setTimeout(resolve, 200)));

      expect(getCard().getAttribute("data-state")).toBe("closed");
      expect(getCard().textContent).toBe("Question 2\nMore detail");
    } finally {
      computedStyle.mockRestore();
    }
  });

  test("opens each group list at its top", () => {
    const { navigation } = createNavigation(null);
    const rail = renderMinimap(buildAnchors(10), navigation, 30);

    fireEvent.pointerEnter(rail, { clientY: tickCenterY(1, 6) });
    within(getCard()).getByRole("list", { hidden: true }).scrollTop = 40;
    fireEvent.pointerMove(rail, { clientY: tickCenterY(2, 6) });

    expect(within(getCard()).getByRole("list", { hidden: true }).scrollTop).toBe(0);
  });

  test("paints every tick row again when the messages regroup", () => {
    const { navigation } = createNavigation(null);
    const renderRail = (count: number) => (
      <ConversationMinimap
        anchors={buildAnchors(count)}
        navigation={navigation}
        railMaxHeight={30}
        frame={document.body}
      />
    );
    const view = render(renderRail(10));

    // Thirteen messages keep five ticks, but three groups start at another message.
    view.rerender(renderRail(13));

    const rail = screen.getByRole("listbox", { name: "User messages" });
    const tickRows = Array.from(rail.querySelectorAll<HTMLElement>(".conversation-minimap-tick"))
      .map((tick) => tick.parentElement)
      .filter((row) => row !== null);
    expect(tickRows).toHaveLength(5);
    expect(tickRows.map((row) => row.style.getPropertyValue("--tick-growth"))).toEqual(
      Array(5).fill("0"),
    );
  });

  test("forwards wheel input to the transcript", () => {
    const { navigation } = createNavigation(null);
    const rail = renderMinimap(buildAnchors(2), navigation);

    fireEvent.wheel(rail, { deltaY: -40 });

    expect(navigation.scrollByWheel.mock.calls[0]?.[0].deltaY).toBe(-40);
  });
});
