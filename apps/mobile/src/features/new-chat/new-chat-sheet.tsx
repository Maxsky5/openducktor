import { type WorkspaceRecord, WORKSPACE_SESSION_MANUAL_TITLE_LIMIT } from "@openducktor/contracts";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import {
  useWorkspaceSessionCreate,
  useWorkspaceSessionCreateDefaults,
} from "@openducktor/frontend-core/workspace-sessions/create/use-workspace-session-create";
import { usePreventRemove, useRouter } from "expo-router";
import { type ReactElement, type RefObject, useCallback, useEffect, useRef } from "react";
import type { KeyboardAwareScrollViewRef } from "react-native-keyboard-controller";
import { StyleSheet } from "react-native-unistyles";
import { ActionForm } from "@/ui/action-form";
import { FormBody, FormLead } from "@/ui/form-rows";
import { useCommandGate } from "@/host-session/active-session-context";
import { routes } from "@/navigation/routes";
import { SheetScreen } from "@/navigation/sheet-screen";
import { Button } from "@/ui/button";
import { useConfirmDiscard } from "@/ui/confirm-discard";
import { TextField } from "@/ui/fields";
import { haptics } from "@/ui/haptics";
import { Screen } from "@/ui/screen";
import { Text } from "@/ui/text";
import { useAnnounce } from "@/ui/use-announce";
import { ChatFailureNotices } from "./new-chat-failure-notices";
import { ExistingWorktreeField } from "./new-chat-existing-worktree-field";
import { CustomRoleField, WorkLocationField } from "./new-chat-location-fields";
import { ModelFields } from "./new-chat-model-fields";
import { buildNewChatRequest, newChatFormEdited } from "./new-chat-request";
import { NewChatWorkspaceField } from "./new-chat-workspace-field";
import { WorktreeFields } from "./new-chat-worktree-fields";
import { TargetBranchField } from "./target-branch-field";
import { useNewChatModel } from "./use-new-chat-model";
import { type StartState, useStartChat } from "./use-start-chat";

type CreateForm = ReturnType<typeof useWorkspaceSessionCreate>;

/**
 * A failed create or start plays the error haptic and scrolls to its notice at the top of the
 * form, where Create sends the request from. A worktree field error shows next to its field.
 */
const useFailureAttention = (
  start: StartState,
  form: CreateForm,
  scroll: RefObject<KeyboardAwareScrollViewRef | null>,
): void => {
  const failure = start.kind === "failed" ? start.failure : form.create.error;
  const fieldFailure = form.worktreeError !== null;
  useEffect(() => {
    if (failure === null) return;
    haptics.error();
    if (!fieldFailure) scroll.current?.scrollTo({ y: 0, animated: true });
  }, [failure, fieldFailure, scroll]);
};

/**
 * Close, Back, and the iOS swipe ask before they drop a filled form, as the task form does. A
 * create in progress blocks them, and a created chat leaves without a question.
 */
const useNewChatClose = (edited: boolean): (() => void) => {
  const router = useRouter();
  const confirmDiscard = useConfirmDiscard();
  // A confirmed discard lifts the Back guard before the sheet closes.
  const allowRemoval = usePreventRemove(edited, () => requestClose());
  const requestClose = useCallback(() => {
    if (!edited) {
      router.back();
      return;
    }
    void confirmDiscard({
      title: "Discard the New Chat?",
      message: "Your choices are not saved.",
    }).then((confirmed) => {
      if (!confirmed) return;
      allowRemoval();
      router.back();
    });
  }, [allowRemoval, confirmDiscard, edited, router]);
  return requestClose;
};

/**
 * New chat, as the desktop new chat dialog on a phone: an optional name, the runtime and model
 * with its effort and speed, an optional custom role, and the work location. Create Chat in the
 * footer sends one request. The sheet then starts the chat session and opens it.
 */
