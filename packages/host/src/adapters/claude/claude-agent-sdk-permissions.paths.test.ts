import { describe, expect, test } from "bun:test";
import type { AgentEvent } from "@openducktor/core";
import {
  createClaudeCanUseTool,
  createClaudePermissionTestSession as createSession,
} from "./claude-agent-sdk-permissions.test-support";

describe("Claude permission path routing", () => {
  test("routes Windows descendant and blocked paths through the session worktree", async () => {
    const events: AgentEvent[] = [];
    const session = createSession("build");
    session.input = {
      ...session.input,
      repoPath: "C:\\Repo\\Fairnest",
      workingDirectory: "C:\\Repo\\Fairnest-task-worktree",
    };
    const canUseTool = createClaudeCanUseTool({
      session,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: (_session, event) => events.push(event),
    });

    const resultPromise = canUseTool(
      "Write",
      { file_path: "c:\\repo\\fairnest\\apps\\api\\src\\auth.ts" },
      {
        signal: new AbortController().signal,
        toolUseID: "tool-use-1",
        blockedPath: "c:\\repo\\fairnest\\apps\\api\\src\\auth.ts",
      },
    );

    session.pendingApprovals.get("request-1")?.resolve({ behavior: "allow" });

    await expect(resultPromise).resolves.toEqual({
      behavior: "allow",
      updatedInput: {
        file_path: "C:/Repo/Fairnest-task-worktree/apps/api/src/auth.ts",
      },
    });
    expect(events).toEqual([
      expect.objectContaining({
        affectedPaths: ["C:/Repo/Fairnest-task-worktree/apps/api/src/auth.ts"],
      }),
    ]);
  });

  test("routes the exact Windows repository path through the session worktree", async () => {
    const session = createSession("build");
    session.input = {
      ...session.input,
      repoPath: "C:\\Repo\\Fairnest",
      workingDirectory: "C:\\Repo\\Fairnest-task-worktree",
    };
    const canUseTool = createClaudeCanUseTool({
      session,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: () => {},
    });

    const resultPromise = canUseTool(
      "Write",
      { file_path: "c:\\repo\\fairnest" },
      {
        signal: new AbortController().signal,
        toolUseID: "tool-use-1",
      },
    );
    session.pendingApprovals.get("request-1")?.resolve({ behavior: "allow" });

    await expect(resultPromise).resolves.toEqual({
      behavior: "allow",
      updatedInput: { file_path: "C:\\Repo\\Fairnest-task-worktree" },
    });
  });

  test("routes mixed-separator Windows descendants without matching sibling prefixes", async () => {
    const session = createSession("build");
    session.input = {
      ...session.input,
      repoPath: "C:\\Repo\\Fairnest",
      workingDirectory: "C:\\Repo\\Fairnest-task-worktree",
    };
    const canUseTool = createClaudeCanUseTool({
      session,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: () => {},
    });

    const mixedResultPromise = canUseTool(
      "Write",
      { file_path: "c:/repo/fairnest\\apps/api/src/auth.ts" },
      {
        signal: new AbortController().signal,
        toolUseID: "tool-use-1",
      },
    );
    session.pendingApprovals.get("request-1")?.resolve({ behavior: "allow" });

    await expect(mixedResultPromise).resolves.toEqual({
      behavior: "allow",
      updatedInput: {
        file_path: "C:/Repo/Fairnest-task-worktree/apps/api/src/auth.ts",
      },
    });

    const siblingResultPromise = canUseTool(
      "Write",
      { file_path: "C:\\Repo\\Fairnest-copy\\apps\\api\\src\\auth.ts" },
      {
        signal: new AbortController().signal,
        toolUseID: "tool-use-2",
      },
    );
    session.pendingApprovals.get("request-1")?.resolve({ behavior: "allow" });

    await expect(siblingResultPromise).resolves.toEqual({
      behavior: "allow",
      updatedInput: {
        file_path: "C:\\Repo\\Fairnest-copy\\apps\\api\\src\\auth.ts",
      },
    });
  });

  test("routes Claude file paths through the session worktree", async () => {
    const events: AgentEvent[] = [];
    const session = createSession("build");
    session.input = {
      ...session.input,
      repoPath: "/repo/fairnest",
      workingDirectory: "/repo/fairnest-task-worktree",
    };
    const canUseTool = createClaudeCanUseTool({
      session,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: (_session, event) => events.push(event),
    });

    const result = await canUseTool(
      "Read",
      { file_path: "/repo/fairnest/apps/api/src/lib/auth.ts" },
      {
        signal: new AbortController().signal,
        toolUseID: "tool-use-1",
        blockedPath: "/repo/fairnest/apps/api/src/lib/auth.ts",
      },
    );

    expect(result).toEqual({
      behavior: "allow",
      updatedInput: {
        file_path: "/repo/fairnest-task-worktree/apps/api/src/lib/auth.ts",
      },
    });
    expect(events).toEqual([]);
    expect(session.pendingApprovals.size).toBe(0);
  });

  test("preserves Bash commands exactly while routing non-shell file paths", async () => {
    const events: AgentEvent[] = [];
    const session = createSession("build");
    session.input = {
      ...session.input,
      repoPath: "/repo/fairnest",
      workingDirectory: "/repo/fairnest-task-worktree",
    };
    const canUseTool = createClaudeCanUseTool({
      session,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: (_session, event) => events.push(event),
    });

    const command = 'cd "/repo/fairnest"; rg auth apps/api/src/lib/auth.ts';
    const resultPromise = canUseTool(
      "Bash",
      { command },
      {
        signal: new AbortController().signal,
        toolUseID: "tool-use-1",
      },
    );

    expect(session.pendingApprovals.has("request-1")).toBe(true);
    session.pendingApprovals.get("request-1")?.resolve({ behavior: "allow" });

    const result = await resultPromise;
    expect(result).toEqual({
      behavior: "allow",
      updatedInput: { command },
    });
    expect(events).toEqual([
      expect.objectContaining({
        type: "approval_required",
        requestId: "request-1",
        command: {
          command,
          workingDirectory: "/repo/fairnest-task-worktree",
        },
        tool: {
          name: "Bash",
          input: { command },
        },
      }),
    ]);
    expect(session.pendingApprovals.get("request-1")?.event.command?.command).toBe(command);
  });

  test("does not rewrite sibling worktree names that only share the durable repo prefix", async () => {
    const events: AgentEvent[] = [];
    const session = createSession("build");
    session.input = {
      ...session.input,
      repoPath: "/Users/maxsky5/projects/perso/fairnest",
      workingDirectory: "/Users/maxsky5/projects/perso/fairnest-io69",
    };
    const canUseTool = createClaudeCanUseTool({
      session,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: (_session, event) => events.push(event),
    });

    const resultPromise = canUseTool(
      "Bash",
      {
        command:
          "git -C /Users/maxsky5/projects/perso/fairnest-io69 diff --stat && ls /Users/maxsky5/projects/perso/fairnest/apps",
      },
      {
        signal: new AbortController().signal,
        toolUseID: "tool-use-1",
        displayName: "Bash",
      },
    );

    expect(events).toEqual([
      expect.objectContaining({
        command: {
          command:
            "git -C /Users/maxsky5/projects/perso/fairnest-io69 diff --stat && ls /Users/maxsky5/projects/perso/fairnest/apps",
          workingDirectory: "/Users/maxsky5/projects/perso/fairnest-io69",
        },
        tool: expect.objectContaining({
          input: {
            command:
              "git -C /Users/maxsky5/projects/perso/fairnest-io69 diff --stat && ls /Users/maxsky5/projects/perso/fairnest/apps",
          },
        }),
      }),
    ]);

    session.pendingApprovals.get("request-1")?.resolve({ behavior: "allow" });

    await expect(resultPromise).resolves.toEqual({
      behavior: "allow",
      updatedInput: {
        command:
          "git -C /Users/maxsky5/projects/perso/fairnest-io69 diff --stat && ls /Users/maxsky5/projects/perso/fairnest/apps",
      },
    });
  });

  test("delegates shell commands to Claude permissions for read-only roles", async () => {
    const events: AgentEvent[] = [];
    const session = createSession("planner");
    const canUseTool = createClaudeCanUseTool({
      session,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: (_session, event) => events.push(event),
    });

    const resultPromise = canUseTool(
      "Bash",
      { command: "node scripts/update.js" },
      {
        signal: new AbortController().signal,
        toolUseID: "tool-use-1",
      },
    );

    expect(events).toEqual([
      expect.objectContaining({
        type: "approval_required",
        requestId: "request-1",
        requestType: "command_execution",
        mutation: "unknown",
      }),
    ]);
    expect(session.pendingApprovals.has("request-1")).toBe(true);

    session.pendingApprovals.get("request-1")?.resolve({ behavior: "allow" });

    await expect(resultPromise).resolves.toEqual({
      behavior: "allow",
      updatedInput: { command: "node scripts/update.js" },
    });
  });
});
