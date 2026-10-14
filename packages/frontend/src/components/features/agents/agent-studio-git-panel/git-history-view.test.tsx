import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type {
  GitHistoryCommit,
  GitHistoryPage,
  GitHistoryPageRequest,
} from "@openducktor/contracts";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  waitForElementToBeRemoved,
  within,
} from "@testing-library/react";
import { createQueryClient } from "@/lib/query-client";
import { QueryProvider } from "@/lib/query-provider";
import { configureShellBridge, createUnavailableShellBridge } from "@/lib/shell-bridge";
import { refreshGitHistoryQueries } from "@/state/queries/git";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import { TooltipProvider } from "@/components/ui/tooltip";
import { HISTORY_COLUMNS_STORAGE_KEY, useHistoryColumnsStore } from "./git-history-columns";
import { GitHistoryView, type GitHistoryViewProps } from "./git-history-view";

const oid = (name: string) => name.padEnd(40, "0");
const CURRENT = oid("c2");
const TARGET = oid("t1");
const BASE = oid("b0");

const commit = (
  name: string,
  parents: string[],
  membership: GitHistoryCommit["membership"],
): GitHistoryCommit => ({
  oid: oid(name),
  parentOids: parents.map(oid),
  outsideParentOids: [],
  membership,
  subject: `Subject ${name}`,
  message: `Subject ${name}\n\nBody of ${name}.`,
  authorName: "Ada Lovelace",
  authorEmail: "ada@example.invalid",
  refs: [],
  authorDate: "2026-10-13T14:05:22+02:00",
});

const firstPage: GitHistoryPage = {
  outcome: "page",
  comparison: {
    currentTip: CURRENT,
    targetTip: TARGET,
    boundaryOids: [BASE],
    aheadBehind: { ahead: 2, behind: 1 },
  },
  commits: [
    {
      ...commit("c2", ["c1"], "current"),
      refs: [{ name: "feature", kind: "local", isHead: true }],
    },
    {
      ...commit("t1", ["b0"], "target"),
      refs: [{ name: "origin/main", kind: "remote", isHead: false }],
    },
  ],
  nextOffset: 2,
};

const historyPage = mock(
  async (_request: GitHistoryPageRequest): Promise<GitHistoryPage> => firstPage,
);

const props = (overrides: Partial<GitHistoryViewProps> = {}): GitHistoryViewProps => ({
  repoPath: "/repo",
  workingDir: "/repo",
  checkout: { name: "feature", detached: false, revision: CURRENT },
  targetReference: "refs/remotes/origin/main",
  targetLabel: "origin/main",
  comparisonUnavailableReason: null,
  ...overrides,
});

// The Git panel gives History its tooltip provider.
const renderHistory = (overrides: Partial<GitHistoryViewProps> = {}) =>
  render(
    <QueryProvider useIsolatedClient>
      <TooltipProvider>
        <div style={{ height: 600 }}>
          <GitHistoryView {...props(overrides)} />
        </div>
      </TooltipProvider>
    </QueryProvider>,
  );

beforeEach(() => {
  globalThis.localStorage.removeItem(HISTORY_COLUMNS_STORAGE_KEY);
  useHistoryColumnsStore.getState().reset();
  historyPage.mockReset();
  historyPage.mockImplementation(async () => firstPage);
  configureShellBridge(createShellBridgeFixture({ client: { gitGetHistoryPage: historyPage } }));
});

afterEach(() => {
  cleanup();
  configureShellBridge(createUnavailableShellBridge());
});

