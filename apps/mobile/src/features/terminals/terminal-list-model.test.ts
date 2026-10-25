import { describe, expect, test } from "bun:test";
import type { TerminalSummary } from "@openducktor/contracts";
import type { TerminalTab } from "@openducktor/frontend-core/terminals/terminal-presentation-state";
import {
  buildTerminalRows,
  findTerminalTab,
  terminalLimitText,
  terminalScreenStatus,
} from "./terminal-list-model";

const summary = (overrides: Partial<TerminalSummary> = {}): TerminalSummary => ({
  terminalId: "t-1",
  label: "zsh",
  context: { repoPath: "/repo", taskId: "task-1" },
  initialWorkingDir: "/worktrees/task-1",
  createdAt: "2026-10-19T00:00:00.000Z",
  lifecycle: "running",
  exit: null,
  startedBy: "user",
  ...overrides,
});
const ready = (overrides: Partial<TerminalSummary> = {}): TerminalTab => {
  const value = summary(overrides);
  return {
    tabId: `tab:${value.terminalId}`,
    terminalId: value.terminalId,
    summary: value,
    awaitingLifecycleSync: false,
    error: null,
    requestState: "ready",
  };
};
type PendingTab = Extract<TerminalTab, { outcomeUnknown: boolean }>;
const pending = (overrides: Partial<PendingTab> = {}): TerminalTab => ({
  tabId: "creating:1",
  terminalId: null,
  summary: null,
  label: "Run tests",
  actionId: "test",
  error: null,
  outcomeUnknown: false,
  requestState: "creating",
  ...overrides,
});
const lost: TerminalTab = {
  tabId: "tab:old",
  terminalId: null,
  summary: null,
  label: "old shell",
  error: "The terminal host restarted. It cannot be recovered or recreated automatically.",
  requestState: "lost",
  sourceTerminalId: "old",
};
const model = (tabs: TerminalTab[], closing: string[] = [], running: string[] = []) => ({
  tabs,
  closingTabIds: new Set(closing),
  runningCommandTerminalIds: new Set(running),
});

describe("buildTerminalRows", () => {
  test("shows the title, who started each terminal, and its state as text", () => {
    const rows = buildTerminalRows(
      model(
        [
          ready(),
          ready({ terminalId: "t-2", label: "Setup", startedBy: "host" }),
          ready({
            terminalId: "t-3",
            lifecycle: "exited",
            exit: {
              exitCode: 0,
              signal: null,
              finalSequence: 4,
              exitedAt: "2026-10-19T00:01:00.000Z",
            },
          }),
        ],
        [],
        ["t-2"],
      ),
    );
    expect(
      rows.map(({ title, stateLabel, stateTone }) => ({ title, stateLabel, stateTone })),
    ).toEqual([
      { title: "zsh", stateLabel: "Running", stateTone: "running" },
      { title: "Setup", stateLabel: "Running", stateTone: "running" },
      { title: "zsh", stateLabel: "Exited", stateTone: "neutral" },
    ]);
    expect(rows.map((row) => row.startedLabel?.split(" at ")[0])).toEqual([
      "Started by you",
      "Started by OpenDucktor",
      "Started by you",
    ]);
    expect(rows[1]?.runsCommand).toBe(true);
    expect(rows[2]).toMatchObject({ detail: "Exited with code 0.", detailIsFailure: false });
  });

  test("tells apart terminals of one folder by their start time", () => {
    const rows = buildTerminalRows(
      model([
        ready({ createdAt: "2026-10-19T20:31:05.000Z" }),
        ready({ terminalId: "t-2", createdAt: "2026-10-19T20:31:06.000Z" }),
      ]),
    );
    const [first, second] = rows.map((row) => row.startedLabel);
    expect(first).toStartWith("Started by you at ");
    expect(second).toStartWith("Started by you at ");
    expect(first).not.toBe(second);
  });

  test("shows only who started a terminal whose start time is not a date", () => {
    const [row] = buildTerminalRows(model([ready({ createdAt: "soon" })]));
    expect(row?.startedLabel).toBe("Started by you");
  });

  test("marks a failed exit as a warning with its status", () => {
    const [row] = buildTerminalRows(
      model([
        ready({
          lifecycle: "exited",
          exit: {
            exitCode: 1,
            signal: "SIGTERM",
            finalSequence: 1,
            exitedAt: "2026-10-19T00:01:00.000Z",
          },
        }),
      ]),
    );
    expect(row).toMatchObject({
      stateTone: "warning",
      detail: "Exited with code 1 (SIGTERM).",
      detailIsFailure: true,
    });
  });

  test("offers Retry only for a start that surely did not run", () => {
    const rows = buildTerminalRows(
      model([
        pending({ requestState: "creation_failed", error: "The action lint does not exist." }),
        pending({
          tabId: "creating:2",
          requestState: "creation_failed",
          error: "The host result was lost. Check the terminal list.",
          outcomeUnknown: true,
        }),
        lost,
      ]),
    );
    expect(rows.map((row) => [row.stateLabel, row.canRetry, row.outcomeUnknown])).toEqual([
      ["Creation failed", true, false],
      ["Creation failed", false, true],
      ["Lost after host restart", false, false],
    ]);
  });

  test("shows closing terminals as Closing", () => {
    const [row] = buildTerminalRows(model([ready()], ["tab:t-1"]));
    expect(row).toMatchObject({ stateLabel: "Closing", closing: true });
  });
});

describe("terminalLimitText", () => {
  test("counts the open terminals against the limit of 8", () => {
    expect(terminalLimitText(model([ready(), pending(), lost]))).toBe("3 of 8 terminals");
    expect(terminalLimitText(model([ready(), pending()], ["tab:t-1"]))).toBe("1 of 8 terminals");
  });
});

describe("terminalScreenStatus", () => {
  const base = {
    isAvailable: true,
    startBlockedReason: null,
    isSynced: true,
    isLoading: false,
    discoveryError: null,
  };

  test("finds a terminal and keeps a lost terminal lost", () => {
    expect(terminalScreenStatus({ ...base, tabs: [ready()] }, "t-1").kind).toBe("ready");
    expect(terminalScreenStatus({ ...base, tabs: [lost] }, "old").kind).toBe("lost");
    expect(findTerminalTab([lost], "old")).toBe(lost);
  });

  test("waits for discovery, then reports a missing terminal or a discovery failure", () => {
    expect(terminalScreenStatus({ ...base, tabs: [], isSynced: false }, "t-1").kind).toBe(
      "loading",
    );
    expect(terminalScreenStatus({ ...base, tabs: [] }, "t-1").kind).toBe("missing");
    expect(terminalScreenStatus({ ...base, tabs: [], discoveryError: "Offline." }, "t-1")).toEqual({
      kind: "discovery_failed",
      message: "Offline.",
    });
    expect(
      terminalScreenStatus(
        { ...base, tabs: [], isAvailable: false, startBlockedReason: "This chat is archived." },
        "t-1",
      ),
    ).toEqual({ kind: "unavailable", message: "This chat is archived." });
  });
});
