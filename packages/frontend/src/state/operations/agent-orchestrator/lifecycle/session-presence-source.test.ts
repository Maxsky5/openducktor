import { describe, expect, mock, test } from "bun:test";
import type { AgentEnginePort } from "@openducktor/core";
import { createAgentSessionPresenceSnapshotFixture } from "../test-utils";
import { agentSessionPresenceLookupKey } from "./session-presence-cache";
import { createAgentSessionPresenceSnapshotSource } from "./session-presence-source";

type ListSessionPresenceInput = Parameters<AgentEnginePort["listSessionPresence"]>[0];
type ReadSessionPresenceInput = Parameters<AgentEnginePort["readSessionPresence"]>[0];

const createPresence = (externalSessionId: string, title = `Session ${externalSessionId}`) =>
  createAgentSessionPresenceSnapshotFixture({ ref: { externalSessionId }, snapshot: { title } });

describe("session-presence-source", () => {
  test("reads preloaded snapshot without requiring a scan adapter", async () => {
    const preloadedPresence = createPresence("external-1");
    const source = createAgentSessionPresenceSnapshotSource({
      adapter: {},
      preloadedSessionPresenceByKey: new Map([
        [
          agentSessionPresenceLookupKey("/tmp/repo", "opencode", "/tmp/repo/worktree"),
          [preloadedPresence],
        ],
      ]),
    });

    await expect(source.read(preloadedPresence.ref)).resolves.toBe(preloadedPresence);
  });

  test("scans the requested working directory before direct reads", async () => {
    const scannedPresence = createPresence("external-1");
    const scanInputs: ListSessionPresenceInput[] = [];
    const listSessionPresence = mock(async (input: ListSessionPresenceInput) => {
      scanInputs.push(input);
      return [scannedPresence];
    });
    const readSessionPresence = mock(async (_input: ReadSessionPresenceInput) =>
      createPresence("external-2"),
    );
    const source = createAgentSessionPresenceSnapshotSource({
      adapter: { listSessionPresence, readSessionPresence },
    });

    const snapshot = await source.read(scannedPresence.ref);

    expect(snapshot).toBe(scannedPresence);
    expect(scanInputs).toEqual([
      {
        repoPath: "/tmp/repo",
        runtimeKind: "opencode",
        directories: ["/tmp/repo/worktree"],
      },
    ]);
    expect(readSessionPresence).not.toHaveBeenCalled();
  });

  test("treats a scanned miss as authoritative without a duplicate direct read", async () => {
    const firstRef = createPresence("external-1").ref;
    const secondRef = createPresence("external-2").ref;
    const scanInputs: ListSessionPresenceInput[] = [];
    const listSessionPresence = mock(async (input: ListSessionPresenceInput) => {
      scanInputs.push(input);
      return [];
    });
    const readSessionPresence = mock(async () => {
      throw new Error("should not repeat a directory scan through a direct read");
    });
    const source = createAgentSessionPresenceSnapshotSource({
      adapter: { listSessionPresence, readSessionPresence },
    });

    const [firstPresence, secondPresence] = await Promise.all([
      source.read(firstRef),
      source.read(secondRef),
    ]);

    expect(firstPresence.presence).toBe("stale");
    expect(firstPresence.runtimeId).toBeNull();
    expect(secondPresence.presence).toBe("stale");
    expect(scanInputs).toEqual([
      {
        repoPath: "/tmp/repo",
        runtimeKind: "opencode",
        directories: ["/tmp/repo/worktree"],
      },
    ]);
    expect(readSessionPresence).not.toHaveBeenCalled();
  });

  test("treats a preloaded empty directory as authoritative when scanning is available", async () => {
    const ref = createPresence("external-1").ref;
    const listSessionPresence = mock(async () => {
      throw new Error("should not scan an already preloaded directory");
    });
    const readSessionPresence = mock(async () => {
      throw new Error("should not directly read after an authoritative preloaded miss");
    });
    const source = createAgentSessionPresenceSnapshotSource({
      adapter: { listSessionPresence, readSessionPresence },
      preloadedSessionPresenceByKey: new Map([
        [agentSessionPresenceLookupKey("/tmp/repo", "opencode", "/tmp/repo/worktree"), []],
      ]),
    });

    const snapshot = await source.read(ref);

    expect(snapshot.presence).toBe("stale");
    expect(snapshot.runtimeId).toBeNull();
    expect(listSessionPresence).not.toHaveBeenCalled();
    expect(readSessionPresence).not.toHaveBeenCalled();
  });

  test("uses direct snapshot reads when no scan or preloaded source is available", async () => {
    const directPresence = createPresence("external-1");
    const readInputs: ReadSessionPresenceInput[] = [];
    const readSessionPresence = mock(async (input: ReadSessionPresenceInput) => {
      readInputs.push(input);
      return directPresence;
    });
    const source = createAgentSessionPresenceSnapshotSource({
      adapter: { readSessionPresence },
    });

    const snapshot = await source.read(directPresence.ref);

    expect(snapshot).toBe(directPresence);
    expect(readInputs).toEqual([directPresence.ref]);
  });

  test("fails fast when no source can read the requested snapshot", async () => {
    const source = createAgentSessionPresenceSnapshotSource({ adapter: {} });

    await expect(source.read(createPresence("external-1").ref)).rejects.toThrow(
      "Session presence reads are unavailable for session hydration.",
    );
  });
});
