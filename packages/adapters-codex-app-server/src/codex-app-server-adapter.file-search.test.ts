import { describe, expect, mock, test } from "bun:test";
import type { RuntimeInstanceSummary } from "@openducktor/contracts";
import {
  createAdapterWithTransport,
  makeRuntimeSummary,
} from "./codex-app-server-adapter.test-harness";
import type { CodexJsonRpcRequest, CodexJsonRpcTransport } from "./types";

const createTransport = (
  response: unknown,
): { calls: CodexJsonRpcRequest[]; transport: CodexJsonRpcTransport } => {
  const calls: CodexJsonRpcRequest[] = [];
  const transport: CodexJsonRpcTransport = {
    async request(request) {
      calls.push(request);
      if (request.method === "fuzzyFileSearch") {
        return response;
      }
      throw new Error(`Unexpected method '${request.method}'.`);
    },
  };
  return { calls, transport };
};

const createSearchAdapter = (
  transport: CodexJsonRpcTransport,
  runtime: RuntimeInstanceSummary = makeRuntimeSummary("runtime-search"),
) => {
  const requireRepoRuntime = mock(async ({ repoPath, runtimeKind }) => ({
    ...runtime,
    repoPath,
    kind: runtimeKind,
    runtimeId: runtime.runtimeId,
  }));
  const adapter = createAdapterWithTransport(transport, {
    repoRuntimeResolver: {
      requireRepoRuntime,
    },
  });
  return { adapter, requireRepoRuntime };
};

describe("CodexAppServerAdapter file search", () => {
  test("resolves a live Codex runtime and maps fuzzy file search results", async () => {
    const { calls, transport } = createTransport({
      files: [
        {
          root: "/repo/worktree",
          path: "src/main.ts",
          match_type: "file",
          file_name: "main.ts",
          score: 10,
          indices: [0, 1],
        },
        {
          root: "/repo/worktree",
          path: "src/components",
          match_type: "directory",
          file_name: "components",
          score: 9,
          indices: null,
        },
      ],
    });
    const { adapter, requireRepoRuntime } = createSearchAdapter(transport);

    await expect(
      adapter.searchFiles({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo/worktree",
        query: "src",
      }),
    ).resolves.toEqual([
      { id: "src/main.ts", path: "src/main.ts", name: "main.ts", kind: "code" },
      { id: "src/components", path: "src/components", name: "components", kind: "directory" },
    ]);

    expect(requireRepoRuntime).toHaveBeenCalledWith({ repoPath: "/repo", runtimeKind: "codex" });
    expect(calls).toEqual([
      {
        method: "fuzzyFileSearch",
        params: { query: "src", roots: ["/repo/worktree"], cancellationToken: null },
      },
    ]);
  });

  test("forwards empty search queries unchanged", async () => {
    const { calls, transport } = createTransport({ files: [] });
    const { adapter } = createSearchAdapter(transport);

    await expect(
      adapter.searchFiles({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo/worktree",
        query: "",
      }),
    ).resolves.toEqual([]);

    expect(calls).toEqual([
      {
        method: "fuzzyFileSearch",
        params: { query: "", roots: ["/repo/worktree"], cancellationToken: null },
      },
    ]);
  });

  test("rejects malformed fuzzy file search payloads", async () => {
    const { transport } = createTransport({
      files: [
        {
          root: "/repo/worktree",
          path: "src/link",
          match_type: "symlink",
          file_name: "link",
          score: 1,
          indices: null,
        },
      ],
    });
    const { adapter } = createSearchAdapter(transport);

    await expect(
      adapter.searchFiles({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo/worktree",
        query: "link",
      }),
    ).rejects.toThrow("Codex fuzzyFileSearch result 0 has unsupported match_type 'symlink'.");
  });

  test("propagates Codex app-server failures", async () => {
    const transport: CodexJsonRpcTransport = {
      async request() {
        throw new Error("Codex app-server unavailable");
      },
    };
    const { adapter } = createSearchAdapter(transport);

    await expect(
      adapter.searchFiles({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo/worktree",
        query: "src",
      }),
    ).rejects.toThrow("Codex app-server unavailable");
  });

  test("rejects non-Codex runtime inputs before resolving a runtime", async () => {
    const { transport } = createTransport({ files: [] });
    const { adapter, requireRepoRuntime } = createSearchAdapter(transport);

    await expect(
      adapter.searchFiles({
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
        query: "src",
      }),
    ).rejects.toThrow("Codex App Server can only search files for runtime 'codex'.");
    expect(requireRepoRuntime).not.toHaveBeenCalled();
  });
});
