import { describe, expect, mock, test } from "bun:test";
import type { AgentEnginePort } from "@openducktor/core";
import { createLiveSessionTruthFixture } from "../test-utils";
import { liveAgentSessionLookupKey } from "./live-agent-session-cache";
import { LiveAgentSessionStore } from "./live-agent-session-store";
import { createLiveSessionTruthSource } from "./live-session-truth-source";

type ListLiveSessionTruthsInput = Parameters<AgentEnginePort["listLiveSessionTruths"]>[0];
type ReadLiveSessionTruthInput = Parameters<AgentEnginePort["readLiveSessionTruth"]>[0];

const createTruth = (externalSessionId: string, title = `Session ${externalSessionId}`) =>
  createLiveSessionTruthFixture({ ref: { externalSessionId }, snapshot: { title } });

describe("live-session-truth-source", () => {
  test("prefers stored truth before preloaded, scanned, or direct reads", async () => {
    const storedTruth = createTruth("external-1", "Stored Session");
    const preloadedTruth = createTruth("external-1", "Preloaded Session");
    const scannedTruth = createTruth("external-1", "Scanned Session");
    const directTruth = createTruth("external-1", "Direct Session");
    const store = new LiveAgentSessionStore();
    store.replaceRepoTruths(
      "/tmp/repo",
      new Map([
        [liveAgentSessionLookupKey("/tmp/repo", "opencode", "/tmp/repo/worktree"), [storedTruth]],
      ]),
    );
    const listLiveSessionTruths = mock(async () => [scannedTruth]);
    const readLiveSessionTruth = mock(async () => directTruth);
    const source = createLiveSessionTruthSource({
      adapter: { listLiveSessionTruths, readLiveSessionTruth },
      liveAgentSessionStore: store,
      preloadedLiveAgentSessionsByKey: new Map([
        [
          liveAgentSessionLookupKey("/tmp/repo", "opencode", "/tmp/repo/worktree"),
          [preloadedTruth],
        ],
      ]),
    });

    const truth = await source.read(storedTruth.ref);

    expect(truth).toBe(storedTruth);
    expect(listLiveSessionTruths).not.toHaveBeenCalled();
    expect(readLiveSessionTruth).not.toHaveBeenCalled();
  });

  test("reads preloaded truth without requiring a scan adapter", async () => {
    const preloadedTruth = createTruth("external-1");
    const source = createLiveSessionTruthSource({
      adapter: {},
      preloadedLiveAgentSessionsByKey: new Map([
        [
          liveAgentSessionLookupKey("/tmp/repo", "opencode", "/tmp/repo/worktree"),
          [preloadedTruth],
        ],
      ]),
    });

    await expect(source.read(preloadedTruth.ref)).resolves.toBe(preloadedTruth);
  });

  test("scans the requested working directory before direct reads", async () => {
    const scannedTruth = createTruth("external-1");
    const scanInputs: ListLiveSessionTruthsInput[] = [];
    const listLiveSessionTruths = mock(async (input: ListLiveSessionTruthsInput) => {
      scanInputs.push(input);
      return [scannedTruth];
    });
    const readLiveSessionTruth = mock(async (_input: ReadLiveSessionTruthInput) =>
      createTruth("external-2"),
    );
    const source = createLiveSessionTruthSource({
      adapter: { listLiveSessionTruths, readLiveSessionTruth },
    });

    const truth = await source.read(scannedTruth.ref);

    expect(truth).toBe(scannedTruth);
    expect(scanInputs).toEqual([
      {
        repoPath: "/tmp/repo",
        runtimeKind: "opencode",
        directories: ["/tmp/repo/worktree"],
      },
    ]);
    expect(readLiveSessionTruth).not.toHaveBeenCalled();
  });

  test("uses direct truth reads after a cache miss", async () => {
    const directTruth = createTruth("external-1");
    const readInputs: ReadLiveSessionTruthInput[] = [];
    const listLiveSessionTruths = mock(async () => []);
    const readLiveSessionTruth = mock(async (input: ReadLiveSessionTruthInput) => {
      readInputs.push(input);
      return directTruth;
    });
    const source = createLiveSessionTruthSource({
      adapter: { listLiveSessionTruths, readLiveSessionTruth },
    });

    const truth = await source.read(directTruth.ref);

    expect(truth).toBe(directTruth);
    expect(readInputs).toEqual([directTruth.ref]);
  });

  test("fails fast when no source can read the requested truth", async () => {
    const source = createLiveSessionTruthSource({ adapter: {} });

    await expect(source.read(createTruth("external-1").ref)).rejects.toThrow(
      "Live session truth reads are unavailable for session hydration.",
    );
  });
});
