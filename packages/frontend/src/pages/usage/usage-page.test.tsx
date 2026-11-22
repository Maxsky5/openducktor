import { describe, expect, mock, test } from "bun:test";
import {
  type UsageFigure,
  type UsageReport,
  type UsageReportReadInput,
  usageReportSchema,
} from "@openducktor/contracts";
import type { UsageProgressListener } from "@openducktor/frontend-core/connection/host-connection";
import {
  createTestClientConnection,
  createTestHostConnection,
} from "@openducktor/frontend-core/test-support/test-client-connection";
import { RemoteConnectionError } from "@openducktor/host-client/remote";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryProvider } from "@/test-utils/query-provider";
import { UsagePage } from "./usage-page";

const figure = (overrides: Partial<UsageFigure> = {}): UsageFigure => ({
  tokens: {
    input: 1_000,
    cacheRead: 2_000_000,
    cacheWrite: 500,
    output: 3_500,
    processed: 2_005_000,
  },
  unmeasured: 0,
  sessions: 4,
  complete: true,
  cost: { usd: 12.5, state: "partial", unpricedTokens: 501_250 },
  ...overrides,
});

const report = (overrides: Partial<UsageReport> = {}): UsageReport =>
  usageReportSchema.parse({
    timeZone: "Europe/Paris",
    range: { start: "2026-11-20", end: "2026-11-21" },
    granularity: "day",
    resultAt: "2026-11-21T10:00:00.000Z",
    pricing: { source: "models.dev", updatedAt: "2026-11-21T08:00:00.000Z", issue: null },
    totals: figure(),
    periods: [
      {
        start: "2026-11-20",
        end: "2026-11-20",
        runtimes: [{ runtime: "claude", figure: figure() }],
      },
      {
        start: "2026-11-21",
        end: "2026-11-21",
        runtimes: [{ runtime: "claude", figure: figure() }],
      },
    ],
    byRuntime: [{ runtime: "claude", figure: figure() }],
    byModel: [{ id: "m1", provider: "anthropic", model: "claude-opus-5-5", figure: figure() }],
    byProject: [{ id: "p1", label: "openducktor", figure: figure() }],
    coverage: [{ runtime: "claude", state: "complete", issues: [] }],
    ...overrides,
  });

const emptyFigure = (): UsageFigure =>
  figure({
    tokens: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, processed: 0 },
    sessions: 0,
    cost: { usd: 0, state: "none", unpricedTokens: 0 },
  });

/** Holds the progress listener of the page, so a test can send progress events. */
type ProgressChannel = { listener: UsageProgressListener | null };

const renderPage = (
  usageReportRead: (input: UsageReportReadInput) => Promise<UsageReport>,
  progress: ProgressChannel = { listener: null },
) => {
  const read = mock(usageReportRead);
  const host = createTestHostConnection({
    client: { usageReportRead: read },
    subscribeUsageProgress: async (listener) => {
      progress.listener = listener;
      return () => {
        progress.listener = null;
      };
    },
  });
  const connection = createTestClientConnection({ host });
  render(
    <QueryProvider connection={connection}>
      <TooltipProvider>
        <UsagePage />
      </TooltipProvider>
    </QueryProvider>,
  );
  return read;
};

const NO_COUNTS = "These requests have no token counts.";
const UNCONFIRMED = "Some history could not be read, so a zero is not confirmed.";

const chooseMetric = (name: "Tokens" | "Cost") =>
  fireEvent.click(screen.getByRole("radio", { name }));

