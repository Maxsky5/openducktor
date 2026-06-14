import { describe, expect, test } from "bun:test";
import { resolveCodexPresenceSource, toPresenceSnapshot } from "./codex-app-server-presence";
import { type CodexThreadSnapshot, codexThreadStatusSnapshot } from "./codex-app-server-threads";
import type { CodexSessionState } from "./types";

const createSession = (liveStatus?: CodexSessionState["liveStatus"]): CodexSessionState => ({
  summary: {
    externalSessionId: "thread-1",
    role: null,
    startedAt: "2026-05-07T00:00:00.000Z",
    status: liveStatus?.agentSessionStatus ?? "idle",
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

describe("toPresenceSnapshot", () => {
  test("uses a neutral Codex title and does not infer activity from summary status", () => {
    const session = createSession();

    expect(toPresenceSnapshot(session, [], [])).toMatchObject({
      presence: "runtime",
      classification: "idle",
      agentSessionStatus: "idle",
      status: { type: "idle" },
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

describe("resolveCodexPresenceSource", () => {
  test("uses thread inventory when restore has no local live status", () => {
    expect(
      resolveCodexPresenceSource({
        session: createSession(),
        thread: createThread("active"),
        threadIsLoaded: true,
        hasPendingInput: false,
        hasActiveTurn: false,
      }),
    ).toEqual({ type: "thread", thread: createThread("active") });
  });

  test("keeps local idle when inventory still reports running", () => {
    expect(
      resolveCodexPresenceSource({
        session: createSession(codexThreadStatusSnapshot("idle")),
        thread: createThread("active"),
        threadIsLoaded: true,
        hasPendingInput: false,
        hasActiveTurn: false,
      }),
    ).toEqual({ type: "local" });
  });

  test("keeps active local turns visible while inventory catches up", () => {
    expect(
      resolveCodexPresenceSource({
        session: createSession(),
        thread: createThread("idle"),
        threadIsLoaded: true,
        hasPendingInput: false,
        hasActiveTurn: true,
      }),
    ).toEqual({ type: "local" });
  });

  test("returns missing only when neither inventory nor local runtime state can prove presence", () => {
    expect(
      resolveCodexPresenceSource({
        session: createSession(),
        thread: null,
        threadIsLoaded: false,
        hasPendingInput: false,
        hasActiveTurn: false,
      }),
    ).toEqual({ type: "missing" });
  });
});
