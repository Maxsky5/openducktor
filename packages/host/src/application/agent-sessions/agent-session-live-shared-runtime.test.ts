import { describe, expect, test } from "bun:test";
import type {
  AgentSessionAuthorizedRoot,
  AgentSessionControlStartInput,
  AgentSessionLiveEnvelope,
  AgentSessionLiveRef,
  AgentSessionLiveSnapshot,
  RuntimeKind,
} from "@openducktor/contracts";
import { Deferred, Effect } from "effect";
import { createLiveSessionAdapterRegistry } from "../../adapters/agent-sessions/live-session-adapter-registry";
import { createTestRuntimeAdmissionGate } from "../../test-support/runtime-admission-test-gate";
import { type HostError, HostOperationError } from "../../effect/host-errors";
import type { AgentSessionRuntimeAdapterPort } from "../../ports/agent-session-live-adapter-port";
import type { RuntimeAdmissionPort } from "../../ports/runtime-admission-port";
import { createAgentSessionRuntimeAdapterTestDouble } from "../../test-support/service-test-doubles";
import { createAgentSessionLiveStateService } from "./agent-session-live-state-service";

const passThroughAdmission: RuntimeAdmissionPort = { admit: (_runtimeKind, effect) => effect };

const ref = (
  repoPath: string,
  externalSessionId: string,
  runtimeKind: RuntimeKind = "codex",
): AgentSessionLiveRef => ({
  repoPath,
  runtimeKind,
  workingDirectory: `${repoPath}/${externalSessionId}`,
  externalSessionId,
});

const snapshot = (sessionRef: AgentSessionLiveRef): AgentSessionLiveSnapshot => ({
  ref: sessionRef,
  activity: "idle",
  title: `Session ${sessionRef.externalSessionId}`,
  startedAt: "2026-07-16T10:00:00.000Z",
  pendingApprovals: [],
  pendingQuestions: [],
  contextUsage: null,
});

const sharedAdapter = (
  runtimeId: string,
  runtimeKind: RuntimeKind,
  overrides: Partial<Omit<AgentSessionRuntimeAdapterPort, "binding">>,
): AgentSessionRuntimeAdapterPort =>
  createAgentSessionRuntimeAdapterTestDouble({ runtimeId, runtimeKind }, overrides);

const createHarness = (
  input: {
    runtimeAdmission?: RuntimeAdmissionPort;
    readSessionRootRefs?: (repoPath: string) => Effect.Effect<AgentSessionAuthorizedRoot[]>;
  } = {},
) => {
  const events: AgentSessionLiveEnvelope[] = [];
  const service = createAgentSessionLiveStateService({
    adapterRegistry: createLiveSessionAdapterRegistry(),
    runtimeAdmission: input.runtimeAdmission ?? passThroughAdmission,
    readSessionRootRefs: input.readSessionRootRefs ?? (() => Effect.succeed([])),
    faultLog: () => Effect.void,
    publish: (event) => {
      events.push(event);
    },
  });
  return { events, service };
};

const expectHostFailure = async <A>(effect: Effect.Effect<A, HostError>): Promise<HostError> => {
  const result = await Effect.runPromise(Effect.result(effect));
  if (result._tag === "Success") throw new Error("Expected effect to fail.");
  return result.failure;
};

const startInput: AgentSessionControlStartInput = {
  repoPath: "/repo-a",
  runtimeKind: "codex",
  workingDirectory: "/repo-a",
  sessionScope: { kind: "repository" },
  systemPrompt: "Work.",
};

