import "@openducktor/frontend-core/test-support/dom-environment";
import { describe, expect, test } from "bun:test";
import type { GitBranch } from "@openducktor/contracts";
import { ClientConnectionProvider } from "@openducktor/frontend-core/connection/client-connection-react";
import { createWorkspaceRecordFixture } from "@openducktor/frontend-core/test-support/shared-test-fixtures";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import { useWorkspaceRepoSettings } from "./use-workspace-repo-settings";

const main: GitBranch = { name: "main", isCurrent: true, isRemote: false };

describe("useWorkspaceRepoSettings", () => {
  test("reports a failed branch read and reads the branches again on retry", async () => {
    let reads = 0;
    const connection = createTestClientConnection({
      client: {
        gitGetBranches: async () => {
          reads += 1;
          if (reads === 1) throw new Error("Git is not installed.");
          return [main];
        },
      },
    });
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(ClientConnectionProvider, { connection }, children);
    const workspace = createWorkspaceRecordFixture({ repoPath: "/repo" });

    const { result } = renderHook(() => useWorkspaceRepoSettings(workspace), { wrapper });

    await waitFor(() => expect(result.current.branchesFailure).not.toBeNull());
    expect(result.current.branchesFailure?.message).toBe("Git is not installed.");
    expect(result.current.branches).toEqual([]);

    act(() => result.current.branchesFailure?.retry());

    await waitFor(() => expect(result.current.branches).toEqual([main]));
    expect(result.current.branchesFailure).toBeNull();
  });
});
