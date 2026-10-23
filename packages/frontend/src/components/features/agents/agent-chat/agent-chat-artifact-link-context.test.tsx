import { expect, mock, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import type { TaskArtifactCollection } from "@openducktor/contracts";
import { artifactQueryKeys } from "@openducktor/frontend-core/queries/artifacts";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import type { PropsWithChildren } from "react";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { QueryProvider } from "@/test-utils/query-provider";
import {
  type ChatArtifactLinkOwner,
  useChatArtifactLinkAction,
} from "./agent-chat-artifact-link-context";
import { ChatArtifactLinkProvider } from "./agent-chat-artifact-link-provider";

enableReactActEnvironment();

const createCollection = (): TaskArtifactCollection => ({
  canManageFree: false,
  artifacts: [
    {
      classification: "free",
      artifactId: "another-artifact",
      taskId: "task-1",
      code: "other",
      name: "Notes",
      revision: 1,
      updatedAt: null,
      fileName: "other.txt",
      mediaType: "text/plain",
      byteSize: 5,
    },
    {
      classification: "free",
      artifactId: "internal-artifact-id",
      taskId: "task-1",
      code: "notes",
      name: "Notes",
      revision: 2,
      updatedAt: null,
      fileName: "notes.txt",
      mediaType: "text/plain",
      byteSize: 5,
    },
  ],
});

for (const cached of [true, false]) {
  test(`artifact links resolve the exact code without edit permission; cached=${cached}`, async () => {
    const list = mock(async () => createCollection());
    const connection = createTestClientConnection({ client: { taskArtifactsList: list } });
    const client = connection.queryClient;
    if (cached) {
      client.setQueryData(artifactQueryKeys.collection("/repo", "task-1"), createCollection());
    }
    const onOpenArtifact = mock<ChatArtifactLinkOwner["onOpenArtifact"]>(() => {});
    const view = renderHook(useChatArtifactLinkAction, {
      wrapper: ({ children }: PropsWithChildren) => (
        <QueryProvider connection={connection}>
          <ChatArtifactLinkProvider
            owner={{ repoPath: "/repo", taskId: "task-1", ownerKey: "session-1", onOpenArtifact }}
          >
            {children}
          </ChatArtifactLinkProvider>
        </QueryProvider>
      ),
    });
    try {
      expect(list).not.toHaveBeenCalled();
      await act(async () => view.result.current?.({ taskId: "task-1", code: "notes" }));
      expect(onOpenArtifact.mock.calls).toEqual([["internal-artifact-id"]]);
      expect(list).toHaveBeenCalledTimes(cached ? 0 : 1);
    } finally {
      view.unmount();
      client.clear();
    }
  });
}

for (const failure of ["task-mismatch", "removed", "read-failed"] as const) {
  test(`artifact links expose ${failure} without selecting another artifact`, async () => {
    const list = mock(async () => {
      throw new Error("Artifact metadata is unavailable.");
    });
    const connection = createTestClientConnection({ client: { taskArtifactsList: list } });
    const client = connection.queryClient;
    if (failure !== "read-failed") {
      const collection = createCollection();
      if (failure === "removed") collection.artifacts.splice(1, 1);
      client.setQueryData(artifactQueryKeys.collection("/repo", "task-1"), collection);
    }
    const onOpenArtifact = mock<ChatArtifactLinkOwner["onOpenArtifact"]>(() => {});
    const view = renderHook(useChatArtifactLinkAction, {
      wrapper: ({ children }: PropsWithChildren) => (
        <QueryProvider connection={connection}>
          <ChatArtifactLinkProvider
            owner={{ repoPath: "/repo", taskId: "task-1", ownerKey: "session-1", onOpenArtifact }}
          >
            {children}
          </ChatArtifactLinkProvider>
        </QueryProvider>
      ),
    });
    try {
      let error: unknown;
      await act(async () => {
        try {
          await view.result.current?.({
            taskId: failure === "task-mismatch" ? "task-2" : "task-1",
            code: "notes",
          });
        } catch (cause) {
          error = cause;
        }
      });
      const messages = {
        "task-mismatch": "This artifact belongs to another task. Open that task to view it.",
        removed: "This artifact is no longer available. Open the Artifacts panel to review it.",
        "read-failed": "Artifact metadata is unavailable.",
      };
      expect(error).toEqual(new Error(messages[failure]));
      expect(onOpenArtifact).not.toHaveBeenCalled();
      expect(list).toHaveBeenCalledTimes(failure === "read-failed" ? 1 : 0);
    } finally {
      view.unmount();
      client.clear();
    }
  });
}

for (const departure of ["session", "task", "repository", "close"] as const) {
  for (const fails of [false, true]) {
    test(`late artifact resolution has no effect after ${departure}; fails=${fails}`, async () => {
      const deferred = Promise.withResolvers<TaskArtifactCollection>();
      const connection = createTestClientConnection({
        client: { taskArtifactsList: () => deferred.promise },
      });
      const client = connection.queryClient;
      const onOpenArtifact = mock<ChatArtifactLinkOwner["onOpenArtifact"]>(() => {});
      let owner: ChatArtifactLinkOwner = {
        repoPath: "/repo",
        taskId: "task-1",
        ownerKey: "session-1",
        onOpenArtifact,
      };
      const view = renderHook(useChatArtifactLinkAction, {
        wrapper: ({ children }: PropsWithChildren) => (
          <QueryProvider connection={connection}>
            <ChatArtifactLinkProvider owner={owner}>{children}</ChatArtifactLinkProvider>
          </QueryProvider>
        ),
      });
      try {
        const open = view.result.current?.({ taskId: "task-1", code: "notes" });
        if (departure === "close") view.unmount();
        else {
          owner = { ...owner };
          if (departure === "session") owner.ownerKey = "session-2";
          if (departure === "task") owner.taskId = "task-2";
          if (departure === "repository") owner.repoPath = "/another-repo";
          view.rerender();
        }
        await act(async () => {
          if (fails) deferred.reject(new Error("Old artifact read failed."));
          else deferred.resolve(createCollection());
          await open;
        });
        expect(onOpenArtifact).not.toHaveBeenCalled();
      } finally {
        view.unmount();
        client.clear();
      }
    });
  }
}

test("artifact navigation stays absent outside its task provider", () => {
  const view = renderHook(useChatArtifactLinkAction);
  try {
    expect(view.result.current).toBeNull();
  } finally {
    view.unmount();
  }
});

test("a pending artifact read uses the current panel action for the same owner", async () => {
  const deferred = Promise.withResolvers<TaskArtifactCollection>();
  const connection = createTestClientConnection({
    client: { taskArtifactsList: () => deferred.promise },
  });
  const previousAction = mock<ChatArtifactLinkOwner["onOpenArtifact"]>(() => {});
  const currentAction = mock<ChatArtifactLinkOwner["onOpenArtifact"]>(() => {});
  let onOpenArtifact = previousAction;
  const view = renderHook(useChatArtifactLinkAction, {
    wrapper: ({ children }: PropsWithChildren) => (
      <QueryProvider connection={connection}>
        <ChatArtifactLinkProvider
          owner={{ repoPath: "/repo", taskId: "task-1", ownerKey: "session-1", onOpenArtifact }}
        >
          {children}
        </ChatArtifactLinkProvider>
      </QueryProvider>
    ),
  });
  try {
    const open = view.result.current?.({ taskId: "task-1", code: "notes" });
    onOpenArtifact = currentAction;
    view.rerender();
    await act(async () => {
      deferred.resolve(createCollection());
      await open;
    });
    expect(previousAction).not.toHaveBeenCalled();
    expect(currentAction.mock.calls).toEqual([["internal-artifact-id"]]);
  } finally {
    view.unmount();
    connection.queryClient.clear();
  }
});
