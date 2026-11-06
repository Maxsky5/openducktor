import { sessionForkDisabledReason } from "@openducktor/frontend-core/sessions/session-fork-availability";
import {
  type ResolvedTaskCard as TaskCard,
  taskWaitsForMergePublication,
} from "@openducktor/workflows";
import type { SessionInteraction, SessionOwner } from "../session-target";

/** Why the Fork action of the open session cannot run now, or null when it can. */
export const mobileSessionForkDisabledReason = ({
  owner,
  task,
  interaction,
}: {
  owner: SessionOwner;
  /** The loaded task of a task session, or null. */
  task: TaskCard | null;
  interaction: Pick<SessionInteraction, "canInteract" | "blockedReason" | "runtimeReadiness">;
}): string | null => {
  const archived = owner.kind === "chat" && owner.record.archivedAt !== null;
  return sessionForkDisabledReason({
    runtimeReadiness: interaction.runtimeReadiness,
    interactionEnabled: interaction.canInteract,
    readOnly: archived,
    readOnlyReason: archived ? "Restore this session before you fork a reply." : null,
    error: interaction.canInteract ? null : interaction.blockedReason,
    waitsForMergePublication:
      owner.kind === "task" && task !== null && taskWaitsForMergePublication(task),
  });
};
