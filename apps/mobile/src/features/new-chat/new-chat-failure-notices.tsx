import type { WorkspaceSession } from "@openducktor/contracts";
import type { useWorkspaceSessionCreate } from "@openducktor/frontend-core/workspace-sessions/create/use-workspace-session-create";
import type { ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { type CommandFailure, toCommandFailure } from "@/host-session/command-outcome";
import { Button } from "@/ui/button";
import { Callout } from "@/ui/callout";
import type { StartState } from "./use-start-chat";

type CreateForm = ReturnType<typeof useWorkspaceSessionCreate>;

/** The failed start of a created chat, or the failed create. A worktree field error shows at its field. */
export function ChatFailureNotices({
  start,
  form,
  onStartAgain,
  onShowSessions,
}: {
  start: StartState;
  form: CreateForm;
  onStartAgain: (record: WorkspaceSession) => void;
  onShowSessions: () => void;
}): ReactElement {
  const createError = form.worktreeError ? null : form.create.error;
  return (
    <>
      {start.kind === "failed" ? (
        <StartFailureNotice
          failure={start.failure}
          onStartAgain={() => onStartAgain(start.record)}
          onShowSessions={onShowSessions}
        />
      ) : null}
      {createError ? (
        <CreateFailureNotice failure={toCommandFailure(createError, "Could not create the chat")} />
      ) : null}
    </>
  );
}

/** A created chat whose session did not start: Start Again, or find it in Sessions. */
function StartFailureNotice({
  failure,
  onStartAgain,
  onShowSessions,
}: {
  failure: CommandFailure;
  onStartAgain: () => void;
  onShowSessions: () => void;
}): ReactElement {
  const unknown = failure.kind === "unknown";
  return (
    <View style={styles.notice}>
      <Callout
        tone={unknown ? "warning" : "destructive"}
        title={failure.title}
        message={
          unknown
            ? `${failure.message} The chat is in Sessions. Open it there.`
            : `${failure.message} The chat is in Sessions.`
        }
        action={
          <>
            {failure.kind === "failed" ? (
              <Button
                label="Start Again"
                variant="tinted"
                size="sm"
                command
                onPress={onStartAgain}
              />
            ) : null}
            <Button label="Show Sessions" variant="gray" size="sm" onPress={onShowSessions} />
          </>
        }
      />
    </View>
  );
}

/** A create request that failed, or whose result the connection lost. */
function CreateFailureNotice({ failure }: { failure: CommandFailure }): ReactElement {
  const unknown = failure.kind === "unknown";
  return (
    <View style={styles.notice}>
      <Callout
        tone={unknown ? "warning" : "destructive"}
        title={failure.title}
        message={
          unknown
            ? `${failure.message} Check Sessions for the new chat before you create it again.`
            : failure.message
        }
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  notice: { paddingHorizontal: theme.layout.screenPadding, paddingTop: theme.space.md },
}));
