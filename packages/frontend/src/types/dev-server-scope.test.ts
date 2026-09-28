import { describe, expect, test } from "bun:test";
import {
  createDevServerScope,
  formatDevServerScopeKey,
  formatDevServerTerminalIdentityKey,
} from "./dev-server-scope";

describe("dev-server-scope", () => {
  test("formats task scope keys without delimiter collisions", () => {
    const left = formatDevServerScopeKey(
      createDevServerScope("/repo::task-b", { kind: "task", taskId: "task-c" }),
    );
    const right = formatDevServerScopeKey(
      createDevServerScope("/repo", { kind: "task", taskId: "task-b::task-c" }),
    );

    expect(left).not.toBe(right);
  });

  test("formats terminal identity keys without delimiter collisions", () => {
    const left = formatDevServerTerminalIdentityKey(
      formatDevServerScopeKey(
        createDevServerScope("/repo::task-b", { kind: "task", taskId: "task-c" }),
      ),
      "web",
    );
    const right = formatDevServerTerminalIdentityKey(
      formatDevServerScopeKey(
        createDevServerScope("/repo", { kind: "task", taskId: "task-b::task-c" }),
      ),
      "web",
    );

    expect(left).not.toBe(right);
  });
  test("keeps equal Workspace Session scopes together and other owners apart", () => {
    const first = formatDevServerScopeKey(
      createDevServerScope("/repo", {
        kind: "workspace_session",
        workspaceId: "ws",
        sessionId: "one",
      }),
    );
    const sameSession = formatDevServerScopeKey(
      createDevServerScope("/repo", {
        sessionId: "one",
        workspaceId: "ws",
        kind: "workspace_session",
      }),
    );
    const second = formatDevServerScopeKey(
      createDevServerScope("/repo", {
        kind: "workspace_session",
        workspaceId: "ws",
        sessionId: "two",
      }),
    );
    const task = formatDevServerScopeKey(
      createDevServerScope("/repo", { kind: "task", taskId: "one" }),
    );
    expect(sameSession).toBe(first);
    expect(new Set([first, second, task]).size).toBe(3);
  });
});
