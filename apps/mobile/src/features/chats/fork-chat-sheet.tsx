import type {
  WorkspaceRecord,
  WorkspaceSession,
  WorkspaceSessionForkInput,
  WorkspaceSessionWorktreeInput,
} from "@openducktor/contracts";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { useMountedRef } from "@openducktor/frontend-core/lib/use-mounted-ref";
import { useStartupAttempt } from "@openducktor/frontend-core/sessions/startup/use-startup-attempts";
import { startupIsPending } from "@openducktor/frontend-core/sessions/startup/startup-navigation";
import { repoConfigQueryOptions } from "@openducktor/frontend-core/queries/workspace";
import { workspaceSessionIdentity } from "@openducktor/frontend-core/sessions/agent-orchestrator/session-read-model/workspace-session-records";
import { useAgentSessionsContext } from "@openducktor/frontend-core/sessions/session-contexts";
import {
  forkWorkspaceSession,
  sessionForkRequestKey,
  useSessionForkRequests,
} from "@openducktor/frontend-core/sessions/session-forks";
import { workspaceSessionValidationError } from "@openducktor/frontend-core/workspace-sessions/create/workspace-session-create-input";
import {
  newWorktreeBranchState,
  WORKTREE_NAME_MAX_LENGTH,
} from "@openducktor/frontend-core/workspace-sessions/create/workspace-session-worktree-rules";
import {
  FORK_CHAT_TEXT,
  forkSourceFolder,
  initialForkWorktree,
  type WorkspaceSessionForkDestination,
  workspaceSessionForkInput,
} from "@openducktor/frontend-core/workspace-sessions/fork/workspace-session-fork-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigation, usePreventRemove, useRouter } from "expo-router";
import { type ReactElement, useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useCommandGate } from "@/host-session/active-session-context";
import { routes, sessionParams } from "@/navigation/routes";
import { SheetScreen } from "@/navigation/sheet-screen";
import { ActionForm } from "@/ui/action-form";
import { Button } from "@/ui/button";
import { TextField } from "@/ui/fields";
import { FormBody, FormField, FormLead, OptionCard } from "@/ui/form-rows";
import { Icon } from "@/ui/icon";
import { Screen } from "@/ui/screen";
import { EmptyState, ErrorState, LoadingState } from "@/ui/states";
import { Callout } from "@/ui/callout";
import { Text } from "@/ui/text";
import type { ForkChatSheetParams } from "./chat-sheet-params";
import { useChatRecord } from "./use-chat-record";
import { StartupTrace } from "@/features/session-startup/startup-trace";
import { useVisibleHandoff } from "@/features/session-startup/use-visible-handoff";
import { useStartupSheetClose } from "@/features/session-startup/startup-presentation-context";
import { useRepairedStartupHandoff } from "@/features/session-startup/use-repaired-startup-handoff";

const TITLE = "Fork Chat";

/**
 * Forks a chat after a completed reply, as the desktop Fork chat dialog: the fork works in the
 * same folder or in a new worktree, and opens when the host created it. Null params show a bad
 * link.
 */
export function ForkChatSheet({ params }: { params: ForkChatSheetParams | null }): ReactElement {
  if (!params)
    return (
      <ForkChatState
        content={
          <EmptyState
            icon="circle-alert"
            title="Link Not Valid"
            message="Close this sheet and select the reply again."
          />
        }
      />
    );
  return <ForkChatRead params={params} />;
}

function ForkChatRead({ params }: { params: ForkChatSheetParams }): ReactElement {
  const read = useChatRecord(params.workspaceId, params.sessionId);
  if (read.status === "ready")
    return (
      <ForkChatForm workspace={read.workspace} record={read.record} messageId={params.messageId} />
    );
  if (read.status === "loading")
    return <ForkChatState content={<LoadingState label="Loading chat" />} />;
  if (read.status === "error")
    return (
      <ForkChatState
        content={
          <ErrorState title="The chat did not load" message={read.message} onRetry={read.retry} />
        }
      />
    );
  return (
    <ForkChatState
      content={
        <EmptyState icon="message-square-off" title="Chat Not Available" message={read.reason} />
      }
    />
  );
}