describe("shared live runtime across repositories", () => {
  test("lists the sessions with live work of one kind and filters a repository list by session ref", async () => {
    const { service } = createHarness();
    const running = { ...snapshot(ref("/repo-a", "session-a")), activity: "running" as const };
    const waiting = {
      ...snapshot(ref("/repo-b", "session-b")),
      activity: "waiting_for_question" as const,
    };
    const restored = snapshot(ref("/repo-b", "session-r"));
    const other = {
      ...snapshot(ref("/repo-a", "session-o", "opencode")),
      activity: "running" as const,
    };
    await Effect.runPromise(
      service.registerRuntimeAdapter(
        sharedAdapter("codex-runtime", "codex", {
          listSnapshots: () => Effect.succeed([running, waiting, restored]),
        }),
      ),
    );
    await Effect.runPromise(
      service.registerRuntimeAdapter(
        sharedAdapter("opencode-runtime", "opencode", {
          listSnapshots: () => Effect.succeed([other]),
        }),
      ),
    );

    const runtimeSessions = await Effect.runPromise(service.listRuntimeSessions("codex"));
    expect(runtimeSessions.map((session) => session.ref)).toEqual([running.ref, waiting.ref]);
    const repoA = await Effect.runPromise(service.list({ repoPath: "/repo-a" }));
    expect(repoA.map((session) => session.ref)).toEqual([running.ref, other.ref]);
    const repoB = await Effect.runPromise(service.list({ repoPath: "/repo-b" }));
    expect(repoB.map((session) => session.ref)).toEqual([waiting.ref, restored.ref]);
    await expect(Effect.runPromise(service.listRuntimeSessions("claude"))).resolves.toEqual([]);
  });

  test("lists an idle session that a control served, with its children, but not restored history", async () => {
    const { service } = createHarness();
    const started = snapshot(ref("/repo-a", "started"));
    const child = { ...snapshot(ref("/repo-a", "child")), parentExternalSessionId: "started" };
    const restored = snapshot(ref("/repo-a", "restored"));
    const adapter = sharedAdapter("codex-runtime", "codex", {
      listSnapshots: () => Effect.succeed([started, child, restored]),
      startSession: (input) =>
        Effect.succeed({
          externalSessionId: "started",
          runtimeKind: "codex" as const,
          workingDirectory: input.workingDirectory,
          startedAt: "2026-07-16T10:00:00.000Z",
          status: "idle" as const,
        }),
    });
    await Effect.runPromise(service.registerRuntimeAdapter(adapter));
    expect(await Effect.runPromise(service.listRuntimeSessions("codex"))).toEqual([]);

    await Effect.runPromise(service.startSession(startInput));

    const runtimeSessions = await Effect.runPromise(service.listRuntimeSessions("codex"));
    expect(runtimeSessions.map((session) => session.ref)).toEqual([started.ref, child.ref]);
  });

  test("rejects a control with an actionable message while the kind is not ready", async () => {
    const admission = createTestRuntimeAdmissionGate();
    const { service } = createHarness({ runtimeAdmission: admission });
    const starts: AgentSessionControlStartInput[] = [];
    await Effect.runPromise(
      service.registerRuntimeAdapter(
        sharedAdapter("codex-runtime", "codex", {
          listSnapshots: () => Effect.succeed([]),
          startSession: (input) =>
            Effect.sync(() => {
              starts.push(input);
              return {
                externalSessionId: "session-1",
                runtimeKind: "codex" as const,
                workingDirectory: input.workingDirectory,
                startedAt: "2026-07-16T10:00:00.000Z",
                status: "idle" as const,
              };
            }),
        }),
      ),
    );

    const notStarted = await expectHostFailure(service.startSession(startInput));
    expect(notStarted).toMatchObject({
      _tag: "HostResourceError",
      message:
        "The codex runtime is not ready yet. Wait for the runtime to start, or check Diagnostics.",
    });

    admission.close("codex", {
      state: "error",
      message: "The Codex runtime stopped: exit code 1.",
      nextAction: "Restart the runtime from Diagnostics.",
    });
    const failed = await expectHostFailure(service.startSession(startInput));
    expect(failed.message).toBe(
      "The Codex runtime stopped: exit code 1. Restart the runtime from Diagnostics.",
    );
    expect(starts).toEqual([]);

    admission.open("codex");
    await expect(Effect.runPromise(service.startSession(startInput))).resolves.toMatchObject({
      externalSessionId: "session-1",
      workingDirectory: "/repo-a",
    });
    expect(starts).toEqual([startInput]);
  });

  test("admits model and title updates only while the kind accepts controls", async () => {
    const admission = createTestRuntimeAdmissionGate();
    const { service } = createHarness({ runtimeAdmission: admission });
    const calls: string[] = [];
    await Effect.runPromise(
      service.registerRuntimeAdapter(
        sharedAdapter("codex-runtime", "codex", {
          listSnapshots: () => Effect.succeed([]),
          updateSessionModel: () => Effect.sync(() => void calls.push("model")),
          updateSessionTitle: () =>
            Effect.sync(() => {
              calls.push("title");
              return { status: "renamed" as const };
            }),
        }),
      ),
    );
    const sessionRef = {
      repoPath: "/repo-a",
      runtimeKind: "codex" as const,
      workingDirectory: "/repo-a",
      externalSessionId: "session-1",
    };
    const modelInput = {
      ...sessionRef,
      sessionScope: { kind: "repository" as const },
      model: null,
    };
    const titleInput = { ...sessionRef, title: "Renamed" };

    // A lifecycle action holds the kind, so it must not detach the adapter under these updates.
    admission.close("codex", {
      state: "restarting",
      message: "The Codex runtime is restarting.",
      nextAction: "Wait for the runtime to become ready.",
    });
    for (const update of [
      service.updateSessionModel(modelInput),
      service.updateSessionTitle(titleInput),
    ]) {
      expect((await expectHostFailure(update)).message).toBe(
        "The Codex runtime is restarting. Wait for the runtime to become ready.",
      );
    }
    expect(calls).toEqual([]);

    admission.open("codex");
    await Effect.runPromise(service.updateSessionModel(modelInput));
    await Effect.runPromise(service.updateSessionTitle(titleInput));
    expect(calls).toEqual(["model", "title"]);
  });

  test("runtime release publishes removals for the sessions of every repository", async () => {
    const { events, service } = createHarness();
    const first = snapshot(ref("/repo-a", "session-a"));
    const second = snapshot(ref("/repo-b", "session-b"));
    await Effect.runPromise(
      service.registerRuntimeAdapter(
        sharedAdapter("codex-runtime", "codex", {
          listSnapshots: () => Effect.succeed([first, second]),
          releaseRuntime: () => Effect.succeed([first.ref, second.ref]),
        }),
      ),
    );
    await Effect.runPromise(service.refresh({ repoPath: "/repo-a" }));
    await Effect.runPromise(service.refresh({ repoPath: "/repo-b" }));
    events.length = 0;

    await expect(Effect.runPromise(service.releaseRuntime("codex-runtime"))).resolves.toEqual([
      first.ref,
      second.ref,
    ]);

    expect(events).toEqual([
      { type: "session_removed", ref: first.ref },
      { type: "session_removed", ref: second.ref },
    ]);
    await expect(Effect.runPromise(service.list({ repoPath: "/repo-a" }))).resolves.toEqual([]);
    await expect(Effect.runPromise(service.list({ repoPath: "/repo-b" }))).resolves.toEqual([]);
  });

  test("resets every observed repository when the detach read fails", async () => {
    const { events, service } = createHarness();
    const first = snapshot(ref("/repo-a", "session-a"));
    const second = snapshot(ref("/repo-b", "session-b"));
    let readFails = false;
    await Effect.runPromise(
      service.registerRuntimeAdapter(
        sharedAdapter("codex-runtime", "codex", {
          listSnapshots: () =>
            readFails
              ? Effect.fail(
                  new HostOperationError({ operation: "test.list", message: "detach read failed" }),
                )
              : Effect.succeed([first, second]),
          releaseRuntime: () => Effect.succeed([first.ref, second.ref]),
        }),
      ),
    );
    await Effect.runPromise(service.refresh({ repoPath: "/repo-a" }));
    await Effect.runPromise(service.refresh({ repoPath: "/repo-c" }));
    readFails = true;
    events.length = 0;

    await expect(Effect.runPromise(service.releaseRuntime("codex-runtime"))).rejects.toThrow(
      "detach read failed",
    );

    expect(events.filter((event) => event.type === "session_removed")).toEqual([
      { type: "session_removed", ref: first.ref },
      { type: "session_removed", ref: second.ref },
    ]);
    // Observed repositories and the repositories of released refs all get a fresh snapshot.
    expect(events.filter((event) => event.type === "snapshot")).toEqual([
      { type: "snapshot", repoPath: "/repo-a", sessions: [] },
      { type: "snapshot", repoPath: "/repo-c", sessions: [] },
      { type: "snapshot", repoPath: "/repo-b", sessions: [] },
    ]);
  });

  test("registration refreshes every repository observed before the runtime started", async () => {
    const codexRootA: AgentSessionAuthorizedRoot = {
      ...ref("/repo-a", "root-a"),
      sessionScope: { kind: "repository" },
    };
    const opencodeRootA: AgentSessionAuthorizedRoot = {
      ...ref("/repo-a", "root-o", "opencode"),
      sessionScope: { kind: "repository" },
    };
    const codexRootB: AgentSessionAuthorizedRoot = {
      ...ref("/repo-b", "root-b"),
      sessionScope: { kind: "repository" },
    };
    const rootsByRepo = new Map([
      ["/repo-a", [codexRootA, opencodeRootA]],
      ["/repo-b", [codexRootB]],
    ]);
    const { events, service } = createHarness({
      readSessionRootRefs: (repoPath) => Effect.succeed(rootsByRepo.get(repoPath) ?? []),
    });
    await Effect.runPromise(service.refresh({ repoPath: "/repo-a" }));
    await Effect.runPromise(service.refresh({ repoPath: "/repo-b" }));
    const refreshed: Array<{ repoPath: string; roots: AgentSessionAuthorizedRoot[] }> = [];
    const restored = snapshot(ref("/repo-b", "root-b"));
    events.length = 0;

    await Effect.runPromise(
      service.registerRuntimeAdapter(
        sharedAdapter("codex-runtime", "codex", {
          refreshSnapshots: (repoPath, roots = []) =>
            Effect.sync(() => {
              refreshed.push({ repoPath, roots });
            }),
          listSnapshots: () => Effect.succeed([restored]),
        }),
      ),
    );

    expect(refreshed).toEqual([
      { repoPath: "/repo-a", roots: [codexRootA] },
      { repoPath: "/repo-b", roots: [codexRootB] },
    ]);
    expect(events).toMatchObject([{ type: "session_upsert", session: restored }]);
  });
  test("a failed native release stays owned and the next release retries it", async () => {
    const { events, service } = createHarness();
    const detached = snapshot(ref("/repo-a", "session-a"));
    const lateRef = ref("/repo-b", "session-late");
    let nativeReleases = 0;
    await Effect.runPromise(
      service.registerRuntimeAdapter(
        sharedAdapter("codex-runtime", "codex", {
          listSnapshots: () => Effect.succeed([detached]),
          releaseRuntime: () =>
            Effect.suspend(() => {
              nativeReleases += 1;
              return nativeReleases === 1
                ? Effect.fail(
                    new HostOperationError({ operation: "test.release", message: "child alive" }),
                  )
                : Effect.succeed([detached.ref, lateRef]);
            }),
        }),
      ),
    );
    events.length = 0;

    const failure = await expectHostFailure(service.releaseRuntime("codex-runtime"));
    expect(failure.message).toContain("adapter cleanup");
    expect(failure.message).toContain("child alive");
    expect(events).toEqual([{ type: "session_removed", ref: detached.ref }]);

    await expect(Effect.runPromise(service.releaseRuntime("codex-runtime"))).resolves.toEqual([
      detached.ref,
      lateRef,
    ]);
    expect(nativeReleases).toBe(2);
    expect(events).toEqual([
      { type: "session_removed", ref: detached.ref },
      { type: "session_removed", ref: lateRef },
    ]);
    await expect(Effect.runPromise(service.releaseRuntime("codex-runtime"))).resolves.toEqual([]);
    expect(nativeReleases).toBe(2);
  });

  test("a concurrent release waits for the release in progress and gets its failure", async () => {
    const { service } = createHarness();
    const detached = snapshot(ref("/repo-a", "session-a"));
    const firstRelease = Deferred.makeUnsafe<void>();
    let nativeReleases = 0;
    await Effect.runPromise(
      service.registerRuntimeAdapter(
        sharedAdapter("opencode-runtime", "opencode", {
          listSnapshots: () => Effect.succeed([detached]),
          releaseRuntime: () =>
            Effect.suspend(() => {
              nativeReleases += 1;
              return nativeReleases === 1
                ? Deferred.await(firstRelease).pipe(
                    Effect.andThen(
                      Effect.fail(
                        new HostOperationError({
                          operation: "test.release",
                          message: "child alive",
                        }),
                      ),
                    ),
                  )
                : Effect.succeed([detached.ref]);
            }),
        }),
      ),
    );

    const first = Effect.runPromise(Effect.flip(service.releaseRuntime("opencode-runtime")));
    await Bun.sleep(0);
    const concurrent = Effect.runPromise(Effect.flip(service.releaseRuntime("opencode-runtime")));
    await Bun.sleep(0);
    expect(nativeReleases).toBe(1);
    await Effect.runPromise(Deferred.succeed(firstRelease, undefined));

    const [firstFailure, concurrentFailure] = await Promise.all([first, concurrent]);
    expect(concurrentFailure).toBe(firstFailure);
    expect(firstFailure.message).toContain("child alive");

    await expect(Effect.runPromise(service.releaseRuntime("opencode-runtime"))).resolves.toEqual([
      detached.ref,
    ]);
    expect(nativeReleases).toBe(2);
  });
});