describe("UsagePage", () => {
  test("shows the headline tokens and switches to the estimated cost", async () => {
    const read = renderPage(async () => report());
    expect(await screen.findByText("Processed tokens")).toBeTruthy();
    expect(screen.getAllByText("2.01M").length).toBeGreaterThan(0);
    expect(screen.getByText("4 sessions · $12.50")).toBeTruthy();
    expect(read.mock.calls[0]?.[0]).toEqual({ range: { kind: "last_30_days" }, runtime: null });

    chooseMetric("Cost");
    expect(screen.getByText("Estimated API cost")).toBeTruthy();
    expect(screen.getByText("4 sessions · 2.01M tokens")).toBeTruthy();
    expect(screen.getByText("25.0% of tokens unpriced")).toBeTruthy();
  });

  test("shows the cache hit rate, the busiest day, and averages", async () => {
    renderPage(async () => report());
    await screen.findByText("Processed tokens");
    const highlights = within(screen.getByRole("region", { name: "Highlights" }));
    // 2,000,000 cache reads of 2,001,500 input-side tokens.
    expect(highlights.getByText("99.9%")).toBeTruthy();
    expect(highlights.getByText("Busiest day")).toBeTruthy();
    expect(highlights.getByText("Daily average")).toBeTruthy();
    expect(highlights.getByText("Per session")).toBeTruthy();
  });

  test("shows the progress of a first read of the history", async () => {
    const progress: ProgressChannel = { listener: null };
    renderPage(() => new Promise<UsageReport>(() => {}), progress);
    await waitFor(() => expect(progress.listener).not.toBeNull());
    const runtime = (runtime: "claude" | "opencode", done: number, total: number) => ({
      runtime,
      sources: { done, total },
      work:
        runtime === "opencode" ? { done: 0, total: 0 } : { done: done * 100, total: total * 100 },
      sessions: done * 3,
    });
    await act(() =>
      progress.listener?.({
        phase: "reading",
        startedAt: "2026-11-21T10:00:00.000Z",
        runtimes: [runtime("claude", 2, 4), runtime("opencode", 0, 1)],
      }),
    );
    expect(screen.getByText("Reading your agent history")).toBeTruthy();
    expect(screen.getByText("2 of 4 files · 6 sessions found")).toBeTruthy();
    expect(screen.getByText("Reading the database")).toBeTruthy();
    expect(
      screen.getByRole("progressbar", { name: "Usage history read" }).getAttribute("aria-valuenow"),
    ).toBe("50");
    await act(() =>
      progress.listener?.({
        phase: "summarizing",
        startedAt: "2026-11-21T10:00:00.000Z",
        runtimes: [runtime("claude", 4, 4), runtime("opencode", 1, 1)],
      }),
    );
    expect(screen.getByText("Building the daily totals")).toBeTruthy();
    expect(screen.getByText("15")).toBeTruthy();
  });

  test("names a rate download problem under Sources", async () => {
    renderPage(async () =>
      report({
        pricing: {
          source: "models.dev",
          updatedAt: null,
          issue: "Usage could not load the API rates from models.dev: offline.",
        },
      }),
    );
    expect(
      await screen.findByText("Usage could not load the API rates from models.dev: offline."),
    ).toBeTruthy();
    expect(screen.getByText(/Without API rates, costs show a dash/)).toBeTruthy();
  });

  test("keeps the shown result, marked as loading, until the next selection arrives", async () => {
    let finish: (value: UsageReport) => void = () => {};
    const read = renderPage((input) =>
      input.range.kind === "last_30_days"
        ? Promise.resolve(report())
        : new Promise<UsageReport>((resolve) => {
            finish = resolve;
          }),
    );
    await screen.findByText("Processed tokens");
    fireEvent.click(screen.getByRole("radio", { name: "90 days" }));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Loading the selected usage…")).toBeTruthy();
    expect(screen.getByText("Processed tokens")).toBeTruthy();
    expect(screen.queryByText(/first read of a large history/)).toBeNull();
    finish(report({ range: { start: "2026-08-24", end: "2026-11-21" } }));
    expect(await screen.findByText(/Aug 24 – Nov 21, 2026/)).toBeTruthy();
    expect(screen.queryByText("Loading the selected usage…")).toBeNull();
  });

  test("shows the failure of a new selection instead of the previous result", async () => {
    renderPage(async (input) => {
      if (input.range.kind === "last_30_days") return report();
      throw new Error("The usage index is locked.");
    });
    await screen.findByText("Processed tokens");
    fireEvent.click(screen.getByRole("radio", { name: "7 days" }));
    expect(await screen.findByText("The usage index is locked.")).toBeTruthy();
    expect(screen.queryByText("Processed tokens")).toBeNull();
  });

  test("reads the selected range preset", async () => {
    const read = renderPage(async () => report());
    await screen.findByText("Processed tokens");
    fireEvent.click(screen.getByRole("radio", { name: "90 days" }));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(read.mock.calls[1]?.[0]).toEqual({ range: { kind: "last_90_days" }, runtime: null });
  });

  test("tells the user to update a host without Usage", async () => {
    renderPage(async () => {
      throw new RemoteConnectionError({
        code: "function_unavailable",
        message: "Shell function usage_report_read is unavailable remotely.",
        nextAction: "Use the local shell for this action.",
      });
    });
    expect(await screen.findByText("This host does not have Usage")).toBeTruthy();
    expect(screen.getByText("Update OpenDucktor on the host, then open Usage again.")).toBeTruthy();
  });

  test("shows a read failure with Retry, which reads again", async () => {
    let calls = 0;
    const read = renderPage(async () => {
      calls++;
      if (calls === 1) throw new Error("The usage index is locked.");
      return report();
    });
    expect(await screen.findByText("The usage index is locked.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Processed tokens")).toBeTruthy();
    expect(read).toHaveBeenCalledTimes(2);
  });

  test("checks a custom range before it reads it", async () => {
    const read = renderPage(async () => report());
    await screen.findByText("Processed tokens");
    fireEvent.click(screen.getByRole("radio", { name: "Custom" }));

    const start = screen.getByLabelText("From");
    const end = screen.getByLabelText("To");
    fireEvent.change(start, { target: { value: "2026-11-10" } });
    fireEvent.change(end, { target: { value: "2026-11-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.getByRole("alert").textContent).toBe(
      "The end date must be on or after the start date.",
    );
    expect(read).toHaveBeenCalledTimes(1);

    fireEvent.change(end, { target: { value: "9999-12-31" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.getByRole("alert").textContent).toBe(
      "Use dates from Jan 1, 2000 to Dec 31, 2099.",
    );
    expect(read).toHaveBeenCalledTimes(1);

    fireEvent.change(end, { target: { value: "2026-11-15" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(read.mock.calls[1]?.[0]).toEqual({
      range: { kind: "custom", start: "2026-11-10", end: "2026-11-15" },
      runtime: null,
    });
  });

  test("says when the host has no runtime history", async () => {
    renderPage(async () =>
      report({
        totals: emptyFigure(),
        periods: [],
        byRuntime: [],
        byModel: [],
        byProject: [],
        coverage: [
          { runtime: "claude", state: "no_history", issues: [] },
          { runtime: "codex", state: "no_history", issues: [] },
        ],
      }),
    );
    expect(await screen.findByText("No runtime history on this host")).toBeTruthy();
  });

  test("says when unreadable history can hide activity", async () => {
    renderPage(async () =>
      report({
        totals: { ...emptyFigure(), complete: false },
        periods: [],
        byRuntime: [],
        byModel: [],
        byProject: [],
        coverage: [
          {
            runtime: "claude",
            state: "partial",
            issues: [{ code: "unreadable", message: "Cannot read.", nextAction: null }],
          },
        ],
      }),
    );
    expect(await screen.findByText("No readable activity in this range")).toBeTruthy();
    expect(screen.getByText("Cannot read.")).toBeTruthy();
  });

  test("shows requests without token counts as missing counts, not zeros", async () => {
    const unmeasured = () =>
      figure({
        tokens: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, processed: 0 },
        unmeasured: 1,
        sessions: 1,
        cost: { usd: 0, state: "unavailable", unpricedTokens: 0 },
      });
    renderPage(async () =>
      report({
        totals: unmeasured(),
        periods: [
          {
            start: "2026-11-20",
            end: "2026-11-21",
            runtimes: [{ runtime: "claude", figure: unmeasured() }],
          },
        ],
        byRuntime: [{ runtime: "claude", figure: unmeasured() }],
        byModel: [],
        byProject: [],
      }),
    );
    await screen.findByText("Processed tokens");
    // The total and the runtime row give the reason; tokens by type names it too.
    expect(screen.getAllByLabelText(NO_COUNTS).length).toBeGreaterThan(1);
    expect(screen.getByText(NO_COUNTS)).toBeTruthy();
    chooseMetric("Cost");
    expect(screen.getAllByLabelText(NO_COUNTS).length).toBeGreaterThan(1);
  });

  test("keeps a date draft while the runtime changes, and keeps focus on Apply", async () => {
    const read = renderPage(async () => report());
    await screen.findByText("Processed tokens");
    fireEvent.click(screen.getByRole("radio", { name: "Custom" }));
    const start = screen.getByLabelText("From");
    fireEvent.change(start, { target: { value: "2026-11-02" } });
    fireEvent.click(screen.getByRole("button", { name: "Runtime" }));
    fireEvent.click(await screen.findByRole("option", { name: /Codex/ }));
    await waitFor(() => expect(read.mock.calls.at(-1)?.[0].runtime).toBe("codex"));
    expect(screen.getByLabelText<HTMLInputElement>("From").value).toBe("2026-11-02");
    const apply = screen.getByRole("button", { name: "Apply" });
    apply.focus();
    fireEvent.click(apply);
    await screen.findByText("Processed tokens");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Apply" }));
  });

  test("names the selected runtime when it has no history", async () => {
    renderPage(async () =>
      report({
        totals: emptyFigure(),
        periods: [],
        byRuntime: [],
        byModel: [],
        byProject: [],
        coverage: [{ runtime: "codex", state: "no_history", issues: [] }],
      }),
    );
    expect(await screen.findByText("No Codex history on this host")).toBeTruthy();
  });

  test("marks incomplete values and never shows an unconfirmed zero as zero", async () => {
    const zero = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, processed: 0 };
    renderPage(async () =>
      report({
        totals: figure({ complete: false }),
        byRuntime: [
          { runtime: "claude", figure: figure({ complete: false }) },
          {
            runtime: "codex",
            figure: figure({
              tokens: zero,
              complete: false,
              cost: { usd: 0, state: "none", unpricedTokens: 0 },
            }),
          },
        ],
      }),
    );
    await screen.findByText("Processed tokens");
    expect(screen.getAllByLabelText(/can be higher/).length).toBeGreaterThan(1);
    expect(screen.getAllByLabelText(UNCONFIRMED).length).toBeGreaterThan(0);
    chooseMetric("Cost");
    // The runtime list shows no confirmed amount for the unconfirmed zero.
    expect(
      within(screen.getByRole("list", { name: "By runtime" })).queryByText("$0.00"),
    ).toBeNull();
  });

  test("explains a missing price apart from missing counts", async () => {
    const tokens = { input: 11, cacheRead: 0, cacheWrite: 0, output: 0, processed: 11 };
    const unpriced = figure({
      tokens,
      sessions: 1,
      cost: { usd: 0, state: "unavailable", unpricedTokens: 11 },
    });
    renderPage(async () =>
      report({
        totals: unpriced,
        byRuntime: [{ runtime: "claude", figure: unpriced }],
        periods: [
          {
            start: "2026-11-20",
            end: "2026-11-20",
            runtimes: [{ runtime: "claude", figure: unpriced }],
          },
        ],
      }),
    );
    await screen.findByText("Processed tokens");
    chooseMetric("Cost");
    expect(
      screen.getAllByLabelText("The rate catalog lists no rate for this usage.").length,
    ).toBeGreaterThan(1);
    expect(screen.queryByLabelText(NO_COUNTS)).toBeNull();
  });

  test("breaks the usage down by model, project, and day", async () => {
    renderPage(async () => report());
    await screen.findByText("Processed tokens");
    expect(screen.getByText("claude-opus-5-5")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Project" }));
    expect(screen.getByText("openducktor")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Day" }));
    const rows = screen.getAllByRole("row").map((row) => row.textContent);
    // Newest first, with the known total and the other metric.
    expect(rows[1]).toContain("Nov 21");
    expect(rows[2]).toContain("Nov 20");
    expect(rows[1]).toContain("$12.50");
  });
});
