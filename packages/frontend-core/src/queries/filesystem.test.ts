import "../test-support/dom-environment";
import { describe, expect, test } from "bun:test";
import type {
  WorkspaceFileTreeRefreshResult,
  WorkspaceTextFileReadResult,
  WorkspaceTextFileWriteInput,
  WorkspaceTextFileWriteResult,
} from "@openducktor/contracts";
import type { HostClient } from "@openducktor/host-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type PropsWithChildren, type ReactElement } from "react";
import { ClientConnectionProvider } from "../connection/client-connection-react";
import { createTestClientConnection } from "../test-support/test-client-connection";
import {
  filesystemQueryKeys,
  workspaceFileTreeQueryOptions,
  workspaceTextFileWriteMutationOptions,
} from "./filesystem";

const createHostWrapper = (client: Partial<HostClient>) => {
  const connection = createTestClientConnection({ client });
  return ({ children }: PropsWithChildren): ReactElement =>
    createElement(ClientConnectionProvider, { connection }, children);
};

describe("workspaceFileTreeQueryOptions", () => {
  test("passes the target branch to the filesystem tree host read", async () => {
    const inputs: Array<Parameters<HostClient["filesystemRefreshTree"]>[0]> = [];
    const { queryClient } = createTestClientConnection({
      client: {
        filesystemRefreshTree: async (
          input: Parameters<HostClient["filesystemRefreshTree"]>[0],
        ): Promise<WorkspaceFileTreeRefreshResult> => {
          inputs.push(input);
          return {
            kind: "snapshot",
            rootPath: "/repo",
            context: {
              rootPath: "/repo",
              gitDirectory: "/repo/.git",
              branch: "main",
              head: "head",
              targetBranch: "origin/main",
              targetRevision: "target",
              indexVersion: "index",
              sparsePolicy: "",
            },
            cursor: { viewId: "view", revision: 0 },
            entries: [],
          };
        },
      },
    });

    await queryClient.fetchQuery(workspaceFileTreeQueryOptions("/repo", "origin/main"));

    expect(inputs).toEqual([
      {
        rootPath: "/repo",
        targetBranch: "origin/main",
        mode: "full",
        refreshId: expect.any(String),
      },
    ]);
  });

  for (const access of [undefined, "local"] as const) {
    test(`updates the exact text cache and invalidates only the workspace tree after save, access=${access}`, async () => {
      const wrapper = createHostWrapper({
        filesystemWriteTextFile: async (
          input: WorkspaceTextFileWriteInput,
        ): Promise<WorkspaceTextFileWriteResult> => ({
          kind: "text",
          ...input,
          size: input.contents.length,
          mtimeMs: 2,
          revision: "revision-2",
        }),
      });
      const { result } = renderHook(
        () => {
          const queryClient = useQueryClient();
          return {
            queryClient,
            mutation: useMutation(workspaceTextFileWriteMutationOptions(queryClient)),
          };
        },
        { wrapper },
      );
      const input: WorkspaceTextFileWriteInput = {
        rootPath: "/repo",
        relativePath: "file.txt",
        contents: "saved",
        revision: "revision-1",
      };
      if (access) input.access = access;
      const otherFileKey = filesystemQueryKeys.textFile(
        "/repo",
        "file.txt",
        access ? undefined : "local",
      );
      const treeKey = filesystemQueryKeys.treeRoot("/repo");
      const unrelatedKey = filesystemQueryKeys.treeRoot("/other");
      act(() => {
        result.current.queryClient.setQueryData(treeKey, { rootPath: "/repo", entries: [] });
        result.current.queryClient.setQueryData(unrelatedKey, { rootPath: "/other", entries: [] });
        result.current.queryClient.setQueryData<string>(otherFileKey, "other access mode");
      });
      let saved: WorkspaceTextFileWriteResult | undefined;
      await act(async () => {
        saved = await result.current.mutation.mutateAsync(input);
      });
      await waitFor(() => expect(result.current.mutation.isSuccess).toBe(true));

      expect(
        result.current.queryClient.getQueryData<WorkspaceTextFileWriteResult>(
          filesystemQueryKeys.textFile("/repo", "file.txt", access),
        ),
      ).toEqual(saved);
      expect(result.current.queryClient.getQueryState(treeKey)?.isInvalidated).toBe(true);
      expect(result.current.queryClient.getQueryState(unrelatedKey)?.isInvalidated).toBe(false);
      expect(result.current.queryClient.getQueryData<string>(otherFileKey)).toBe(
        "other access mode",
      );
    });
  }

  test("leaves the query cache unchanged when the write fails", async () => {
    const key = filesystemQueryKeys.textFile("/repo", "file.txt");
    const baseline: WorkspaceTextFileReadResult = {
      kind: "text",
      rootPath: "/repo",
      relativePath: "file.txt",
      contents: "before",
      size: 6,
      mtimeMs: 1,
      revision: "revision-1",
    };
    const wrapper = createHostWrapper({
      filesystemWriteTextFile: async () => {
        throw new Error("The file changed after it was loaded.");
      },
    });
    const { result } = renderHook(
      () => {
        const queryClient = useQueryClient();
        return {
          queryClient,
          mutation: useMutation(workspaceTextFileWriteMutationOptions(queryClient)),
        };
      },
      { wrapper },
    );
    act(() => result.current.queryClient.setQueryData(key, baseline));

    let mutationError: unknown;
    await act(async () => {
      try {
        await result.current.mutation.mutateAsync({
          rootPath: "/repo",
          relativePath: "file.txt",
          contents: "draft",
          revision: "revision-1",
        });
      } catch (cause) {
        mutationError = cause;
      }
    });
    await waitFor(() => expect(result.current.mutation.isError).toBe(true));
    expect(mutationError).toBeInstanceOf(Error);
    if (!(mutationError instanceof Error)) throw mutationError;
    expect(mutationError.message).toBe("The file changed after it was loaded.");
    expect(result.current.queryClient.getQueryData<WorkspaceTextFileReadResult>(key)).toEqual(
      baseline,
    );
  });
});
