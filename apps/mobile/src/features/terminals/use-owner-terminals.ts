import {
  useTaskTerminalScope,
  workspaceSessionTerminalScope,
} from "@openducktor/frontend-core/terminals/terminal-scopes";
import {
  type TerminalSessionsModel,
  useTerminals,
} from "@openducktor/frontend-core/terminals/use-terminals";
import { useMemo } from "react";
import type { WorkOwner } from "@/features/work-owner/work-owner-context";
import { useTerminalBridge } from "./use-terminal-bridge";

/**
 * The terminals of a task or chat. Task terminals start in the task worktree, chat terminals in
 * the saved chat directory. The model and its start rules come from frontend-core, as on desktop.
 */
export const useOwnerTerminals = (owner: WorkOwner): TerminalSessionsModel => {
  const terminalBridge = useTerminalBridge();
  const { task, record } = owner;
  const taskScope = useTaskTerminalScope({
    key: task ? owner.key : null,
    repoPath: task ? owner.repoPath : null,
    taskId: task?.id ?? null,
    taskVersion: task?.updatedAt ?? null,
  });
  const workspaceId = owner.workspace.workspaceId;
  const chatScope = useMemo(
    () =>
      record
        ? workspaceSessionTerminalScope({
            key: owner.key,
            workspaceId,
            repoPath: owner.repoPath,
            record,
          })
        : null,
    [owner.key, owner.repoPath, record, workspaceId],
  );
  return useTerminals(task ? taskScope : { scope: chatScope, isScopeLoading: false }, {
    terminalBridge,
  });
};
