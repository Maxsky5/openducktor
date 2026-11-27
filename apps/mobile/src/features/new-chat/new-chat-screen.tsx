import type { WorkspaceRecord } from "@openducktor/contracts";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import { draftToSerializedText } from "@openducktor/frontend-core/drafts/agent-chat-composer-draft";
import { useNewWorkspaceSessionDraft } from "@openducktor/frontend-core/drafts/use-new-workspace-session-drafts";
import { workspaceSessionTitle } from "@openducktor/frontend-core/sessions/agent-orchestrator/session-read-model/workspace-session-records";
import {
  findSavedWorkspaceStartupAttemptForDraft,
  startupIsPending,
} from "@openducktor/frontend-core/sessions/startup/startup-navigation";
import {
  useStartupAttempt,
  useStartupAttemptsSelector,
} from "@openducktor/frontend-core/sessions/startup/use-startup-attempts";
import {
  type NativeStackNavigationOptions,
  Stack,
  useFocusEffect,
  useNavigation,
  useRouter,
} from "expo-router";
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { InlineStartupLease } from "@/features/session-startup/inline-startup-lease";
import { StartupTrace } from "@/features/session-startup/startup-trace";
import { closeScreen } from "@/navigation/close-screen";
import { workspaceSessionRoute } from "@/navigation/routes";
import { Button } from "@/ui/button";
import { IconButton } from "@/ui/icon-button";
import { KEYBOARD_DISMISS_ON_DRAG } from "@/ui/keyboard-dismiss";
import { KeyboardInsetView } from "@/ui/keyboard-inset-view";
import { Screen } from "@/ui/screen";
import { LoadingState } from "@/ui/states";
import { Text } from "@/ui/text";
import {
  NewChatComposerDock,
  NewChatHeroView,
  SubmittedMessagePreview,
} from "./new-chat-composer-dock";
import { DraftModelOptionsSheet, NewChatOptionChips } from "./new-chat-options-sheet";
import {
  type NewChatDraftViewProps,
  type SavedUnboundState,
  useNewChatDraftController,
} from "./use-new-chat-draft-controller";

/** Recovery screen for a saved-but-unbound startup attempt opened from notifications or sessions. */
export function StartupAttemptRecoveryScreen({
  workspace,
  startupAttemptId,
}: {
  workspace: WorkspaceRecord;
  startupAttemptId: string;
}): ReactElement {
  const initialAttempt = useStartupAttempt(startupAttemptId);
  if (
    initialAttempt?.ownership.state === "saved" &&
    initialAttempt.ownership.target.kind === "workspace"
  ) {
    return (
      <SavedUnboundRecoveryView
        workspace={workspace}
        recovery={{
          record: initialAttempt.ownership.target.record,
          attemptId: initialAttempt.id,
          submittedComposer: initialAttempt.submittedComposer ?? null,
        }}
      />
    );
  }
  return (
    <Screen>
      <Stack.Screen options={{ title: "Session" }} />
      <View style={styles.centered}>
        <Text variant="subhead" tone="secondary">
          Startup progress is no longer active. Check the Sessions tab to open this session.
        </Text>
      </View>
    </Screen>
  );
}

/** Replaces a retired draft screen with its bound workspace session once the screen has focus. */
function SavedBoundDraftRedirect({
  route,
  attemptId,
  title,
}: {
  route: NonNullable<ReturnType<typeof workspaceSessionRoute>>;
  attemptId: string;
  title: string;
}): ReactElement {
  const { startupAttempts } = useClientConnection();
  const navigation = useNavigation();
  const router = useRouter();
  const replacedRef = useRef(false);

  const replaceIfFocused = useCallback(() => {
    if (replacedRef.current || !navigation.isFocused()) return;
    replacedRef.current = true;
    const attempt = startupAttempts.getAttempt(attemptId);
    if (attempt?.presentation === "notification") {
      startupAttempts.returnToInline(attemptId);
    }
    router.replace(route);
  }, [attemptId, navigation, route, router, startupAttempts]);

  useEffect(() => {
    replaceIfFocused();
  }, [replaceIfFocused]);

  useFocusEffect(
    useCallback(() => {
      replaceIfFocused();
    }, [replaceIfFocused]),
  );

  return (
    <Screen>
      <Stack.Screen options={{ title }} />
      <LoadingState label="Opening session" />
    </Screen>
  );
}

