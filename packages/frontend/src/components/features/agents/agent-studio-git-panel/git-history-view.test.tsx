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
} from "@testing-library/react";
import { createQueryClient } from "@/lib/query-client";
import { QueryProvider } from "@/lib/query-provider";
import { configureShellBridge, createUnavailableShellBridge } from "@/lib/shell-bridge";
import { refreshGitHistoryQueries } from "@/state/queries/git";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
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
  commits: [commit("c2", ["c1"], "current"), commit("t1", ["b0"], "target")],
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

const renderHistory = (overrides: Partial<GitHistoryViewProps> = {}) =>
  render(
    <QueryProvider useIsolatedClient>
      <div style={{ height: 600 }}>
        <GitHistoryView {...props(overrides)} />
      </div>
    </QueryProvider>,
  );

beforeEach(() => {
  historyPage.mockReset();
  historyPage.mockImplementation(async () => firstPage);
  configureShellBridge(createShellBridgeFixture({ client: { gitGetHistoryPage: historyPage } }));
});

afterEach(() => {
  cleanup();
  configureShellBridge(createUnavailableShellBridge());
});

describe("GitHistoryView", () => {
  test("shows each commit with its tip marker, body preview, author, and age", async () => {
    historyPage.mockImplementation(async () => ({ ...firstPage, nextOffset: null }));
    renderHistory();

    expect(await screen.findByText("Subject c2")).toBeTruthy();
    expect(screen.getByText("Subject t1")).toBeTruthy();
    expect(screen.getByText("Body of c2.")).toBeTruthy();
    expect(screen.getByTitle("Current: feature")).toBeTruthy();
    expect(screen.getByTitle("Target: origin/main")).toBeTruthy();
    expect(
      screen.getAllByTestId("agent-studio-git-history-author").map((author) => author.textContent),
    ).toEqual(["Ada Lovelace", "Ada Lovelace"]);
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

  test("folds a second tip on the same commit into a count with the full names", async () => {
    const branch = "feature/keep-history-subject-visible-on-a-long-current-branch";
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
    renderHistory({
      checkout: { name: branch, detached: false, revision: CURRENT },
      targetLabel: `origin/${branch}`,
    });

    expect(await screen.findByText("Subject c2")).toBeTruthy();
    const markers = screen.getByTestId("agent-studio-git-history-markers");
    expect([...markers.children].map((marker) => marker.getAttribute("title"))).toEqual([
      `Current: ${branch}`,
      `Target: origin/${branch}`,
    ]);
    expect(markers.textContent).toContain("+1");
  });

  test("marks a shared base without a tip", async () => {
    historyPage.mockImplementation(async () => ({
      ...firstPage,
      commits: [...firstPage.commits, commit("b0", [], "boundary")],
      nextOffset: null,
    }));
    renderHistory();

    expect(await screen.findByText("Subject b0")).toBeTruthy();
    const markers = screen.getAllByTestId("agent-studio-git-history-markers");
    expect(markers.map((marker) => marker.textContent)).toEqual([
      "Current: featurefeature",
      "Target: origin/mainorigin/main",
      "Shared baseBase",
    ]);
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
        <div style={{ height: 600 }}>
          <GitHistoryView {...props()} />
        </div>
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
        <GitHistoryView {...props()} />
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
      expect(graph?.parentElement?.style.width).toBe("120px");
      expect(Number(graph?.getAttribute("width"))).toBeGreaterThan(120);
      expect(screen.getByText("Subject merge")).toBeTruthy();

      fireEvent.scroll(scroller, { target: { scrollLeft: 40 } });
      expect(graph?.style.transform).toBe("translateX(-40px)");
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
