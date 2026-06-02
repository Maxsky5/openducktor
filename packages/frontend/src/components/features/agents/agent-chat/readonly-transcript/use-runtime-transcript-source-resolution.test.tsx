import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR, type RuntimeInstanceSummary } from "@openducktor/contracts";
import type { PropsWithChildren, ReactElement } from "react";
import { QueryProvider } from "@/lib/query-provider";
import { host } from "@/state/operations/host";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import type { RuntimeSessionTranscriptSource } from "./runtime-session-transcript-source";
import { useRuntimeTranscriptSourceResolution } from "./use-runtime-transcript-source-resolution";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type HookArgs = Parameters<typeof useRuntimeTranscriptSourceResolution>[0];

const wrapper = ({ children }: PropsWithChildren): ReactElement => (
  <QueryProvider useIsolatedClient>{children}</QueryProvider>
);

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useRuntimeTranscriptSourceResolution, initialProps, { wrapper });

const createSource = (
  overrides: Partial<RuntimeSessionTranscriptSource> = {},
): RuntimeSessionTranscriptSource => ({
  runtimeKind: "opencode",
  runtimeId: "runtime-1",
  workingDirectory: "/repo-a",
  ...overrides,
});

const createRuntime = (overrides: Partial<RuntimeInstanceSummary> = {}): RuntimeInstanceSummary =>
  ({
    kind: "opencode",
    runtimeId: "runtime-1",
    repoPath: "/repo-a",
    taskId: null,
    role: "workspace",
    workingDirectory: "/repo-a",
    runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
    startedAt: "2026-02-22T11:59:00.000Z",
    descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
    ...overrides,
  }) as RuntimeInstanceSummary;

let originalRuntimeList: typeof host.runtimeList;

describe("useRuntimeTranscriptSourceResolution", () => {
  beforeAll(() => {
    originalRuntimeList = host.runtimeList;
  });

  afterEach(() => {
    host.runtimeList = originalRuntimeList;
  });

  test("does not query runtimes when no transcript source is selected", async () => {
    const runtimeList = mock(async () => [createRuntime()]);
    host.runtimeList = runtimeList;
    const harness = createHookHarness({
      isOpen: true,
      workspaceRepoPath: "/repo-a",
      source: null,
    });

    try {
      await harness.mount();

      expect(harness.getLatest()).toEqual({ isPending: false, error: null, runtimeId: null });
      expect(runtimeList).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });

  test("does not query runtimes when a transcript source is selected but lookup is disabled", async () => {
    const runtimeList = mock(async () => [createRuntime()]);
    host.runtimeList = runtimeList;
    const harness = createHookHarness({
      isOpen: false,
      workspaceRepoPath: "/repo-a",
      source: createSource(),
    });

    try {
      await harness.mount();

      expect(harness.getLatest()).toEqual({ isPending: false, error: null, runtimeId: null });
      expect(runtimeList).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });

  test("resolves the matching live runtime id", async () => {
    const runtimeList = mock(async () => [createRuntime()]);
    host.runtimeList = runtimeList;
    const harness = createHookHarness({
      isOpen: true,
      workspaceRepoPath: "/repo-a",
      source: createSource(),
    });

    try {
      await harness.mount();
      await harness.waitFor((state) => !state.isPending);

      expect(runtimeList).toHaveBeenCalledWith("/repo-a", "opencode");
      expect(harness.getLatest()).toEqual({
        isPending: false,
        error: null,
        runtimeId: "runtime-1",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("resolves runtime id by working directory when source has no runtime id", async () => {
    const runtimeList = mock(async () => [createRuntime({ runtimeId: "runtime-planner" })]);
    host.runtimeList = runtimeList;
    const { runtimeId: _runtimeId, ...sourceWithoutRuntimeId } = createSource();
    const harness = createHookHarness({
      isOpen: true,
      workspaceRepoPath: "/repo-a",
      source: sourceWithoutRuntimeId,
    });

    try {
      await harness.mount();
      await harness.waitFor((state) => !state.isPending);

      expect(runtimeList).toHaveBeenCalledWith("/repo-a", "opencode");
      expect(harness.getLatest()).toEqual({
        isPending: false,
        error: null,
        runtimeId: "runtime-planner",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("surfaces missing and ambiguous runtime attachments", async () => {
    const runtimeList = mock(async () => [createRuntime({ runtimeId: "runtime-other" })]);
    host.runtimeList = runtimeList;
    const harness = createHookHarness({
      isOpen: true,
      workspaceRepoPath: "/repo-a",
      source: createSource(),
    });

    try {
      await harness.mount();
      await harness.waitFor((state) => state.error !== null);
      expect(harness.getLatest().error).toBe(
        "No opencode runtime instance is attached for runtime-1.",
      );

      runtimeList.mockImplementationOnce(async () => [createRuntime(), createRuntime()]);
      await harness.update({
        isOpen: true,
        workspaceRepoPath: "/repo-b",
        source: createSource(),
      });
      await harness.waitFor((state) => state.error?.startsWith("Multiple") === true);

      expect(harness.getLatest().error).toBe(
        "Multiple opencode runtime instances are attached for runtime-1.",
      );
    } finally {
      await harness.unmount();
    }
  });

  test("keeps runtime registry errors distinct from missing runtimes", async () => {
    const runtimeList = mock(async () => {
      throw new Error("runtime registry unavailable");
    });
    host.runtimeList = runtimeList;
    const harness = createHookHarness({
      isOpen: true,
      workspaceRepoPath: "/repo-a",
      source: createSource(),
    });

    try {
      await harness.mount();
      await harness.waitFor((state) => state.error !== null);

      expect(harness.getLatest()).toEqual({
        isPending: false,
        error: "runtime registry unavailable",
        runtimeId: null,
      });
    } finally {
      await harness.unmount();
    }
  });
});
