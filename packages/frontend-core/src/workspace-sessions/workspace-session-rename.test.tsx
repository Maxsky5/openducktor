import "../test-support/dom-environment";
import { describe, expect, test } from "bun:test";
import type { WorkspaceSession } from "@openducktor/contracts";
import type { HostClient } from "@openducktor/host-client";
import type { PropsWithChildren, ReactElement } from "react";
import { act } from "react";
import { ClientConnectionProvider } from "../connection/client-connection-react";
import { workspaceSessionQueryKeys } from "../queries/workspace-sessions";
import { createHookHarness } from "../test-support/react-hook-harness";
import { createTestClientConnection } from "../test-support/test-client-connection";
import { workspaceSessionRecord } from "../test-support/workspace-session-fixtures";
import {
  canSaveWorkspaceSessionRename,
  useRenameWorkspaceSession,
  workspaceSessionRenameInitialTitle,
} from "./workspace-session-rename";

describe("workspace session rename", () => {
  test("starts from the shown title", () => {
    expect(workspaceSessionRenameInitialTitle(workspaceSessionRecord("a"))).toBe("Chat a");
    expect(
      workspaceSessionRenameInitialTitle(workspaceSessionRecord("a", { manualTitle: "Mine" })),
    ).toBe("Mine");
    expect(
      workspaceSessionRenameInitialTitle(workspaceSessionRecord("a", { generatedTitle: null })),
    ).toBe("");
  });

  test("saves only a changed name, and never twice at once", () => {
    const initialTitle = "Chat a";
    expect(
      canSaveWorkspaceSessionRename({ initialTitle, draft: " Chat a ", isPending: false }),
    ).toBe(false);
    expect(canSaveWorkspaceSessionRename({ initialTitle, draft: "Plans", isPending: false })).toBe(
      true,
    );
    expect(canSaveWorkspaceSessionRename({ initialTitle, draft: "", isPending: false })).toBe(true);
    expect(canSaveWorkspaceSessionRename({ initialTitle, draft: "Plans", isPending: true })).toBe(
      false,
    );
  });

  test("sends the name and updates the chat list", async () => {
    const before = workspaceSessionRecord("a");
    const renamed: WorkspaceSession = { ...before, manualTitle: "Plans", updatedAt: 2_000 };
    const requests: Parameters<HostClient["workspaceSessionRename"]>[0][] = [];
    const notified: WorkspaceSession[] = [];
    const connection = createTestClientConnection({
      client: {
        workspaceSessionRename: async (input) => {
          requests.push(input);
          return renamed;
        },
      },
    });
    connection.queryClient.setQueryData(workspaceSessionQueryKeys.list("alpha", false), [before]);
    const wrapper = ({ children }: PropsWithChildren): ReactElement => (
      <ClientConnectionProvider connection={connection}>{children}</ClientConnectionProvider>
    );
    const harness = createHookHarness(
      () =>
        useRenameWorkspaceSession({
          workspaceId: "alpha",
          sessionId: "a",
          onRenamed: (session) => notified.push(session),
        }),
      undefined,
      { wrapper },
    );
    await harness.mount();
    await act(async () => {
      await harness.getLatest().mutateAsync("Plans");
    });

    expect(requests).toEqual([{ workspaceId: "alpha", sessionId: "a", manualTitle: "Plans" }]);
    expect(notified).toEqual([renamed]);
    expect(
      connection.queryClient.getQueryData<WorkspaceSession[]>(
        workspaceSessionQueryKeys.list("alpha", false),
      ),
    ).toEqual([renamed]);
    await harness.unmount();
  });
});
