import { createRecoveryCostClient } from "../../adapters-opencode-sdk/scripts/recovery-cost-client";
import assert from "node:assert/strict";
import { Effect } from "effect";
import type {
  AgentSessionLiveRef,
  AgentSessionLiveSnapshot,
  HostEventEnvelope,
} from "@openducktor/contracts";
import { parseHostEventEnvelope } from "@openducktor/contracts";
import { listOpencodeRuntimeSnapshotSources } from "../../adapters-opencode-sdk/src/live-session-snapshots";
import { loadSessionHistory } from "../../adapters-opencode-sdk/src/message-ops";
import { readLatestOpencodeContextUsage } from "../../adapters-opencode-sdk/src/opencode-session-native-operations";

import { createLiveProjectionAttachmentOwner } from "../src/application/agent-sessions/live-projection-attachment-owner";
import { createLiveStateCoordinator } from "../src/application/agent-sessions/live-state-coordinator";
import { createSharedHistoryRecovery } from "../src/application/runtimes/shared-history-recovery";
import { createAgentSessionRuntimeAdapterTestDouble } from "../src/test-support/service-test-doubles";
import { BufferedHostEventStream } from "../../openducktor-web/src/typescript-host-backend-support";

const repoPath = "/fixture/repo";
const now = () => "2026-10-01T10:00:00.000Z";
const roots: AgentSessionLiveRef[] = Array.from({ length: 8 }, (_, index) => ({
  repoPath,
  runtimeKind: "opencode",
  workingDirectory: repoPath,
  externalSessionId: `root-${index}`,
}));
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
type Scenario =
  | "brief_disconnect"
  | "transcript_overflow"
  | "other_channel_overflow"
  | "additional_browsers"
  | "host_replacement"
  | "runtime_replacement";
type Measurement = {
  nativeCalls: number;
  durableHostReads: number;
  deliveryBytes: number;
  elapsedMs: number;
  repairedHistories: number;
};

const measure = async (scenario: Scenario, shared: boolean): Promise<Measurement> => {
  let nativeCalls = 0;
  let durableHostReads = 0;
  let deliveryBytes = 0;
  let repairedHistories = 0;
  const client = createRecoveryCostClient(repoPath, () => {
    nativeCalls++;
  });
  const createClient = () => client;
  let snapshots: AgentSessionLiveSnapshot[] = [];
  const reconstruct = async () => {
    const read = await listOpencodeRuntimeSnapshotSources({
      createClient,
      runtimeEndpoint: "http://fixture.invalid",
      roots,
      now,
      readDirectory: async (_directory, operation) => operation(),
      readContextUsage: (ref) =>
        readLatestOpencodeContextUsage(
          { createClient, runtimeEndpoint: "http://fixture.invalid" },
          ref,
        ),
    });
    assert.equal(read.failures.length, 0);
    snapshots = read.sources.map((source) => ({
      ref: { ...roots[0]!, externalSessionId: source.externalSessionId },
      activity: source.runtimeActivity,
      title: source.title,
      startedAt: source.startedAt,
      pendingApprovals: [],
      pendingQuestions: [],
      contextUsage: null,
    }));
    assert.equal(snapshots.length, 16);
  };
  const adapter = createAgentSessionRuntimeAdapterTestDouble(
    { repoPath, runtimeKind: "opencode", runtimeId: "fixture-runtime" },
    {
      refreshSnapshots: () => Effect.promise(reconstruct),
    },
  );
  const owner = createLiveProjectionAttachmentOwner({
    refreshGate: createLiveStateCoordinator(),
    readSessionRootRefs: () =>
      Effect.sync(() => {
        // Model the three durable repository boundaries: workspace sessions, tasks, and task sessions.
        // This fixture does not measure SQLite execution time.
        durableHostReads += 3;
        return roots;
      }),
  });
  const histories = createSharedHistoryRecovery();
  const initialize = () =>
    shared
      ? Effect.runPromise(owner.initialize(adapter))
      : Effect.runPromise(
          Effect.sync(() => {
            durableHostReads += 3;
          }).pipe(Effect.zipRight(Effect.promise(reconstruct))),
        );
  const readHistory = async (ref: AgentSessionLiveRef) => {
    const work = Effect.promise(async () => ({
      history: await loadSessionHistory(createClient, now, {
        ...ref,
        runtimeEndpoint: "http://fixture.invalid",
      }),
      coverage: "full" as const,
      runtimeGeneration: adapter.binding.generation,
      transcriptRevisionAtStart: 0,
      transcriptRevisionAtEnd: 0,
    }));
    const result = await Effect.runPromise(
      shared ? histories(adapter, ref.externalSessionId, work) : work,
    );
    assert.equal(result.history.length, 128);
    repairedHistories++;
    deliveryBytes += bytes(JSON.stringify(shared ? result : result.history));
  };
  const replacement = scenario === "host_replacement" || scenario === "runtime_replacement";
  if (!replacement) await initialize();
  nativeCalls = 0;
  durableHostReads = 0;
  const stream = new BufferedHostEventStream(256);
  const frames: string[] = [];
  const emit = (envelope: HostEventEnvelope) => {
    parseHostEventEnvelope(envelope);
    frames.push(JSON.stringify(envelope));
    stream.emit(envelope, (cause) => {
      throw cause;
    });
  };
  const transcript = (index: number): HostEventEnvelope => ({
    channel: "openducktor://agent-session-live-event",
    payload: {
      type: "transcript_event",
      event: {
        type: "assistant_message",
        externalSessionId: roots[0]!.externalSessionId,
        sessionRef: roots[0]!,
        messageId: `message-${index}`,
        message: "x".repeat(1024),
        timestamp: now(),
      },
    },
  });
  const eventCount = scenario === "transcript_overflow" ? 512 : 8;
  if (!replacement && scenario !== "additional_browsers") {
    for (let index = 0; index < eventCount; index++) emit(transcript(index));
    if (scenario === "other_channel_overflow")
      for (let index = 0; index < 1024; index++)
        emit({
          channel: "openducktor://run-event",
          payload: { index, data: "t".repeat(1024) },
        });
  }
  const startedAt = performance.now();
  const observers = replacement || scenario === "additional_browsers" ? 8 : 1;
  const replay = stream.replayAfterWithDiagnostics(
    `${replacement ? "00000000-0000-0000-0000-000000000000" : stream.hostEpoch}:0`,
  );
  const legacyLost = frames.length > 256;
  await Promise.all(
    Array.from({ length: observers }, async () => {
      if (!shared || replacement || scenario === "additional_browsers") {
        await initialize();
        deliveryBytes += bytes(JSON.stringify({ type: "snapshot", repoPath, sessions: snapshots }));
      }
      if (shared) {
        deliveryBytes += bytes(JSON.stringify(replay.boundary));
        deliveryBytes += replay.events.reduce((sum, frame) => sum + bytes(frame.payload), 0);
      } else {
        deliveryBytes += frames.slice(-256).reduce((sum, frame) => sum + bytes(frame), 0);
      }
      const affected = replacement
        ? roots
        : shared
          ? replay.boundary.losses.flatMap((loss) =>
              loss.facet === "transcript" ? (loss.refs ?? roots) : [],
            )
          : legacyLost
            ? roots
            : [];
      const unique = new Map(affected.map((ref) => [ref.externalSessionId, ref]));
      for (const ref of unique.values()) await readHistory(ref);
    }),
  );
  const result = {
    nativeCalls,
    durableHostReads,
    deliveryBytes,
    elapsedMs: Number((performance.now() - startedAt).toFixed(3)),
    repairedHistories,
  };
  await Effect.runPromise(owner.release(adapter));
  await Effect.runPromise(adapter.binding.closeRecoveryScopes);
  return result;
};