describe("GitHistoryView", () => {
  test("shows each commit with its branches, body preview, author photo, and age", async () => {
    historyPage.mockImplementation(async () => ({ ...firstPage, nextOffset: null }));
    renderHistory();

    expect(await screen.findByText("Subject c2")).toBeTruthy();
    expect(screen.getByText("Subject t1")).toBeTruthy();
    expect(screen.getByText("Body of c2.")).toBeTruthy();
    expect(
      screen.getAllByTestId("agent-studio-git-history-markers").map((marker) => marker.textContent),
    ).toEqual(["featurefeature (checked out)", "mainorigin/main (target)"]);
    // The author column starts hidden, and each node shows the author.
    expect(screen.queryByTestId("agent-studio-git-history-author")).toBeNull();
    expect(screen.getAllByTestId("agent-studio-git-history-avatar")).toHaveLength(2);
    const ages = screen.getAllByTitle("Ada Lovelace, 2026-10-13 14:05:22 +02:00");
    expect(ages.map((age) => age.getAttribute("datetime"))).toEqual([
      "2026-10-13T14:05:22+02:00",
      "2026-10-13T14:05:22+02:00",
    ]);
    expect(historyPage.mock.calls[0]?.[0]).toEqual({
      repoPath: "/repo",
      workingDir: "/repo",
      targetReference: "refs/remotes/origin/main",
      expectedBranch: { name: "feature", detached: false, revision: CURRENT },
    });
  });

  test("stacks the other branches and tags of a commit and lists them all on hover", async () => {
    historyPage.mockImplementation(async () => ({
      outcome: "page",
      comparison: {
        currentTip: CURRENT,
        targetTip: CURRENT,
        boundaryOids: [CURRENT],
        aheadBehind: { ahead: 0, behind: 0 },
      },
      commits: [
        {
          ...commit("c2", ["c1"], "boundary"),
          refs: [
            { name: "feature", kind: "local", isHead: true },
            { name: "main", kind: "local", isHead: false },
            { name: "origin/feature", kind: "remote", isHead: false },
            { name: "origin/main", kind: "remote", isHead: false },
            { name: "release", kind: "local", isHead: false },
            { name: "v1.0.0", kind: "tag", isHead: false },
            { name: "v1.0.1", kind: "tag", isHead: false },
          ],
        },
      ],
      nextOffset: null,
    }));
    renderHistory({ targetLabel: "origin/main" });

    expect(await screen.findByText("Subject c2")).toBeTruthy();
    const markers = screen.getByTestId("agent-studio-git-history-markers");
    // The checked-out branch shows its name. Its remote branch shares the same entry.
    expect(markers.querySelector(".truncate")?.textContent).toBe("feature");
    const stack = within(markers).getByTestId("agent-studio-git-history-ref-stack");
    // Two extra refs stack as icons, and the rest show as a count.
    expect(stack.children).toHaveLength(3);
    expect(stack.textContent).toBe("+2");
    expect(markers.textContent).toContain(
      "feature, origin/feature (checked out); main, origin/main (target); release; v1.0.0; v1.0.1",
    );
  });

  test("shows the initials when the author photo does not load", async () => {
    historyPage.mockImplementation(async () => ({ ...firstPage, nextOffset: null }));
    renderHistory();

    await screen.findByText("Subject c2");
    const [avatar] = screen.getAllByTestId("agent-studio-git-history-avatar");
    const photo = await waitFor(() => {
      const image = avatar?.querySelector("img");
      if (!image) throw new Error("The photo has not loaded its address yet.");
      return image;
    });
    expect(photo.getAttribute("src")).toMatch(
      /^https:\/\/gravatar\.com\/avatar\/[0-9a-f]{64}\?s=64&d=404$/u,
    );
    fireEvent.error(photo);
    await waitFor(() =>
      expect(screen.getAllByTestId("agent-studio-git-history-avatar")[0]?.textContent).toBe("AL"),
    );
  });

  test("hides, shows, and reorders columns from the header and keeps the choice", async () => {
    historyPage.mockImplementation(async () => ({ ...firstPage, nextOffset: null }));
    renderHistory();
    await screen.findByText("Subject c2");
    const titles = () =>
      within(screen.getByTestId("agent-studio-git-history-header"))
        .getAllByRole("button", { name: / column\./u })
        .map((title) => title.textContent);
    expect(titles()).toEqual(["Branch / Tag", "Graph", "Commit message", "Date"]);

    fireEvent.click(screen.getByTestId("agent-studio-git-history-columns-button"));
    const menu = within(await screen.findByTestId("agent-studio-git-history-columns-menu"));
    expect(
      menu.getByRole("menuitemcheckbox", { name: "Commit message" }).getAttribute("aria-disabled"),
    ).toBe("true");
    // The menu stays open, so both columns change in one visit.
    fireEvent.click(menu.getByRole("menuitemcheckbox", { name: "Author" }));
    fireEvent.click(menu.getByRole("menuitemcheckbox", { name: "Branch / Tag" }));
    expect(screen.getByTestId("agent-studio-git-history-columns-menu")).toBeTruthy();
    fireEvent.keyDown(screen.getByTestId("agent-studio-git-history-columns-menu"), {
      key: "Escape",
    });
    await waitFor(() =>
      expect(screen.queryByTestId("agent-studio-git-history-columns-menu")).toBeNull(),
    );
    expect(titles()).toEqual(["Graph", "Commit message", "Author", "Date"]);
    expect(
      screen.getAllByTestId("agent-studio-git-history-author").map((author) => author.textContent),
    ).toEqual(["ALAda Lovelace", "ALAda Lovelace"]);

    fireEvent.keyDown(screen.getByTestId("agent-studio-git-history-column-date"), {
      key: "ArrowLeft",
      altKey: true,
    });
    expect(titles()).toEqual(["Graph", "Commit message", "Date", "Author"]);
    expect(JSON.parse(globalThis.localStorage.getItem(HISTORY_COLUMNS_STORAGE_KEY) ?? "")).toEqual({
      order: ["refs", "graph", "message", "date", "author", "sha"],
      hidden: ["sha", "refs"],
    });
  });

  test("mounts only the visible rows of a long History", async () => {
    const commits = Array.from({ length: 300 }, (_, index) =>
      commit(`n${index}`, [`n${index + 1}`], "current"),
    );
    historyPage.mockImplementation(async () => ({
      outcome: "page",
      comparison: {
        currentTip: commits[0]?.oid ?? CURRENT,
        targetTip: BASE,
        boundaryOids: [BASE],
        aheadBehind: { ahead: 300, behind: 0 },
      },
      commits,
      nextOffset: null,
    }));
    renderHistory();

    expect(await screen.findByText("Subject n0")).toBeTruthy();
    const rows = screen.getAllByTestId("agent-studio-git-history-row");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(60);
    expect(screen.queryByText("Subject n299")).toBeNull();
  });

  test("loads the next page with the pinned tips and keeps rows when it fails", async () => {
    historyPage.mockImplementation(async (request) => {
      if (request.page) throw new Error("History changed");
      return firstPage;
    });
    renderHistory();

    await screen.findByText("Subject c2");
    await waitFor(() => expect(historyPage).toHaveBeenCalledTimes(2));
    expect(historyPage.mock.calls[1]?.[0].page).toEqual({
      currentTip: CURRENT,
      targetTip: TARGET,
      offset: 2,
    });
    expect(await screen.findByText(/Older commits could not load: History changed/)).toBeTruthy();
    expect(screen.getByText("Subject c2")).toBeTruthy();
  });

  test("ends the list with the last commit when no page is left", async () => {
    historyPage.mockImplementation(async () => ({ ...firstPage, nextOffset: null }));
    renderHistory();

    await screen.findByText("Subject c2");
    const list = screen.getByRole("list", { name: "Commits of feature compared with origin/main" });
    expect(list.querySelectorAll('[role="listitem"]')).toHaveLength(2);
    expect(screen.getAllByTestId("agent-studio-git-history-row")).toHaveLength(2);
    expect(historyPage).toHaveBeenCalledTimes(1);
  });

  test("says how many target commits the branch is missing", async () => {
    renderHistory();

    expect((await screen.findByTestId("agent-studio-git-history-relation")).textContent).toBe(
      "feature is 1 commit behind origin/main. The missing commits show in the list.",
    );
  });

  test("says that the branches match when both tips are the same commit", async () => {
    historyPage.mockImplementation(async () => ({
      outcome: "page",
      comparison: {
        currentTip: CURRENT,
        targetTip: CURRENT,
        boundaryOids: [CURRENT],
        aheadBehind: { ahead: 0, behind: 0 },
      },
      commits: [commit("c2", ["c1"], "boundary")],
      nextOffset: null,
    }));
    renderHistory();

    expect((await screen.findByTestId("agent-studio-git-history-relation")).textContent).toBe(
      "feature matches origin/main.",
    );
  });

  test("shows no relation line when the branch is only ahead", async () => {
    historyPage.mockImplementation(async () => ({
      ...firstPage,
      comparison: { ...firstPage.comparison, aheadBehind: { ahead: 2, behind: 0 } },
      nextOffset: null,
    }));
    renderHistory();

    await screen.findByText("Subject c2");
    expect(screen.queryByTestId("agent-studio-git-history-relation")).toBeNull();
  });

  test("reveals the full message, commit ID, and exact date", async () => {
    renderHistory();

    const [row] = await screen.findAllByTestId("agent-studio-git-history-row");
    if (!row) throw new Error("History has no rows.");
    fireEvent.click(row);

    const details = await screen.findByTestId("agent-studio-git-history-details");
    expect(details.textContent).toContain("Body of c2.");
    expect(details.textContent).toContain(CURRENT);
    expect(details.textContent).toContain("2026-10-13 14:05:22 +02:00");
  });

  test("keeps one details card for the list and closes it on a second click or a scroll", async () => {
    historyPage.mockImplementation(async () => ({ ...firstPage, nextOffset: null }));
    renderHistory();

    const [first, second] = await screen.findAllByTestId("agent-studio-git-history-row");
    if (!first || !second) throw new Error("History has fewer than two rows.");
    const details = () => screen.queryByTestId("agent-studio-git-history-details");

    fireEvent.click(first);
    expect((await screen.findByTestId("agent-studio-git-history-details")).textContent).toContain(
      "Body of c2.",
    );
    expect(first.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(second);
    await waitFor(() => expect(details()?.textContent).toContain("Body of t1."));
    expect(first.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(second);
    await waitFor(() => expect(details()).toBeNull());

    fireEvent.click(first);
    await screen.findByTestId("agent-studio-git-history-details");
    fireEvent.scroll(
      screen.getByRole("list", { name: "Commits of feature compared with origin/main" }),
    );
    await waitFor(() => expect(details()).toBeNull());
  });

  test("explains a branch without commits and unrelated histories", async () => {
    historyPage.mockImplementation(async () => ({ outcome: "no_commits" }));
    const { unmount } = renderHistory();
    expect(await screen.findByText("No commits yet")).toBeTruthy();
    unmount();

    historyPage.mockImplementation(async () => ({
      outcome: "no_common_ancestor",
      currentTip: CURRENT,
      targetTip: TARGET,
      shallow: true,
    }));
    renderHistory();
    expect(await screen.findByText(/This clone has incomplete history/)).toBeTruthy();
  });

  test("marks retained rows as old when a refresh fails and reports the failure", async () => {
    historyPage.mockImplementation(async (request) => {
      if (request.page) throw new Error("History changed");
      return firstPage;
    });
    const queryClient = createQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <div style={{ height: 600 }}>
            <GitHistoryView {...props()} />
          </div>
        </TooltipProvider>
      </QueryClientProvider>,
    );
    await screen.findByText(/Older commits could not load/);
    historyPage.mockImplementation(async () => {
      throw new Error("The target ref is unreadable.");
    });
    const readsBefore = historyPage.mock.calls.length;

    let outcome = "";
    await act(async () => {
      outcome = await refreshGitHistoryQueries(queryClient, "/repo", "/repo", {
        throwOnError: true,
      }).then(
        () => "resolved",
        (error: Error) => error.message,
      );
    });
    expect(outcome).toBe("The target ref is unreadable.");

    const failure = await screen.findByTestId("agent-studio-git-history-refresh-error");
    expect(failure.textContent).toBe("Refresh failed: The target ref is unreadable.");
    expect(screen.getByText("Subject c2")).toBeTruthy();
    // Older rows of the old comparison wait for a successful refresh.
    expect(screen.getByText("Refresh History to load older commits.")).toBeTruthy();
    expect(historyPage).toHaveBeenCalledTimes(readsBefore + 1);
    queryClient.clear();
  });

  test("marks a retained no-commits result as old until Refresh succeeds", async () => {
    historyPage.mockImplementation(async () => ({ outcome: "no_commits" }));
    const queryClient = createQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <GitHistoryView {...props()} />
        </TooltipProvider>
      </QueryClientProvider>,
    );
    await screen.findByText("No commits yet");
    historyPage.mockImplementation(async () => {
      throw new Error("Git is busy.");
    });

    await act(() =>
      refreshGitHistoryQueries(queryClient, "/repo", "/repo", { throwOnError: false }),
    );

    expect(
      (await screen.findByTestId("agent-studio-git-history-refresh-error")).textContent,
    ).toContain("Git is busy.");
    expect(screen.getByText("No commits yet")).toBeTruthy();

    historyPage.mockImplementation(async () => ({ outcome: "no_commits" }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh History" }));
    await waitForElementToBeRemoved(() =>
      screen.queryByTestId("agent-studio-git-history-refresh-error"),
    );
    expect(screen.getByText("No commits yet")).toBeTruthy();
    queryClient.clear();
  });

  test("keeps commit text visible beside a wide graph and scrolls the lanes together", async () => {
    const parents = Array.from({ length: 12 }, (_, index) => `p${index}`);
    historyPage.mockImplementation(async () => ({
      outcome: "page",
      comparison: {
        currentTip: oid("merge"),
        targetTip: BASE,
        boundaryOids: [BASE],
        aheadBehind: { ahead: 13, behind: 0 },
      },
      commits: [
        commit("merge", parents, "current"),
        ...parents.map((parent) => commit(parent, ["b0"], "current")),
        commit("b0", [], "boundary"),
      ],
      nextOffset: null,
    }));
    const OriginalResizeObserver = globalThis.ResizeObserver;
    // The History pane measures 300 px wide.
    globalThis.ResizeObserver = class implements ResizeObserver {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element) {
        const entry: ResizeObserverEntry = {
          target,
          contentRect: new DOMRectReadOnly(0, 0, 300, 600),
          borderBoxSize: [],
          contentBoxSize: [],
          devicePixelContentBoxSize: [],
        };
        this.callback([entry], this);
      }
      unobserve() {}
      disconnect() {}
    };
    try {
      renderHistory();

      const scroller = await screen.findByTestId("agent-studio-git-history-graph-scroll");
      expect(scroller.style.width).toBe("120px");
      const [graph] = screen.getAllByTestId("agent-studio-git-history-graph");
      const [lanes] = screen.getAllByTestId("agent-studio-git-history-graph-lanes");
      // The graph cell shows 120 px of the wider lanes.
      expect(lanes?.parentElement?.style.width).toBe("120px");
      expect(Number(graph?.getAttribute("width"))).toBeGreaterThan(120);
      expect(lanes?.style.transform).toBe(
        "translateX(calc(-1 * var(--history-graph-offset, 0px)))",
      );
      expect(screen.getByText("Subject merge")).toBeTruthy();

      // The scroll moves every row through one CSS variable, so no row renders again.
      fireEvent.scroll(scroller, { target: { scrollLeft: 40 } });
      expect(
        screen
          .getByTestId("agent-studio-git-history")
          .style.getPropertyValue("--history-graph-offset"),
      ).toBe("40px");
    } finally {
      globalThis.ResizeObserver = OriginalResizeObserver;
    }
  });

  test("shows the comparison failure instead of reading another target", async () => {
    renderHistory({
      targetReference: null,
      comparisonUnavailableReason: "Comparison branch refs/heads/gone is unavailable.",
    });

    expect(screen.getByText("Comparison branch refs/heads/gone is unavailable.")).toBeTruthy();
    expect(historyPage).not.toHaveBeenCalled();
  });
});
