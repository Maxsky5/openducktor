import type { TerminalBridge } from "@openducktor/frontend-core/terminals/terminal-bridge";
import { useTaskTerminalScope } from "@openducktor/frontend-core/terminals/terminal-scopes";
import {
  type TerminalHostClient,
  type TerminalSessionsModel,
  useTerminals,
} from "@openducktor/frontend-core/terminals/use-terminals";
import { sessionPanelOwnerKey } from "@/features/session-panels";
import { getShellBridge } from "@/lib/shell-bridge";

type AgentStudioTerminalDependencies = {
  hostClient: TerminalHostClient;
  terminalBridge: TerminalBridge;
};

/** The panel layout owner key, so the panels can place the terminals of each task. */
const terminalScopeKey = (workspaceId: string, taskId: string): string =>
  sessionPanelOwnerKey({ kind: "task", workspaceId, taskId });

export const useAgentStudioTerminals = (
  {
    workspaceId,
    repoPath,
    taskId,
    taskVersion,
  }: {
    workspaceId: string | null;
    repoPath: string | null;
    taskId: string | null;
    taskVersion: string | null;
  },
  suppliedDependencies?: AgentStudioTerminalDependencies,
): TerminalSessionsModel => {
  const taskScope = useTaskTerminalScope({
    key: workspaceId !== null && taskId !== null ? terminalScopeKey(workspaceId, taskId) : null,
    repoPath,
    taskId,
    taskVersion,
  });
  return useTerminals(
    taskScope,
    suppliedDependencies ?? { terminalBridge: getShellBridge().terminals },
  );
};
