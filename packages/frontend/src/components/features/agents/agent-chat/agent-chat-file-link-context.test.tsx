import { expect, mock, test } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { createQueryClient } from "@/lib/query-client";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { taskWorktreeQueryOptions } from "@/state/queries/build-runtime";
import { ChatFileLinkProvider, type ChatFileLinkOwner } from "./agent-chat-file-link-context";
import {
  chatFileLinkSuffixes,
  validChatFileDestinations,
  invalidChatFileDestinations,
} from "./agent-chat-file-link.test-fixtures";
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

for (const [href, workingDirectory, message] of invalidChatFileDestinations) {
  test(`malformed destination reports its target and cause: ${href}`, async () => {
    const { spyOn } = await import("bun:test");
    const { toast } = await import("sonner");
    const external = await import("@/lib/open-external-url");
    const error = spyOn(toast, "error").mockReturnValue("error");
    const openExternal = spyOn(external, "openExternalUrl").mockResolvedValue();
    const client = createQueryClient();
    client.setQueryData(
      taskWorktreeQueryOptions({ repoPath: "/repo", taskId: "a" }).queryKey,
      () => ({ workingDirectory }),
    );
    const onSelectFile = mock(() => {});
    const view = render(
      <QueryClientProvider client={client}>
        <ChatFileLinkProvider
          owner={{ repoPath: "/repo", taskId: "a", ownerKey: "main", onSelectFile }}
        >
          <AgentChatMarkdownRenderer markdown={`[file](${href})`} />
        </ChatFileLinkProvider>
      </QueryClientProvider>,
    );
    try {
      await act(async () => fireEvent.click(view.getByRole("link")));
      expect(error).toHaveBeenCalledWith(`Cannot open file: ${href}`, { description: message });
      expect(error).toHaveBeenCalledTimes(1);
      expect(onSelectFile).not.toHaveBeenCalled();
      expect(openExternal).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      client.clear();
      error.mockRestore();
      openExternal.mockRestore();
    }
  });
}

for (const failure of ["missing-task", "absent-worktree", "rejected-worktree"] as const) {
  test(`unavailable worktree reports the cause without selecting another root: ${failure}`, async () => {
    const { spyOn } = await import("bun:test");
    const { toast } = await import("sonner");
    const error = spyOn(toast, "error").mockReturnValue("error");
    const client = createQueryClient();
    const taskId = failure === "missing-task" ? null : "a";
    const options = taskWorktreeQueryOptions({
      repoPath: "/repo",
      taskId: "a",
      hostClient: {
        taskWorktreeGet: async () => {
          throw new Error("Worktree lookup timed out");
        },
      },
    });
    if (failure === "absent-worktree") client.setQueryData(options.queryKey, () => null);
    let pending: Promise<unknown> | undefined;
    if (failure === "rejected-worktree")
      pending = client.fetchQuery(options).catch(() => undefined);
    const onSelectFile = mock(() => {});
    const view = render(
      <QueryClientProvider client={client}>
        <ChatFileLinkProvider owner={{ repoPath: "/repo", taskId, ownerKey: "main", onSelectFile }}>
          <AgentChatMarkdownRenderer markdown="[file](src/file.ts)" />
        </ChatFileLinkProvider>
      </QueryClientProvider>,
    );
    try {
      fireEvent.click(view.getByRole("link"));
      await pending;
      await waitFor(() =>
        expect(error).toHaveBeenCalledWith("Cannot open file: src/file.ts", {
          description:
            failure === "rejected-worktree"
              ? "Worktree lookup timed out"
              : "The Task's Build Worktree is unavailable.",
        }),
      );
      expect(onSelectFile).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      client.clear();
      error.mockRestore();
    }
  });
}

for (const departure of ["session", "task", "repository", "close"] as const) {
  test(`late worktree failure is silent after ${departure}`, async () => {
    const { spyOn } = await import("bun:test");
    const { toast } = await import("sonner");
    const error = spyOn(toast, "error").mockReturnValue("error");
    const client = createQueryClient();
    const deferred = Promise.withResolvers<null>();
    const options = taskWorktreeQueryOptions({
      repoPath: "/repo",
      taskId: "a",
      hostClient: { taskWorktreeGet: () => deferred.promise },
    });
    const pending = client.fetchQuery(options).catch(() => undefined);
    const onSelectFile = mock(() => {});
    const owner: ChatFileLinkOwner = {
      repoPath: "/repo",
      taskId: "a",
      ownerKey: "main",
      onSelectFile,
    };
    const content = (value: ChatFileLinkOwner) => (
      <QueryClientProvider client={client}>
        <ChatFileLinkProvider owner={value}>
          <AgentChatMarkdownRenderer markdown="[file](src/file.ts)" />
        </ChatFileLinkProvider>
      </QueryClientProvider>
    );
    const view = render(content(owner));
    try {
      fireEvent.click(view.getByRole("link"));
      if (departure === "close") view.unmount();
      else {
        const next = { ...owner };
        if (departure === "session") next.ownerKey = "child";
        if (departure === "task") next.taskId = "b";
        if (departure === "repository") next.repoPath = "/other";
        view.rerender(content(next));
      }
      await act(async () => {
        deferred.reject(new Error("Old lookup failed"));
        await pending;
      });
      expect(error).not.toHaveBeenCalled();
      expect(onSelectFile).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      client.clear();
      error.mockRestore();
    }
  });
}

for (const [path, rootPath, relativePath] of validChatFileDestinations) {
  for (const suffix of chatFileLinkSuffixes) {
    test(`link activation selects the exact relative path: ${path}${suffix}`, async () => {
      const { spyOn } = await import("bun:test");
      const external = await import("@/lib/open-external-url");
      const { toast } = await import("sonner");
      const error = spyOn(toast, "error").mockReturnValue("error");
      const openExternal = spyOn(external, "openExternalUrl").mockResolvedValue();
      const client = createQueryClient();
      client.setQueryData(
        taskWorktreeQueryOptions({ repoPath: "C:/repo", taskId: "a" }).queryKey,
        () => ({ workingDirectory: rootPath }),
      );
      const onSelectFile = mock(() => {});
      const view = render(
        <QueryClientProvider client={client}>
          <ChatFileLinkProvider
            owner={{ repoPath: "C:/repo", taskId: "a", ownerKey: "main", onSelectFile }}
          >
            <AgentChatMarkdownRenderer markdown={`[file](${path}${suffix})`} />
          </ChatFileLinkProvider>
        </QueryClientProvider>,
      );
      try {
        await act(async () => fireEvent.click(view.getByRole("link")));
        expect(onSelectFile).toHaveBeenCalledWith({ rootPath, relativePath });
        expect(onSelectFile).toHaveBeenCalledTimes(1);
        expect(openExternal).not.toHaveBeenCalled();
        expect(error).not.toHaveBeenCalled();
      } finally {
        view.unmount();
        client.clear();
        openExternal.mockRestore();
        error.mockRestore();
      }
    });
  }
}