export function NewChatSheet({ workspace }: { workspace: WorkspaceRecord }): ReactElement {
  const router = useRouter();
  const gate = useCommandGate();
  const scroll = useRef<KeyboardAwareScrollViewRef>(null);
  const { repoConfig, defaultModelSelection } = useWorkspaceSessionCreateDefaults(
    workspace.workspaceId,
  );
  const model = useNewChatModel(workspace.repoPath, defaultModelSelection, {
    pending: repoConfig.isPending,
    error: repoConfig.error ? errorMessage(repoConfig.error) : null,
  });
  const { start, openChat } = useStartChat(workspace);
  const form = useWorkspaceSessionCreate({
    workspace,
    model: { selection: model.selection, selectedModelAvailable: model.state.kind === "ready" },
    onCreated: (record) => void openChat(record),
  });
  const branchPrefix = repoConfig.data?.branchPrefix;
  const request = buildNewChatRequest({
    workspaceId: workspace.workspaceId,
    name: form.name,
    roleId: form.roleId,
    location: form.location,
    worktree: form.worktree,
    targetBranch: form.targetBranch,
    targetPending: form.branches.isPending || repoConfig.isPending,
    selection: model.selection,
    model: model.state,
    rolesReady: form.roles.isSuccess,
    branches: form.branches.isSuccess ? form.branches.data : null,
    branchPrefix,
    hostError: form.worktreeError,
    input: form.input,
  });
  const isStarting = start.kind === "starting";
  const busy = form.create.isPending || isStarting;
  // After the host created the chat, the form stays closed so Create cannot make a second chat.
  const created = start.kind !== "idle";
  const formDisabled = busy || created;
  const edited =
    !created &&
    newChatFormEdited({
      name: form.name,
      roleId: form.roleId,
      location: form.location,
      modelChanged: model.changed,
    });
  const requestClose = useNewChatClose(edited);

  useFailureAttention(start, form, scroll);

  return (
    <SheetScreen title="New Chat" closable={!busy} onClose={requestClose}>
      <Screen background="sheet">
        <ActionForm
          scrollRef={scroll}
          note={request.blockedReason && !formDisabled ? request.blockedReason : null}
          // A chat that did not start has no main action.
          primary={
            created && !isStarting ? null : (
              <CreateChatButton
                creating={form.create.isPending}
                starting={isStarting}
                disabled={request.input === null || !gate.open}
                onCreate={() => {
                  if (request.input) form.submit();
                }}
              />
            )
          }
        >
          <ChatFailureNotices
            start={start}
            form={form}
            onStartAgain={(record) => void openChat(record)}
            onShowSessions={() => {
              router.back();
              router.navigate(routes.sessions());
            }}
          />

          <FormBody>
            <FormLead text="Choose where the agent works and how it starts." />
            <NewChatWorkspaceField workspace={workspace} disabled={formDisabled} />
            <TextField
              label="Name"
              value={form.name}
              onChangeText={form.setName}
              placeholder="What are you working on?"
              maxLength={WORKSPACE_SESSION_MANUAL_TITLE_LIMIT}
              autoComplete="off"
              clearButtonMode="while-editing"
              hint="Optional. A chat without a name gets a generated title."
              error={request.fieldErrors.name}
              editable={!formDisabled}
              returnKeyType="done"
            />
            <ModelFields
              model={model}
              modelError={request.fieldErrors.model}
              repoConfig={repoConfig}
              disabled={formDisabled}
            />
            <CustomRoleField form={form} disabled={formDisabled} />
            <WorkLocationField form={form} disabled={formDisabled} />
            {form.location === "existing_worktree" ? (
              <ExistingWorktreeField form={form} disabled={formDisabled} />
            ) : null}
            <TargetBranchField form={form} disabled={formDisabled} />
            {form.location === "local_worktree" ? (
              <WorktreeFields
                form={form}
                request={request}
                branchPrefix={branchPrefix}
                prefixFailed={repoConfig.isError}
                disabled={formDisabled}
              />
            ) : null}
            {isStarting ? <StartingStatus /> : null}
          </FormBody>
        </ActionForm>
      </Screen>
    </SheetScreen>
  );
}

/** Create Chat, then the progress of the chat start. */
function CreateChatButton({
  creating,
  starting,
  disabled,
  onCreate,
}: {
  creating: boolean;
  starting: boolean;
  disabled: boolean;
  onCreate: () => void;
}): ReactElement {
  if (starting) return <Button label="Starting Chat" size="lg" loading onPress={() => {}} fill />;
  return (
    <Button
      label={creating ? "Creating Chat" : "Create Chat"}
      size="lg"
      loading={creating}
      command
      disabled={disabled}
      accessibilityHint="Creates the chat and opens it."
      onPress={onCreate}
      fill
    />
  );
}

const STARTING_TEXT = "Starting the chat…";

/** The status under the form while the new chat starts. Screen readers read it when it shows. */
function StartingStatus(): ReactElement {
  useAnnounce(STARTING_TEXT);
  return (
    <Text variant="footnote" tone="tertiary" accessibilityLiveRegion="polite" style={styles.status}>
      {STARTING_TEXT}
    </Text>
  );
}

const styles = StyleSheet.create(() => ({
  status: { textAlign: "center" },
}));
