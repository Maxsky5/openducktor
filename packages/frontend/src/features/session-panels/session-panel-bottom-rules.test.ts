import { describe, expect, test } from "bun:test";
import type { TerminalSummary } from "@openducktor/contracts";
import type { TerminalTab } from "@openducktor/frontend-core/terminals/terminal-presentation-state";
import {
  browserTabIdFixture,
  createBrowserTabSummaryFixture,
} from "@/test-utils/session-panel-fixtures";
import {
  type BottomPanelCheck,
  type BottomPanelFacts,
  type BottomPanelState,
  bottomStateAfterChoice,
  decideBottomPanel,
  isBottomPanelShown,
  NO_BOTTOM_CHECK,
} from "./session-panel-bottom-rules";
import { browserTabEntry, type ResolvedPanelTab } from "./session-panel-layout";

const terminal = (startedBy: TerminalSummary["startedBy"]): ResolvedPanelTab => {
  const summary: TerminalSummary = {
    terminalId: "terminal-1",
    label: "Shell",
    context: { workspaceId: "repo", repoPath: "/repo", taskId: "task-1" },
    initialWorkingDir: "/repo",
    createdAt: "2026-10-09T00:00:00.000Z",
    lifecycle: "running",
    exit: null,
    startedBy,
  };
  const tab: TerminalTab = {
    tabId: "tab:terminal-1",
    terminalId: "terminal-1",
    summary,
    awaitingLifecycleSync: false,
    error: null,
    requestState: "ready",
  };
  return { id: "terminal:tab:terminal-1", kind: "terminal", terminal: tab };
};

const TAB_ID = browserTabIdFixture(1);
/** A saved browser entry that the browser list has, or still waits for. */
const browser = (listed: boolean): ResolvedPanelTab => {
  const entry = browserTabEntry(TAB_ID);
  return {
    id: entry.id,
    kind: "browser",
    entry,
    tab: listed ? createBrowserTabSummaryFixture({ tabId: TAB_ID }) : null,
  };
};

const USER_TERMINAL = terminal("user");
const HOST_TERMINAL = terminal("host");

const facts = (overrides: Partial<BottomPanelFacts> = {}): BottomPanelFacts => ({
  tabs: [],
  closingTabs: [],
  terminalList: "synced",
  ...overrides,
});

const OPEN_WITH_ONE_TAB: BottomPanelCheck = { tabCount: 1, wasOpen: true };

/** Applies the rules to each render in order, as the shown view does with the store. */
const replay = (
  start: BottomPanelState,
  renders: BottomPanelFacts[],
  startCheck: BottomPanelCheck = NO_BOTTOM_CHECK,
) => {
  let state = start;
  let check = startCheck;
  return renders.map((render) => {
    const decision = decideBottomPanel(state, check, render);
    state = decision.state;
    check = decision.check;
    return decision;
  });
};

describe("isBottomPanelShown", () => {
  test.each([
    ["default", facts({ tabs: [USER_TERMINAL] }), true],
    ["default", facts({ tabs: [browser(true)] }), true],
    ["default", facts({ tabs: [HOST_TERMINAL] }), false],
    ["closed", facts({ tabs: [USER_TERMINAL] }), false],
    ["open", facts(), true],
    ["open", facts({ closingTabs: [USER_TERMINAL] }), false],
    ["open_while_closing", facts({ closingTabs: [USER_TERMINAL] }), true],
    ["restoring", facts(), false],
    ["restoring", facts({ tabs: [USER_TERMINAL] }), true],
  ] as const)("%s with %o shows %p", (state, render, shown) => {
    expect(isBottomPanelShown(state, render)).toBe(shown);
  });
});

describe("bottomStateAfterChoice", () => {
  test.each([
    [true, facts({ closingTabs: [USER_TERMINAL] }), "open_while_closing"],
    [true, facts({ tabs: [USER_TERMINAL] }), "open"],
    [false, facts({ closingTabs: [USER_TERMINAL] }), "closed"],
  ] as const)("an open %p with %o gives %s", (isOpen, render, state) => {
    expect(bottomStateAfterChoice(isOpen, render)).toBe(state);
  });
});

describe("decideBottomPanel restore", () => {
  test.each([
    ["a confirmed tab", facts({ tabs: [USER_TERMINAL] }), true, "open"],
    ["a failed terminal list", facts({ terminalList: "failed" }), true, "open"],
    ["a loading terminal list", facts({ terminalList: "loading" }), false, "restoring"],
    [
      "a browser entry that waits for its list",
      facts({ tabs: [browser(false)] }),
      false,
      "restoring",
    ],
    ["a closing last tab", facts({ closingTabs: [USER_TERMINAL] }), false, "restoring"],
    ["a synced list without tabs", facts(), false, "closed"],
  ] as const)("with %s", (_name, render, isShown, state) => {
    const decision = decideBottomPanel("restoring", NO_BOTTOM_CHECK, render);
    expect(decision.isShown).toBe(isShown);
    expect(decision.state).toBe(state);
  });
});

describe("decideBottomPanel lost last tab", () => {
  test("closes an open panel that loses its last tab", () => {
    const [, lost] = replay("open", [facts({ tabs: [USER_TERMINAL] }), facts()]);
    expect(lost).toMatchObject({ isShown: false, hides: true, state: "closed" });
  });

  test("keeps the default rule when a closed panel loses its last tab", () => {
    const [, lost] = replay("default", [facts({ tabs: [HOST_TERMINAL] }), facts()]);
    expect(lost).toMatchObject({ hides: false, state: "default" });
  });

  test("closes the panel only when a closing last tab leaves", () => {
    const decisions = replay("open", [
      facts({ tabs: [USER_TERMINAL] }),
      facts({ closingTabs: [USER_TERMINAL] }),
      facts(),
    ]);
    expect(decisions.map((decision) => [decision.isShown, decision.state])).toEqual([
      [true, "open"],
      [false, "open"],
      [false, "closed"],
    ]);
  });

  test("closes a default panel when its last tab leaves after the close", () => {
    const [, closing, left] = replay("default", [
      facts({ tabs: [browser(true)] }),
      facts({ closingTabs: [browser(true)] }),
      facts(),
    ]);
    expect(closing?.hides).toBe(false);
    expect(left?.state).toBe("closed");
  });

  test("keeps a panel open that the user opened during the close", () => {
    const [during, left] = replay(
      "open_while_closing",
      [facts({ closingTabs: [USER_TERMINAL] }), facts()],
      OPEN_WITH_ONE_TAB,
    );
    expect(during?.isShown).toBe(true);
    expect(left).toMatchObject({ isShown: true, hides: false, state: "open_while_closing" });
  });

  test("ends an open during a close when a tab shows", () => {
    const decision = decideBottomPanel(
      "open_while_closing",
      OPEN_WITH_ONE_TAB,
      facts({ tabs: [USER_TERMINAL] }),
    );
    expect(decision.state).toBe("open");
  });

  test.each(["loading", "other_owner"] as const)(
    "does not count the tabs of a %s terminal list",
    (terminalList) => {
      const decision = decideBottomPanel("open", OPEN_WITH_ONE_TAB, facts({ terminalList }));
      expect(decision).toMatchObject({ isShown: true, hides: false, state: "open" });
      expect(decision.check).toBe(OPEN_WITH_ONE_TAB);
    },
  );

  test("returns the same check when nothing changes", () => {
    const decision = decideBottomPanel("open", OPEN_WITH_ONE_TAB, facts({ tabs: [USER_TERMINAL] }));
    expect(decision.check).toBe(OPEN_WITH_ONE_TAB);
  });
});