/**
 * Immediate pushed screen for creating a new workspace session. Keeps options and message text
 * as a frontend draft until the user sends the first valid message, then shows in-transcript
 * creation steps and transitions into the saved bound session.
 */
export function NewChatDraftScreen({
  workspace,
  draftId,
}: {
  workspace: WorkspaceRecord;
  draftId: string;
}): ReactElement {
  const connection = useClientConnection();
  const navigation = useNavigation();
  const router = useRouter();
  const draftStore = connection.drafts.newWorkspaceSessions;
  const draft = useNewWorkspaceSessionDraft(draftId);
  const savedAttemptForDraft = useStartupAttemptsSelector(
    useCallback(
      (attempts) => findSavedWorkspaceStartupAttemptForDraft(attempts, draftId),
      [draftId],
    ),
  );
  const [savedUnbound, setSavedUnbound] = useState<SavedUnboundState | null>(null);

  if (savedUnbound) {
    return <SavedUnboundRecoveryView workspace={workspace} recovery={savedUnbound} />;
  }

  if (!draft) {
    if (savedAttemptForDraft) {
      const savedRecord = savedAttemptForDraft.ownership.target.record;
      const boundRoute = workspaceSessionRoute(
        workspace.workspaceId,
        savedRecord,
        savedAttemptForDraft.id,
      );
      if (boundRoute) {
        return (
          <SavedBoundDraftRedirect
            route={boundRoute}
            attemptId={savedAttemptForDraft.id}
            title={workspaceSessionTitle(savedRecord)}
          />
        );
      }
      return (
        <SavedUnboundRecoveryView
          workspace={workspace}
          recovery={{
            record: savedRecord,
            attemptId: savedAttemptForDraft.id,
            submittedComposer: savedAttemptForDraft.submittedComposer ?? null,
          }}
        />
      );
    }

    return (
      <Screen>
        <Stack.Screen options={{ title: "New Session" }} />
        <View style={styles.centered}>
          <Text variant="subhead" tone="secondary" style={styles.centeredText}>
            This draft is no longer available.
          </Text>
          <View style={styles.missingActions}>
            <Button
              label="New Session"
              onPress={() => {
                const next = draftStore.createDraft(workspace.workspaceId);
                router.setParams({ workspaceId: workspace.workspaceId, draftId: next.id });
              }}
            />
            <Button label="Back" variant="outline" onPress={() => closeScreen(navigation)} />
          </View>
        </View>
      </Screen>
    );
  }

  return <NewChatDraftView workspace={workspace} draft={draft} onSavedUnbound={setSavedUnbound} />;
}

function StartupTranscriptScroll({
  attemptId,
  canContinueInBackground,
  dismissedNotice,
  submittedText,
  attachmentCount,
}: {
  attemptId: string | null;
  canContinueInBackground: boolean;
  dismissedNotice?: string;
  submittedText: string;
  attachmentCount: number;
}): ReactElement {
  const { startupAttempts } = useClientConnection();
  const navigation = useNavigation();
  return (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={styles.startupScroll}
      keyboardDismissMode={KEYBOARD_DISMISS_ON_DRAG}
      keyboardShouldPersistTaps="handled"
    >
      {attemptId ? (
        <StartupTrace
          attemptId={attemptId}
          presentation="inline"
          onContinueInBackground={
            canContinueInBackground
              ? () => {
                  startupAttempts.continueInBackground(attemptId);
                  closeScreen(navigation);
                }
              : undefined
          }
        />
      ) : dismissedNotice ? (
        <Text variant="subhead" tone="secondary">
          {dismissedNotice}
        </Text>
      ) : null}
      <SubmittedMessagePreview text={submittedText} attachmentCount={attachmentCount} />
    </ScrollView>
  );
}

