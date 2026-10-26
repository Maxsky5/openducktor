import type { ChatFileScope } from "@openducktor/contracts";
import type { WorkOwner } from "@/features/work-owner/work-owner-context";

/**
 * The scope of the file reads of a work owner. A chat names itself, so the host checks that the
 * files are in its saved directory, as on desktop. A task reads its worktree with no scope.
 */
export const fileScopeOf = (owner: WorkOwner): ChatFileScope | undefined =>
  owner.ref.kind === "chat" && owner.record
    ? {
        kind: "chat",
        session: { workspaceId: owner.workspace.workspaceId, sessionId: owner.record.id },
      }
    : undefined;
