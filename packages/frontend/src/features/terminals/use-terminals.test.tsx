import { describe, expect, test } from "bun:test";
import type { TerminalCreateRequest, TerminalSummary } from "@openducktor/contracts";
import { act, render, waitFor } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { QueryProvider } from "@/lib/query-provider";
import { createUnavailableShellBridge } from "@/lib/shell-bridge";
import { useTerminals } from "./use-terminals";

describe("useTerminals", () => {
  test("manages terminals for a non-task scope", async () => {
    const unavailable = createUnavailableShellBridge();
    const terminals: TerminalSummary[] = [];
    const listFilters: string[] = [];
    const createRequests: TerminalCreateRequest[] = [];
    const dependencies: NonNullable<Parameters<typeof useTerminals>[1]> = {
      hostClient: {
        ...unavailable.client,
        systemGetPlatform: async () => "darwin",
        terminalList: async ({ filter }) => {
          listFilters.push(filter.kind);
          return { hostInstanceId: "host-1", terminals: [...terminals] };
        },
        terminalCreate: async (request) => {
          createRequests.push(request);
          const summary: TerminalSummary = {
            terminalId: "terminal-free-chat",
            label: request.workingDir,
            context: request.context,
            initialWorkingDir: request.workingDir,
            createdAt: "2026-07-19T00:00:00.000Z",
            lifecycle: "running",
            exit: null,
          };
          terminals.push(summary);
          return { ref: { terminalId: summary.terminalId }, summary };
        },
      },
      terminalBridge: {
        connect: async (_onFrame, onStateChange) => {
          onStateChange("connected");
          return { send: async () => undefined, close: () => undefined };
        },
      },
    };
    let latest: ReturnType<typeof useTerminals> | null = null;
    const getLatest = (): ReturnType<typeof useTerminals> => {
      if (!latest) throw new Error("Terminal hook result is not ready.");
      return latest;
    };
    const Harness = () => {
      latest = useTerminals(
        {
          scope: {
            key: "free-chat:chat-1",
            context: {},
            workingDirectory: "/repo",
            workingDirectoryError: "The chat working directory is unavailable.",
          },
          mountedScopeKeys: ["free-chat:chat-1"],
        },
        dependencies,
      );
      return null;
    };
    const view = render(
      <QueryProvider useIsolatedClient>
        <Harness />
      </QueryProvider>,
    );

    try {
      await waitFor(() => expect(getLatest().isLoading).toBe(false));
      expect(listFilters).toEqual(["unassociated"]);

      act(() => getLatest().onCreate());

      await waitFor(() => expect(getLatest().tabs[0]?.terminalId).toBe("terminal-free-chat"));
      expect(createRequests).toEqual([{ workingDir: "/repo", context: {} }]);
    } finally {
      view.unmount();
    }
  });

  test("commits the terminal consumer once when the scope changes", async () => {
    const unavailable = createUnavailableShellBridge();
    const dependencies: NonNullable<Parameters<typeof useTerminals>[1]> = {
      hostClient: {
        ...unavailable.client,
        systemGetPlatform: async () => "darwin",
        terminalList: async () => ({ hostInstanceId: "host-1", terminals: [] }),
      },
      terminalBridge: {
        connect: async (_onFrame, onStateChange) => {
          onStateChange("connected");
          return { send: async () => undefined, close: () => undefined };
        },
      },
    };
    let consumerCommits = 0;
    let latest: ReturnType<typeof useTerminals> | null = null;
    const getLatest = (): ReturnType<typeof useTerminals> => {
      if (!latest) throw new Error("Terminal hook result is not ready.");
      return latest;
    };
    const TerminalConsumer = () => {
      useLayoutEffect(() => {
        consumerCommits += 1;
      });
      return null;
    };
    const Harness = ({ scopeKey }: { scopeKey: string }) => {
      latest = useTerminals(
        {
          scope: {
            key: scopeKey,
            context: {},
            workingDirectory: "/repo",
            workingDirectoryError: "The working directory is unavailable.",
          },
          mountedScopeKeys: [scopeKey],
        },
        dependencies,
      );
      return <TerminalConsumer />;
    };
    const view = render(
      <QueryProvider useIsolatedClient>
        <Harness scopeKey="scope-a" />
      </QueryProvider>,
    );

    try {
      await waitFor(() => expect(getLatest().isLoading).toBe(false));
      view.rerender(
        <QueryProvider useIsolatedClient>
          <Harness scopeKey="scope-b" />
        </QueryProvider>,
      );
      view.rerender(
        <QueryProvider useIsolatedClient>
          <Harness scopeKey="scope-a" />
        </QueryProvider>,
      );
      consumerCommits = 0;

      view.rerender(
        <QueryProvider useIsolatedClient>
          <Harness scopeKey="scope-b" />
        </QueryProvider>,
      );

      expect(getLatest().scopeKey).toBe("scope-b");
      expect(consumerCommits).toBe(1);
    } finally {
      view.unmount();
    }
  });
});
