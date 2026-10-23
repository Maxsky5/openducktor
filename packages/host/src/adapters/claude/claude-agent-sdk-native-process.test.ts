import { describe, expect, mock, test } from "bun:test";
import { Deferred, Effect, Fiber } from "effect";
import { createClaudeNativeProcessSpawner } from "./claude-agent-sdk-native-process";
import { consumeClaudeSession } from "./claude-agent-sdk-session-io";
import {
  createClaudeQueryFixture,
  createClaudeSession,
} from "./claude-agent-sdk-session-io.test-support";
import { createClaudeAgentSdkSessionStore } from "./claude-agent-sdk-session-store";
import type { ClaudeAgentSdkEvent } from "./claude-agent-sdk-types";

const target = {
  runtimeKind: "claude" as const,
  workingDirectory: "/repo",
  externalSessionId: "session-1",
};

describe("Claude native termination", () => {
  test("background-only Stop waits for actual process exit before publishing Stopped", async () => {
    const session = createClaudeSession({ activity: "running", foregroundTurnActive: false });
    const events: ClaudeAgentSdkEvent[] = [];
    const store = createClaudeAgentSdkSessionStore({
      emit: (_session, event) => events.push(event),
    });
    const child = createClaudeNativeProcessSpawner(session)({
      command: process.execPath,
      args: [
        "-e",
        "process.stdin.on('end', () => setTimeout(() => process.exit(0), 30)); process.stdin.resume();",
      ],
      cwd: process.cwd(),
      env: process.env,
      signal: new AbortController().signal,
    });
    session.query.close = mock(() => child.stdin.end());
    store.set(session);
    try {
      const stopped = Effect.runPromise(store.stopSession(target));
      expect(store.get(session.externalSessionId)).toBe(session);
      expect(session.activity).toBe("running");
      expect(events).toEqual([]);
      await stopped;
      expect(child.exitCode).toBe(0);
      expect(session.activity).toBe("stopped");
      expect(store.get(session.externalSessionId)).toBeUndefined();
      expect(events.map((event) => event.type)).toEqual(["session_finished"]);
    } finally {
      child.kill("SIGKILL");
    }
  });

  test("failed termination invalidates input without joining a live consumer and retains retry cleanup", async () => {
    const session = createClaudeSession({ activity: "running", foregroundTurnActive: false });
    const events: ClaudeAgentSdkEvent[] = [];
    const store = createClaudeAgentSdkSessionStore({
      emit: (_session, event) => events.push(event),
    });
    const child = createClaudeNativeProcessSpawner(session)({
      command: process.execPath,
      args: ["-e", "process.stdin.resume();"],
      cwd: process.cwd(),
      env: process.env,
      signal: new AbortController().signal,
    });
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    const releaseConsumer = Deferred.makeUnsafe<void>();
    const consumer = Effect.runFork(Deferred.await(releaseConsumer));
    const answered = mock(() => {});
    session.pendingQuestions.set("question-1", {
      event: {
        type: "question_required",
        externalSessionId: session.externalSessionId,
        timestamp: "2026-10-23T00:00:00.000Z",
        requestId: "question-1",
        questions: [],
      },
      resolve: answered,
    });
    session.query.close = mock(() => {
      throw new Error("native close failed");
    });
    store.set(session);
    store.ownConsumer(session, consumer, () => true);
    try {
      const failure = await Effect.runPromise(store.stopSession(target)).catch(
        (cause: unknown) => cause,
      );
      expect(failure).toMatchObject({
        message: expect.stringContaining("termination is unconfirmed"),
      });
      expect(store.getForCleanup(session.externalSessionId)).toBe(session);
      expect(session.activity).toBe("running");
      expect(session.statusUnavailableReason).toContain("retry Stop");
      expect(session.pendingQuestions.size).toBe(0);
      expect(answered).toHaveBeenCalledTimes(1);
      expect(events.map((event) => event.type)).toEqual(["session_context_error"]);
      expect(events[0]).toMatchObject({ statusUnavailable: true });
      child.kill("SIGTERM");
      await exited;
      await Effect.runPromise(Deferred.succeed(releaseConsumer, undefined));
      await Effect.runPromise(Fiber.join(consumer));
      await Effect.runPromise(store.stopSession(target));
      expect(store.getForCleanup(session.externalSessionId)).toBeUndefined();
      expect(session.activity).toBe("stopped");
      expect(session.statusUnavailableReason).toBeUndefined();
      expect(events.map((event) => event.type)).toEqual([
        "session_context_error",
        "session_finished",
      ]);
    } finally {
      child.kill("SIGKILL");
      await Effect.runPromise(Deferred.succeed(releaseConsumer, undefined));
      await Effect.runPromise(Fiber.join(consumer));
      await exited;
    }
  });

  test("keeps native stderr and its cause when the custom process reports a stream failure", async () => {
    const diagnosticsRead = Promise.withResolvers<void>();
    const nativeFailure = new Error("Claude exited with code 1");
    const query = createClaudeQueryFixture({
      async *[Symbol.asyncIterator]() {
        await diagnosticsRead.promise;
        yield* [];
        throw nativeFailure;
      },
    });
    const session = createClaudeSession({ query });
    const events: ClaudeAgentSdkEvent[] = [];
    const onBackgroundFailure = mock(() => Effect.void);
    const child = createClaudeNativeProcessSpawner(session, (text) => {
      if (text.includes("native setting failed")) diagnosticsRead.resolve();
    })({
      command: process.execPath,
      args: ["-e", "process.stderr.write('native setting failed\\n'); process.exitCode = 1;"],
      cwd: process.cwd(),
      env: process.env,
      signal: new AbortController().signal,
    });
    const store = createClaudeAgentSdkSessionStore();
    store.set(session);
    try {
      await consumeClaudeSession({
        session,
        sessionStore: store,
        now: () => "2026-10-23T00:00:00.000Z",
        emit: (_session, event) => events.push(event),
        onBackgroundFailure,
      });
      expect(child.exitCode).toBe(1);
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "session_error",
          message: "Claude exited with code 1\nstderr: native setting failed",
        }),
      );
      expect(onBackgroundFailure).not.toHaveBeenCalled();
    } finally {
      child.kill("SIGKILL");
    }
  });
});
