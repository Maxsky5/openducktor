import { describe, expect, test } from "bun:test";
import type { TerminalCreateRequest, TerminalSummary } from "@openducktor/contracts";
import { act, render, waitFor } from "@testing-library/react";
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
});
