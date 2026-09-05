import { expect, mock, test } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { createQueryClient } from "@/lib/query-client";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { taskWorktreeQueryOptions } from "@/state/queries/build-runtime";
import { ChatFileLinkProvider, type ChatFileLinkOwner } from "./agent-chat-file-link-context";
import { AgentChatMarkdownRenderer } from "./agent-chat-markdown-renderer";

enableReactActEnvironment();

test("links use each Task's Build Worktree", async () => {
  const client = createQueryClient();
  const onSelectFile = mock(() => {});
  const content = (taskId: string) => (
    <QueryClientProvider client={client}>
      <ChatFileLinkProvider owner={{ repoPath: "/repo", taskId, ownerKey: taskId, onSelectFile }}>
        <AgentChatMarkdownRenderer markdown="[file](src/app.ts:42)" />
      </ChatFileLinkProvider>
    </QueryClientProvider>
  );
  for (const taskId of ["a", "b"])
    client.setQueryData(taskWorktreeQueryOptions({ repoPath: "/repo", taskId }).queryKey, () => ({
      workingDirectory: `/repo/${taskId}`,
    }));
  const view = render(content("a"));
  try {
    expect(onSelectFile).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole("link"));
    await waitFor(() =>
      expect(onSelectFile).toHaveBeenLastCalledWith({
        rootPath: "/repo/a",
        relativePath: "src/app.ts",
      }),
    );
    view.rerender(content("b"));
    fireEvent.click(view.getByRole("link"));
    await waitFor(() =>
      expect(onSelectFile).toHaveBeenLastCalledWith({
        rootPath: "/repo/b",
        relativePath: "src/app.ts",
      }),
    );
  } finally {
    view.unmount();
    client.clear();
  }
});

for (const departure of ["session", "task", "repository", "close"] as const) {
  test(`late worktree resolution cannot select after ${departure} departure`, async () => {
    const client = createQueryClient();
    const deferred = Promise.withResolvers<{ workingDirectory: string }>();
    const options = taskWorktreeQueryOptions({
      repoPath: "/repo",
      taskId: "a",
      hostClient: { taskWorktreeGet: () => deferred.promise },
    });
    const pending = client.fetchQuery(options);
    const onSelectFile = mock(() => {});
    const owner: ChatFileLinkOwner = {
      repoPath: "/repo",
      taskId: "a",
      ownerKey: "session-a",
      onSelectFile,
    };
    const content = (value: ChatFileLinkOwner) => (
      <QueryClientProvider client={client}>
        <ChatFileLinkProvider owner={value}>
          <AgentChatMarkdownRenderer markdown="[file](src/a.ts)" />
        </ChatFileLinkProvider>
      </QueryClientProvider>
    );
    const view = render(content(owner));
    try {
      fireEvent.click(view.getByRole("link"));
      if (departure === "close") view.unmount();
      else
        view.rerender(
          content({
            ...owner,
            ...(departure === "session"
              ? { ownerKey: "session-b" }
              : departure === "task"
                ? { taskId: "b" }
                : { repoPath: "/other" }),
          }),
        );
      await act(async () => {
        deferred.resolve({ workingDirectory: "/repo/a" });
        await pending;
      });
      expect(onSelectFile).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      client.clear();
    }
  });
}