function ForkChatForm({
  workspace,
  record,
  messageId,
}: {
  workspace: WorkspaceRecord;
  record: WorkspaceSession;
  messageId: string;
}): ReactElement {
  const gate = useCommandGate();
  const config = useQuery(repoConfigQueryOptions(workspace.workspaceId));
  const command = useForkChatCommand(workspace, record, messageId);
  const [destination, setDestination] = useState<WorkspaceSessionForkDestination>("same_folder");
  const [worktree, setWorktree] = useState<WorkspaceSessionWorktreeInput>(() =>
    initialForkWorktree(record),
  );
  const { pending, failure } = command;
  const fieldError = workspaceSessionValidationError(failure);
  const branchPrefix = config.data?.branchPrefix;
  const input = workspaceSessionForkInput({
    workspaceId: workspace.workspaceId,
    record,
    point: { messageId },
    destination,
    worktree,
    branchPrefix,
  });
  const blockedReason = forkBlockedReason(gate.open, command.hasSource);
  const note = pending ? null : (blockedReason ?? (input ? null : "Enter a worktree name."));
  if (command.attemptId)
    return (
      <SheetScreen title={TITLE} closable={!command.running}>
        <Screen background="sheet">
          <StartupTrace attemptId={command.attemptId} onEditChoices={command.editChoices} />
        </Screen>
      </SheetScreen>
    );
  return (
    <SheetScreen title={TITLE} closable={!pending}>
      <Screen background="sheet">
        <ActionForm
          note={note}
          primary={
            <Button
              label={pending ? "Forking Chat" : "Fork Chat"}
              size="lg"
              loading={pending}
              command
              disabled={pending || blockedReason !== null || input === null}
              accessibilityHint="Creates the chat and opens it."
              onPress={() => {
                if (input && !blockedReason) command.submit(input);
              }}
              fill
            />
          }
        >
          {failure && !fieldError ? (
            <View style={styles.notice}>
              <Callout
                tone="destructive"
                title="Could not fork the chat"
                message={failure.message}
              />
            </View>
          ) : null}
          <FormBody>
            <FormLead text={FORK_CHAT_TEXT.description} />
            <ForkLocation destination={destination} onChange={setDestination} disabled={pending} />
            <SourceFolder record={record} />
            {destination === "new_worktree" ? (
              <NewWorktreeFields
                worktree={worktree}
                onChange={(next) => {
                  command.clearFailure();
                  setWorktree(next);
                }}
                defaultBranch={newWorktreeBranchState(worktree, branchPrefix).defaultBranch}
                fieldError={fieldError}
                disabled={pending}
              />
            ) : null}
          </FormBody>
        </ActionForm>
      </Screen>
    </SheetScreen>
  );
}

/**
 * Runs the fork of the chat. A fork that the host created closes the sheet and opens the fork; a
 * failed fork stays on the sheet with its error.
 */
const useForkChatCommand = (
  workspace: WorkspaceRecord,
  record: WorkspaceSession,
  messageId: string,
) => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const store = useAgentSessionsContext();
  const { startupAttempts } = useClientConnection();
  const mounted = useMountedRef();
  const navigation = useNavigation();
  const visibleHandoff = useVisibleHandoff();
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const attempt = useStartupAttempt(attemptId);
  useEffect(
    () => () => {
      if (attemptId && startupAttempts.getAttempt(attemptId)?.presentation === "dialog")
        startupAttempts.dismiss(attemptId);
    },
    [attemptId, startupAttempts],
  );
  const pendingRequests = useSessionForkRequests(queryClient);
  const [failure, setFailure] = useState<Error | null>(null);
  const source = workspaceSessionIdentity(record);
  const pending =
    source !== null &&
    pendingRequests.has(sessionForkRequestKey(workspace.repoPath, source, { messageId }));
  const running = pending || startupIsPending(attempt);
  const allowRemoval = usePreventRemove(running, () => {});
  const closed = useRef(false);
  const close = useCallback(() => {
    if (closed.current) return;
    closed.current = true;
    allowRemoval();
    router.back();
  }, [allowRemoval, router]);
  useStartupSheetClose(attemptId, close);
  useRepairedStartupHandoff(attempt);
  useEffect(() => {
    if (attemptId && !attempt) close();
  }, [attempt, attemptId, close]);
  const submit = (input: WorkspaceSessionForkInput) => {
    if (pending || !source) return;
    setFailure(null);
    let submittedAttemptId: string | null = null;
    void forkWorkspaceSession(queryClient, store, workspace.repoPath, source, input, {
      presentation: "dialog",
      onAttempt: (id) => {
        submittedAttemptId = id;
        setAttemptId(id);
      },
    }).then(
      (result) => {
        visibleHandoff(() => {
          if (
            !mounted.current ||
            !navigation.isFocused() ||
            !submittedAttemptId ||
            !startupAttempts.isReadyForHandoff(submittedAttemptId) ||
            startupAttempts.getAttempt(submittedAttemptId)?.presentation !== "dialog"
          )
            return;
          const child = workspaceSessionIdentity(result.record);
          if (!child) return;
          close();
          router.push(routes.session(sessionParams(workspace.workspaceId, child)));
          startupAttempts.handoff(submittedAttemptId);
        });
      },
      (cause: unknown) =>
        setFailure(cause instanceof Error ? cause : new Error(errorMessage(cause))),
    );
  };
  return {
    hasSource: source !== null,
    pending,
    running,
    attemptId,
    editChoices: () => {
      if (attemptId) startupAttempts.dismiss(attemptId);
      setAttemptId(null);
      setFailure(null);
    },
    failure,
    clearFailure: () => setFailure(null),
    submit,
  };
};

