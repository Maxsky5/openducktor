import { describe, expect, test } from "bun:test";
import { agentSessionStatusFromActivity } from "@openducktor/core";
import {
  resolveCodexRuntimeSnapshotSource,
  toRuntimeSnapshot,
} from "./codex-app-server-runtime-snapshot";
import { type CodexThreadSnapshot, codexThreadStatusSnapshot } from "./codex-app-server-threads";
import type { CodexSessionState } from "./types";

const createSession = (liveStatus?: CodexSessionState["liveStatus"]): CodexSessionState => ({
  summary: {
    externalSessionId: "thread-1",
    role: null,
    startedAt: "2026-05-07T00:00:00.000Z",
    status: liveStatus ? agentSessionStatusFromActivity(liveStatus.classification) : "idle",
  },
  systemPrompt: "Use the repo rules.",
  role: null,
  runtimeId: "runtime-1",
  repoPath: "/repo",
  threadId: "thread-1",
  workingDirectory: "/repo",
  taskId: "task-1",
  ...(liveStatus ? { liveStatus } : {}),
});

const createThread = (status: "active" | "idle" = "active"): CodexThreadSnapshot => ({
  id: "thread-1",
  title: "Codex thread",
  cwd: "/repo",
  startedAt: "2026-05-07T00:00:00.000Z",
  status: codexThreadStatusSnapshot(status),
});

describe("toRuntimeSnapshot", () => {
  test("uses a neutral Codex title and does not infer activity from summary status", () => {
    const session = createSession();

    expect(toRuntimeSnapshot(session, [], [])).toMatchObject({
      availability: "runtime",
      classification: "idle",
      ref: {
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread-1",
      },
      title: "Codex",
    });
  });
});

describe("resolveCodexRuntimeSnapshotSource", () => {
  test("uses thread inventory when restore has no local live status", () => {
    expect(
      resolveCodexRuntimeSnapshotSource({
        session: createSession(),
        thread: createThread("active"),
        threadIsLoaded: true,
        hasPendingInput: false,
        hasActiveTurn: false,
      }),
    ).toEqual({ type: "thread", thread: createThread("active") });
  });

  test("uses loaded inventory when no pending input or active turn needs local state", () => {
    expect(
      resolveCodexRuntimeSnapshotSource({
        session: createSession(codexThreadStatusSnapshot("idle")),
        thread: createThread("active"),
        threadIsLoaded: true,
        hasPendingInput: false,
        hasActiveTurn: false,
      }),
    ).toEqual({ type: "thread", thread: createThread("active") });
  });

  test("keeps active local turns visible while inventory catches up", () => {
    expect(
      resolveCodexRuntimeSnapshotSource({
        session: createSession(),
        thread: createThread("idle"),
        threadIsLoaded: true,
        hasPendingInput: false,
        hasActiveTurn: true,
      }),
    ).toEqual({ type: "local" });
  });

  test("returns missing only when neither inventory nor local runtime state can prove a runtime snapshot", () => {
    expect(
      resolveCodexRuntimeSnapshotSource({
        session: createSession(),
        thread: null,
        threadIsLoaded: false,
        hasPendingInput: false,
        hasActiveTurn: false,
      }),
    ).toEqual({ type: "missing" });
  });
});
