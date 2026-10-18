import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type {
  GitHistoryCommit,
  GitHistoryPage,
  GitHistoryPageRequest,
} from "@openducktor/contracts";
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
import { ClientConnectionProvider } from "@openducktor/frontend-core/connection/client-connection-react";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { QueryProvider } from "@/test-utils/query-provider";
import { refreshGitHistoryQueries } from "@openducktor/frontend-core/queries/git";
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

const createHistoryConnection = () =>
  createTestClientConnection({ client: { gitGetHistoryPage: historyPage } });

/** A removed commit fades out for 200 ms before the list closes the gap. */
const waitForFadeOut = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
  });

const props = (overrides: Partial<GitHistoryViewProps> = {}): GitHistoryViewProps => ({
  contextKey: "task-1",
  pending: false,
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
    <QueryProvider connection={createHistoryConnection()}>
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
});

afterEach(() => {
  cleanup();
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

  test("keeps the rows of the branch while a new commit loads, then adds it in place", async () => {
    historyPage.mockImplementation(async () => ({ ...firstPage, nextOffset: null }));
    const connection = createHistoryConnection();
    const { queryClient } = connection;
    const tree = (revision: string) => (
      <ClientConnectionProvider connection={connection}>
        <TooltipProvider>
          <div style={{ height: 600 }}>
            <GitHistoryView
              {...props({ checkout: { name: "feature", detached: false, revision } })}
            />
          </div>
        </TooltipProvider>
      </ClientConnectionProvider>
    );
    const view = render(tree(CURRENT));
    await screen.findByText("Subject c2");
    const rowOf = (subject: string) =>
      screen.getByText(subject).closest('[data-testid="agent-studio-git-history-row"]');
    const shownRow = rowOf("Subject c2");

    let resolve: (page: GitHistoryPage) => void = () => {};
    historyPage.mockImplementation(
      () => new Promise<GitHistoryPage>((settle) => (resolve = settle)),
    );
    const next = oid("c3");
    view.rerender(tree(next));
    // The shown graph stays while the graph of the new commit loads.
    expect(screen.queryByText("Loading History...")).toBeNull();
    expect(screen.getByText("Subject c2")).toBeTruthy();

    await act(async () => {
      resolve({
        ...firstPage,
        comparison: { ...firstPage.comparison, currentTip: next },
        commits: [commit("c3", ["c2"], "current"), ...firstPage.commits],
        nextOffset: null,
      });
    });
    await screen.findByText("Subject c3");
    // The row of an old commit keeps its element, and only the new commit fades in.
    expect(rowOf("Subject c2")).toBe(shownRow);
    expect(rowOf("Subject c3")?.className).toContain("history-row-enter");
    expect(rowOf("Subject c2")?.className).not.toContain("history-row-enter");
    view.unmount();
    queryClient.clear();
  });

  test("keeps the graph while the panel checks the same target again after a commit", async () => {
    historyPage.mockImplementation(async () => ({ ...firstPage, nextOffset: null }));
    const connection = createHistoryConnection();
    const { queryClient } = connection;
    const tree = (overrides: Partial<GitHistoryViewProps>) => (
      <ClientConnectionProvider connection={connection}>
        <TooltipProvider>
          <div style={{ height: 600 }}>
            <GitHistoryView {...props(overrides)} />
          </div>
        </TooltipProvider>
      </ClientConnectionProvider>
    );
    const view = render(tree({}));
    await screen.findByText("Subject c2");
    const rowOf = (subject: string) =>
      screen.getByText(subject).closest('[data-testid="agent-studio-git-history-row"]');
    const shownRow = rowOf("Subject c2");

    // The commit gives the branch a new revision, and the panel checks the target again.
    const next = oid("c3");
    const checkout = { name: "feature", detached: false, revision: next };
    view.rerender(
      tree({
        checkout,
        pending: true,
        targetReference: null,
        comparisonUnavailableReason: "Checking comparison origin/main...",
      }),
    );
    expect(screen.queryByText("Loading History...")).toBeNull();
    expect(rowOf("Subject c2")).toBe(shownRow);

    historyPage.mockImplementation(async () => ({
      ...firstPage,
      comparison: { ...firstPage.comparison, currentTip: next },
      commits: [commit("c3", ["c2"], "current"), ...firstPage.commits],
      nextOffset: null,
    }));
    view.rerender(tree({ checkout }));
    await screen.findByText("Subject c3");
    // The list never left, so the old row keeps its element.
    expect(rowOf("Subject c2")).toBe(shownRow);
    view.unmount();
    queryClient.clear();
  });

  test("fades out a commit that a reset removed, then closes the gap", async () => {
    historyPage.mockImplementation(async () => ({ ...firstPage, nextOffset: null }));
    const connection = createHistoryConnection();
    const { queryClient } = connection;
    const tree = (revision: string) => (
      <ClientConnectionProvider connection={connection}>
        <TooltipProvider>
          <div style={{ height: 600 }}>
            <GitHistoryView
              {...props({ checkout: { name: "feature", detached: false, revision } })}
            />
          </div>
        </TooltipProvider>
      </ClientConnectionProvider>
    );
    const view = render(tree(CURRENT));
    await screen.findByText("Subject c2");
    const rowOf = (subject: string) =>
      screen.queryByText(subject)?.closest('[data-testid="agent-studio-git-history-row"]');
    const targetRow = rowOf("Subject t1");

    // A reset moves the branch back to c1, so c2 leaves History.
    const reset = oid("c1");
    historyPage.mockImplementation(async () => ({
      ...firstPage,
      comparison: { ...firstPage.comparison, currentTip: reset },
      commits: [firstPage.commits[1] ?? commit("t1", ["b0"], "target")],
      nextOffset: null,
    }));
    view.rerender(tree(reset));
    await waitFor(() => expect(rowOf("Subject c2")?.className).toContain("history-row-leave"));
    await waitForFadeOut();
    expect(rowOf("Subject c2")).toBeUndefined();
    // The other row keeps its element and slides into the gap.
    expect(rowOf("Subject t1")).toBe(targetRow);
    view.unmount();
    queryClient.clear();
  });

  test("clears the selection of a commit that leaves, so its card does not open again", async () => {
    historyPage.mockImplementation(async () => ({ ...firstPage, nextOffset: null }));
    const connection = createHistoryConnection();
    const { queryClient } = connection;
    const tree = (revision: string) => (
      <ClientConnectionProvider connection={connection}>
        <TooltipProvider>
          <div style={{ height: 600 }}>
            <GitHistoryView
              {...props({ checkout: { name: "feature", detached: false, revision } })}
            />
          </div>
        </TooltipProvider>
      </ClientConnectionProvider>
    );
    const view = render(tree(CURRENT));
    const details = () => screen.queryByTestId("agent-studio-git-history-details");
    fireEvent.click(await screen.findByText("Subject c2"));
    await screen.findByTestId("agent-studio-git-history-details");

    const reset = oid("c1");
    historyPage.mockImplementation(async () => ({
      ...firstPage,
      comparison: { ...firstPage.comparison, currentTip: reset },
      commits: [firstPage.commits[1] ?? commit("t1", ["b0"], "target")],
      nextOffset: null,
    }));
    view.rerender(tree(reset));
    // The new graph arrives, the card closes, and the commit fades out.
    await waitForFadeOut();
    expect(details()).toBeNull();
    expect(screen.queryByText("Subject c2")).toBeNull();

    // The commit comes back, for example through the reflog. Its card stays closed.
    historyPage.mockImplementation(async () => ({ ...firstPage, nextOffset: null }));
    view.rerender(tree(CURRENT));
    await screen.findByText("Subject c2");
    expect(details()).toBeNull();
    view.unmount();
    queryClient.clear();
  });

  test("loads History again from Retry after a failed first read", async () => {
    historyPage.mockImplementation(async () => {
      throw new Error("The branch changed. Refresh to read its History.");
    });
    renderHistory();
    await screen.findByText("History could not load");

    historyPage.mockImplementation(async () => ({ ...firstPage, nextOffset: null }));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Subject c2")).toBeTruthy();
  });

  test("shows the loader for a pending check of another target", async () => {
    historyPage.mockImplementation(async () => ({ ...firstPage, nextOffset: null }));
    const connection = createHistoryConnection();
    const { queryClient } = connection;
    const tree = (overrides: Partial<GitHistoryViewProps>) => (
      <ClientConnectionProvider connection={connection}>
        <TooltipProvider>
          <div style={{ height: 600 }}>
            <GitHistoryView {...props(overrides)} />
          </div>
        </TooltipProvider>
      </ClientConnectionProvider>
    );
    const view = render(tree({}));
    await screen.findByText("Subject c2");

    view.rerender(
      tree({
        contextKey: "task-1:release",
        pending: true,
        targetReference: null,
        comparisonUnavailableReason: "Checking comparison origin/release...",
      }),
    );
    // The graph of the old target must not show while the new target loads.
    expect(screen.getByText("Loading History...")).toBeTruthy();
    expect(screen.queryByText("Subject c2")).toBeNull();
    view.unmount();
    queryClient.clear();
  });

  test("keeps the rows while a rebase detaches HEAD from the branch", async () => {
    historyPage.mockImplementation(async () => ({ ...firstPage, nextOffset: null }));
    const connection = createHistoryConnection();
    const { queryClient } = connection;
    const tree = (checkout: GitHistoryViewProps["checkout"]) => (
      <ClientConnectionProvider connection={connection}>
        <TooltipProvider>
          <div style={{ height: 600 }}>
            <GitHistoryView {...props({ checkout })} />
          </div>
        </TooltipProvider>
      </ClientConnectionProvider>
    );
    const view = render(tree({ name: "feature", detached: false, revision: CURRENT }));
    await screen.findByText("Subject c2");

    historyPage.mockImplementation(() => new Promise<GitHistoryPage>(() => {}));
    view.rerender(tree({ detached: true, revision: oid("r1") }));
    // The graph follows the rebase in place instead of starting again.
    expect(screen.queryByText("Loading History...")).toBeNull();
    expect(screen.getByText("Subject c2")).toBeTruthy();
    view.unmount();
    queryClient.clear();
  });

  test("starts without rows for another branch", async () => {
    historyPage.mockImplementation(async () => ({ ...firstPage, nextOffset: null }));
    const connection = createHistoryConnection();
    const { queryClient } = connection;
    const tree = (name: string) => (
      <ClientConnectionProvider connection={connection}>
        <TooltipProvider>
          <div style={{ height: 600 }}>
            <GitHistoryView
              {...props({ checkout: { name, detached: false, revision: CURRENT } })}
            />
          </div>
        </TooltipProvider>
      </ClientConnectionProvider>
    );
    const view = render(tree("feature"));
    await screen.findByText("Subject c2");

    historyPage.mockImplementation(() => new Promise<GitHistoryPage>(() => {}));
    view.rerender(tree("other"));
    // The graph of another branch must not show while the new branch loads.
    expect(await screen.findByText("Loading History...")).toBeTruthy();
    expect(screen.queryByText("Subject c2")).toBeNull();
    view.unmount();
    queryClient.clear();
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
    const connection = createHistoryConnection();
    const { queryClient } = connection;
    render(
      <ClientConnectionProvider connection={connection}>
        <TooltipProvider>
          <div style={{ height: 600 }}>
            <GitHistoryView {...props()} />
          </div>
        </TooltipProvider>
      </ClientConnectionProvider>,
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
    const connection = createHistoryConnection();
    const { queryClient } = connection;
    render(
      <ClientConnectionProvider connection={connection}>
        <TooltipProvider>
          <GitHistoryView {...props()} />
        </TooltipProvider>
      </ClientConnectionProvider>,
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