const forkBlockedReason = (gateOpen: boolean, hasSource: boolean): string | null => {
  if (!gateOpen) return "Reconnect to the host to fork this chat.";
  if (!hasSource) return "This chat has no session to fork.";
  return null;
};

/** The folder of the source chat, as the desktop Source folder box. Paths and branches are code. */
function SourceFolder({ record }: { record: WorkspaceSession }): ReactElement {
  const source = forkSourceFolder(record);
  return (
    <View style={styles.source}>
      <Text variant="footnote" weight="medium" tone="secondary">
        {FORK_CHAT_TEXT.sourceFolder}
      </Text>
      <View style={styles.sourceName}>
        <Icon name="folder" size={16} color="label" />
        <Text variant="subhead" weight="medium" style={styles.flexText}>
          {source.name}
        </Text>
      </View>
      {source.branchName ? (
        <View style={styles.sourceName} accessibilityLabel={`Source branch: ${source.branchName}`}>
          <Icon name="git-branch" size={14} color="secondaryLabel" />
          <Text variant="monoSmall" tone="secondary" style={styles.flexText}>
            {source.branchName}
          </Text>
        </View>
      ) : null}
      <Text variant="monoSmall" tone="secondary" selectable>
        {source.directory}
      </Text>
    </View>
  );
}

type FieldError = ReturnType<typeof workspaceSessionValidationError>;

/** The Same folder and New worktree choices of the fork. */
function ForkLocation({
  destination,
  onChange,
  disabled,
}: {
  destination: WorkspaceSessionForkDestination;
  onChange: (destination: WorkspaceSessionForkDestination) => void;
  disabled: boolean;
}): ReactElement {
  return (
    <FormField label="Work location">
      <View
        style={styles.locations}
        accessibilityRole="radiogroup"
        accessibilityLabel={FORK_CHAT_TEXT.locationLabel}
      >
        <OptionCard
          variant="primary"
          icon="folder"
          title={FORK_CHAT_TEXT.sameFolder}
          description={FORK_CHAT_TEXT.sameFolderDescription}
          selected={destination === "same_folder"}
          disabled={disabled}
          onPress={() => onChange("same_folder")}
        />
        <OptionCard
          variant="primary"
          icon="git-branch"
          title={FORK_CHAT_TEXT.newWorktree}
          description={FORK_CHAT_TEXT.newWorktreeDescription}
          selected={destination === "new_worktree"}
          disabled={disabled}
          onPress={() => onChange("new_worktree")}
        />
      </View>
    </FormField>
  );
}

/** The name and branch of the new worktree. An empty branch uses the default branch. */
function NewWorktreeFields({
  worktree,
  onChange,
  defaultBranch,
  fieldError,
  disabled,
}: {
  worktree: WorkspaceSessionWorktreeInput;
  onChange: (worktree: WorkspaceSessionWorktreeInput) => void;
  defaultBranch: string;
  fieldError: FieldError;
  disabled: boolean;
}): ReactElement {
  return (
    <>
      <TextField
        label="Worktree name"
        value={worktree.name}
        onChangeText={(name) => onChange({ ...worktree, name })}
        placeholder="my-feature"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        maxLength={WORKTREE_NAME_MAX_LENGTH}
        mono
        editable={!disabled}
        error={fieldError?.field === "worktree.name" ? fieldError.message : null}
        hint="Spaces and slashes become hyphens in the directory name."
      />
      <TextField
        label="Branch name"
        optional
        value={worktree.branchName ?? ""}
        onChangeText={(branchName) =>
          onChange({ mode: "from_name", name: worktree.name, branchName: branchName || null })
        }
        placeholder={defaultBranch || "feature/my-feature"}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        mono
        editable={!disabled}
        error={fieldError?.field === "worktree.branchName" ? fieldError.message : null}
      />
      <Text variant="footnote" tone="secondary">
        {FORK_CHAT_TEXT.uncommittedChanges}
      </Text>
    </>
  );
}

/** A Fork Chat sheet that shows a state before its chat is known. */
function ForkChatState({ content }: { content: ReactElement }): ReactElement {
  return (
    <SheetScreen title={TITLE}>
      <Screen background="sheet">{content}</Screen>
    </SheetScreen>
  );
}

const styles = StyleSheet.create((theme) => ({
  notice: { paddingHorizontal: theme.layout.screenPadding, paddingTop: theme.space.md },
  locations: { gap: theme.space.sm },
  source: {
    gap: theme.space.xs,
    padding: theme.space.md,
    borderRadius: theme.radius.md,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.border,
    backgroundColor: theme.colors.panelFill,
  },
  sourceName: { flexDirection: "row", alignItems: "center", gap: theme.space.sm },
  flexText: { flexShrink: 1, minWidth: 0 },
}));
