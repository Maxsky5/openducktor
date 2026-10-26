import type { WorkspaceRecord, WorkspaceSession } from "@openducktor/contracts";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import {
  isOutcomeUnknown,
  RESULT_UNKNOWN_TITLE,
} from "@openducktor/frontend-core/lib/command-outcome";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { workspaceSessionTitle } from "@openducktor/frontend-core/sessions/agent-orchestrator/session-read-model/workspace-session-records";
import { useRestoreWorkspaceSession } from "@openducktor/frontend-core/workspace-sessions/archived-workspace-sessions";
import { type ReactElement, useCallback, useRef } from "react";
import { ComposerTextButton } from "./composer-controls";
import { ComposerNotice } from "./composer-failure-notice";

/**
 * The notice of an archived chat above its read-only composer, with Restore Chat. Restore runs the
 * restore command of Archived Chats. When it succeeds, the chat takes messages again and the
 * notice goes. A failed restore shows its reason here.
 */
export function ArchivedChatNotice({
  workspace,
  record,
}: {
  workspace: WorkspaceRecord;
  record: WorkspaceSession;
}): ReactElement {
  const { feedback } = useClientConnection();
  const restore = useRestoreWorkspaceSession({
    workspaceId: workspace.workspaceId,
    repoPath: workspace.repoPath,
  });
  const title = workspaceSessionTitle(record);
  // A second press before the next render must not send the command again.
  const running = useRef(false);
  const { mutateAsync } = restore;
  const run = useCallback(() => {
    if (running.current) return;
    running.current = true;
    // The notice unmounts when the restore succeeds, so the toast waits for the result itself.
    void mutateAsync(record.id)
      .then(
        () => feedback.show("success", `${title} is restored.`),
        // The notice shows the failure from the mutation state.
        () => undefined,
      )
      .finally(() => {
        running.current = false;
      });
  }, [feedback, mutateAsync, record.id, title]);
  const action = (
    <ComposerTextButton
      label="Restore Chat"
      icon="rotate-ccw"
      variant="outline"
      command
      busy={restore.isPending}
      accessibilityLabel={`Restore ${title}`}
      onPress={run}
    />
  );
  const failure = restore.error;
  if (failure) {
    const unknown = isOutcomeUnknown(failure);
    return (
      <ComposerNotice
        tone={unknown ? "warning" : "destructive"}
        title={unknown ? RESULT_UNKNOWN_TITLE : "The chat was not restored"}
        message={errorMessage(failure)}
        action={action}
      />
    );
  }
  return <ComposerNotice tone="warning" title="This chat is archived" action={action} />;
}