const measureRemoteRecovery = async () => {
  const scenarios: Scenario[] = [
    "brief_disconnect",
    "transcript_overflow",
    "other_channel_overflow",
    "additional_browsers",
    "host_replacement",
    "runtime_replacement",
  ];
  const measurements = [];
  for (const scenario of scenarios)
    measurements.push({
      scenario,
      before: await measure(scenario, false),
      after: await measure(scenario, true),
    });
  for (const row of measurements) {
    if (
      row.scenario === "brief_disconnect" ||
      row.scenario === "other_channel_overflow" ||
      row.scenario === "additional_browsers"
    ) {
      assert.equal(row.after.nativeCalls, 0);
      assert.equal(row.after.durableHostReads, 0);
      if (row.scenario !== "additional_browsers")
        assert.ok(row.after.deliveryBytes < row.before.deliveryBytes);
    }
    if (row.scenario === "transcript_overflow") {
      assert.equal(row.after.nativeCalls, 2);
      assert.equal(row.before.repairedHistories, 8);
      assert.equal(row.after.repairedHistories, 1);
      assert.ok(row.after.deliveryBytes < row.before.deliveryBytes);
    }
    if (row.scenario === "other_channel_overflow") assert.equal(row.after.repairedHistories, 0);
    if (row.scenario.endsWith("replacement")) {
      assert.equal(row.before.nativeCalls, row.after.nativeCalls * 8);
      assert.equal(row.after.durableHostReads, 3);
    }
  }
  return {
    command: "bun run packages/host/scripts/measure-remote-recovery.ts",
    fixture: {
      registeredRoots: 8,
      ownedChildren: 8,
      observersOnAttachmentOrReplacement: 8,
      historyRowsPerRoot: 128,
      textBytesPerRow: 1024,
      nativeDelayMs: 1,
      replayCapacityPerBucket: 256,
    },
    method: [
      "Native calls execute production OpenCode snapshot, context, and history readers against an SDK fixture. Current initialization, shared history ownership, and replay retention use production implementations.",
      "Durable reads count the three mocked repository read boundaries per reconstruction. SQLite and filesystem time are excluded.",
      "Delivery bytes count serialized application payloads for each observer, including replay boundaries, snapshots, and repaired histories. HTTP/SSE framing, TLS, compression, and network latency are excluded.",
      "Elapsed time starts after event emission and warm initialization. It ends after all observers receive their repair results. It includes native fixture delay and serialization. This is not a deployed-host latency benchmark.",
      "Before uses the previous per-observer reconnect refresh policy and shared 256-frame retention. It uses the same owned-tree reader as a conservative comparison, rather than introducing unrelated global sessions.",
      "Replacement comparisons require full history coverage on both sides. The old numeric cursor did not reliably identify host replacement; its apparent cheap missed repair is not counted as successful recovery.",
      "Other-channel overflow uses run events on the shared host stream. Terminal output uses a separate transport and is excluded from this replay comparison.",
    ],
    measurements,
  };
};

if (import.meta.main) {
  console.log(JSON.stringify(await measureRemoteRecovery(), null, 2));
}
