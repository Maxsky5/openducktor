import { describe, expect, test } from "bun:test";
import {
  applyDevServerEventToState,
  isDevServerPanelExpanded,
  selectDefaultDevServerTab,
} from "./use-agent-studio-dev-server-panel-helpers";
import { buildScript, buildState } from "./use-agent-studio-dev-server-panel-test-fixtures";

describe("useAgentStudioDevServerPanel helpers", () => {
  test("selects the remembered tab when it still exists", () => {
    const selected = selectDefaultDevServerTab(
      [buildScript({ scriptId: "frontend" }), buildScript({ scriptId: "backend" })],
      "backend",
    );

    expect(selected).toBe("backend");
  });

  test("falls back to the most recently started script", () => {
    const selected = selectDefaultDevServerTab(
      [
        buildScript({ scriptId: "frontend", startedAt: "2026-03-19T15:29:00.000Z" }),
        buildScript({ scriptId: "backend", startedAt: "2026-03-19T15:30:00.000Z" }),
      ],
      null,
    );

    expect(selected).toBe("backend");
  });

  test("expands when start or restart is pending or a script is failed", () => {
    expect(isDevServerPanelExpanded([buildScript()], true)).toBe(true);
    expect(isDevServerPanelExpanded([buildScript({ status: "failed" })], false)).toBe(true);
    expect(isDevServerPanelExpanded([buildScript()], false)).toBe(false);
  });
  test("ignores an older snapshot and a status event from another Workspace Session", () => {
    const owner = { kind: "workspace_session" as const, workspaceId: "ws", sessionId: "one" };
    const current = buildState({
      owner,
      revision: 3,
      scripts: [buildScript({ status: "running", pid: 401 })],
    });
    const oldSnapshot = buildState({ owner, revision: 2, scripts: [buildScript()] });
    expect(applyDevServerEventToState(current, { type: "snapshot", state: oldSnapshot })).toBe(
      current,
    );
    expect(
      applyDevServerEventToState(current, {
        type: "script_status_changed",
        repoPath: "/repo",
        owner: { kind: "workspace_session", workspaceId: "ws", sessionId: "two" },
        script: buildScript({ status: "stopped" }),
        revision: 4,
        updatedAt: "2026-03-19T15:31:00.000Z",
      }),
    ).toBe(current);
  });
});