/** Keeps a saved-but-unbound session in place when post-save runtime preparation fails. */
function SavedUnboundRecoveryView({
  workspace,
  recovery,
}: {
  workspace: WorkspaceRecord;
  recovery: SavedUnboundState;
}): ReactElement {
  const navigation = useNavigation();
  const router = useRouter();
  const handedOffRef = useRef(false);
  const isHandedOff = useCallback(() => handedOffRef.current, []);
  const attempt = useStartupAttempt(recovery.attemptId);

  const boundRecord =
    attempt?.ownership.state === "saved" && attempt.ownership.target.kind === "workspace"
      ? attempt.ownership.target.record
      : recovery.record;

  const tryHandoff = useCallback(() => {
    const boundRoute = workspaceSessionRoute(
      workspace.workspaceId,
      boundRecord,
      recovery.attemptId,
    );
    if (!boundRoute || handedOffRef.current || !navigation.isFocused()) return;
    handedOffRef.current = true;
    router.replace(boundRoute);
  }, [boundRecord, navigation, recovery.attemptId, router, workspace.workspaceId]);

  useEffect(() => {
    tryHandoff();
  }, [tryHandoff]);

  useFocusEffect(
    useCallback(() => {
      tryHandoff();
    }, [tryHandoff]),
  );

  const submittedComposer = attempt?.submittedComposer ?? recovery.submittedComposer;
  const submittedText = submittedComposer ? draftToSerializedText(submittedComposer) : "";
  const attachmentCount = submittedComposer?.attachments?.length ?? 0;

  return (
    <Screen>
      <Stack.Screen options={{ title: workspaceSessionTitle(recovery.record) }} />
      <InlineStartupLease attemptId={recovery.attemptId} suppressBackground={isHandedOff} />
      <StartupTranscriptScroll
        attemptId={attempt ? recovery.attemptId : null}
        canContinueInBackground={attempt !== null && startupIsPending(attempt)}
        dismissedNotice="Startup progress was dismissed. Return to the Sessions tab to inspect this session."
        submittedText={submittedText}
        attachmentCount={attachmentCount}
      />
    </Screen>
  );
}

function NewChatDraftView(props: NewChatDraftViewProps): ReactElement {
  const { workspace } = props;
  const { ui, startup, optionsModel, model, composer, actions } = useNewChatDraftController(props);
  const { discard } = actions;
  const { isStarting } = startup;
  const headerOptions = useMemo(
    (): NativeStackNavigationOptions => ({
      title: "New Session",
      headerRight: () => (
        <IconButton
          icon="trash-2"
          color="label"
          accessibilityLabel="Discard draft"
          disabled={isStarting}
          onPress={discard}
        />
      ),
    }),
    [discard, isStarting],
  );

  return (
    <Screen>
      <Stack.Screen options={headerOptions} />
      <InlineStartupLease attemptId={startup.attemptId} suppressBackground={startup.isHandedOff} />
      <KeyboardInsetView style={styles.fill} barSafeArea>
        {startup.showingTranscript && startup.attemptId ? (
          <StartupTranscriptScroll
            attemptId={startup.attemptId}
            canContinueInBackground={startup.isAttemptPending}
            submittedText={startup.submittedText}
            attachmentCount={startup.submittedAttachmentCount}
          />
        ) : (
          <NewChatHeroView
            workspaceName={workspace.workspaceName}
            preSaveError={ui.preSaveError}
            hostValidationError={ui.hostValidationError}
          />
        )}

        <View style={styles.bottomArea}>
          {!startup.showingTranscript ? (
            <NewChatOptionChips
              workspace={workspace}
              workspaces={ui.workspaces}
              optionsModel={optionsModel}
              disabled={startup.isStarting}
              onSwitchWorkspace={actions.switchWorkspace}
            />
          ) : null}

          <NewChatComposerDock
            composer={composer}
            runtimeKind={model.runtimeKind}
            isReadOnly={startup.isReadOnly}
            compact={ui.compact}
            onOpenModelSheet={actions.openModelSheet}
            onSend={actions.send}
          />
        </View>
      </KeyboardInsetView>

      <DraftModelOptionsSheet
        visible={ui.modelSheetOpen}
        onClose={() => ui.setModelSheetOpen(false)}
        model={model}
        repoConfig={optionsModel.repoConfig}
        disabled={startup.isReadOnly}
      />
    </Screen>
  );
}

const styles = StyleSheet.create((theme) => ({
  fill: { flex: 1 },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.space.md,
    padding: theme.space.xl,
  },
  centeredText: { textAlign: "center" },
  missingActions: { flexDirection: "row", gap: theme.space.sm },
  startupScroll: {
    flexGrow: 1,
    gap: theme.space.md,
    paddingHorizontal: theme.layout.screenPadding,
    paddingVertical: theme.space.lg,
  },
  bottomArea: { flexShrink: 0 },
}));
