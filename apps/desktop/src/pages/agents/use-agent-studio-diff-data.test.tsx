import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";

enableReactActEnvironment();

const runsListMock = mock(async () => []);
const gitGetCurrentBranchMock = mock(async () => ({ name: "feature/task-10" }));
const gitGetStatusMock = mock(async () => []);
const gitGetDiffMock = mock(async () => []);
const gitCommitsAheadBehindMock = mock(async () => ({ ahead: 0, behind: 0 }));

mock.module("@/state/operations/host", () => ({
  host: {
    runsList: runsListMock,
    gitGetCurrentBranch: gitGetCurrentBranchMock,
    gitGetStatus: gitGetStatusMock,
    gitGetDiff: gitGetDiffMock,
    gitCommitsAheadBehind: gitCommitsAheadBehindMock,
  },
}));

type UseAgentStudioDiffDataHook =
  typeof import("./use-agent-studio-diff-data")["useAgentStudioDiffData"];

let useAgentStudioDiffData: UseAgentStudioDiffDataHook;

type HookArgs = Parameters<UseAgentStudioDiffDataHook>[0];

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useAgentStudioDiffData, initialProps);

const createBaseArgs = (): HookArgs => ({
  repoPath: "/repo",
  sessionWorkingDirectory: null,
  sessionRunId: null,
  defaultTargetBranch: "origin/main",
  enablePolling: false,
});

beforeAll(async () => {
  ({ useAgentStudioDiffData } = await import("./use-agent-studio-diff-data"));
});

beforeEach(() => {
  runsListMock.mockClear();
  gitGetCurrentBranchMock.mockClear();
  gitGetStatusMock.mockClear();
  gitGetDiffMock.mockClear();
  gitCommitsAheadBehindMock.mockClear();
});

describe("useAgentStudioDiffData", () => {
  test("routes diff target argument by selected diff scope", async () => {
    const harness = createHookHarness(createBaseArgs());

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetDiffMock.mock.calls.length >= 1);

      expect(harness.getLatest().diffScope).toBe("target");
      expect(gitGetDiffMock).toHaveBeenNthCalledWith(1, "/repo", "origin/main", undefined);

      await harness.run((state) => {
        state.setDiffScope("uncommitted");
      });
      await harness.waitFor(() => gitGetDiffMock.mock.calls.length >= 2);
      expect(gitGetDiffMock).toHaveBeenNthCalledWith(2, "/repo", undefined, undefined);

      await harness.run((state) => {
        state.setDiffScope("target");
      });
      await harness.waitFor(() => gitGetDiffMock.mock.calls.length >= 3);
      expect(gitGetDiffMock).toHaveBeenNthCalledWith(3, "/repo", "origin/main", undefined);
    } finally {
      await harness.unmount();
    }
  });
});
