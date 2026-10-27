import {
  type WorkspaceRecord,
  type WorkspaceSession,
  WORKSPACE_SESSION_MANUAL_TITLE_LIMIT,
} from "@openducktor/contracts";
import type { StartupAttemptStore } from "@openducktor/frontend-core/sessions/startup/startup-attempt-store";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import { workspaceSessionIdentity } from "@openducktor/frontend-core/sessions/agent-orchestrator/session-read-model/workspace-session-records";
import { useStartupAttempt } from "@openducktor/frontend-core/sessions/startup/use-startup-attempts";
import { startupIsPending } from "@openducktor/frontend-core/sessions/startup/startup-navigation";
import { startupShowsProgress } from "@openducktor/frontend-core/sessions/startup/startup-trace";
import {
  useWorkspaceSessionCreate,
  useWorkspaceSessionCreateDefaults,
} from "@openducktor/frontend-core/workspace-sessions/create/use-workspace-session-create";
import { useNavigation, usePreventRemove, useRouter } from "expo-router";
import { type ReactElement, useCallback, useEffect, useRef } from "react";
import { ActionForm } from "@/ui/action-form";
import { FormBody, FormLead } from "@/ui/form-rows";
import { useCommandGate } from "@/host-session/active-session-context";
import { routes, sessionParams } from "@/navigation/routes";
import { SheetScreen } from "@/navigation/sheet-screen";
import { Button } from "@/ui/button";
import { useConfirmDiscard } from "@/ui/confirm-discard";
import { TextField } from "@/ui/fields";
import { Screen } from "@/ui/screen";
import { StartupTrace } from "@/features/session-startup/startup-trace";
import { useVisibleHandoff } from "@/features/session-startup/use-visible-handoff";
import { useStartupSheetClose } from "@/features/session-startup/startup-presentation-context";
import { useRepairedStartupHandoff } from "@/features/session-startup/use-repaired-startup-handoff";
import { ExistingWorktreeField } from "./new-chat-existing-worktree-field";
import { CustomRoleField, WorkLocationField } from "./new-chat-location-fields";
import { ModelFields } from "./new-chat-model-fields";
import { buildNewChatRequest, newChatFormEdited } from "./new-chat-request";
import { NewChatWorkspaceField } from "./new-chat-workspace-field";
import { WorktreeFields } from "./new-chat-worktree-fields";
import { TargetBranchField } from "./target-branch-field";
import { useNewChatModel } from "./use-new-chat-model";

export function NewChatSheet({ workspace }: { workspace: WorkspaceRecord }): ReactElement {
  const router = useRouter();
  const navigation = useNavigation();
  const gate = useCommandGate();
  const { startupAttempts } = useClientConnection();
  const visibleHandoff = useVisibleHandoff();
  const { repoConfig, defaultModelSelection } = useWorkspaceSessionCreateDefaults(
    workspace.workspaceId,
  );
  const model = useNewChatModel(workspace.repoPath, defaultModelSelection, {
    pending: repoConfig.isPending,
    error: repoConfig.error ? errorMessage(repoConfig.error) : null,
  });
  const form = useWorkspaceSessionCreate({
    workspace,
    model: { selection: model.selection, selectedModelAvailable: model.state.kind === "ready" },
    onCreated: (record, attemptId) =>
      visibleHandoff(() => {
        if (!navigation.isFocused()) return;
        openCreated({
          record,
          attemptId,
          workspaceId: workspace.workspaceId,
          startupAttempts,
          close,
          router,
        });
      }),
  });
  const attemptId = form.startupAttemptId;
  const attempt = useStartupAttempt(attemptId);
  const showProgress = startupShowsProgress(attempt);
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
  const starting =
    form.create.isPending || startupIsPending(attempt) || (attemptId !== null && !showProgress);
  const edited = newChatFormEdited({
    name: form.name,
    roleId: form.roleId,
    location: form.location,
    modelChanged: model.changed,
  });
  const { requestClose, close } = useClose(edited && !attempt, starting);
  useStartupSheetClose(attemptId, close);
  useRepairedStartupHandoff(attempt, form.create.isPending);
  useEffect(() => {
    if (attemptId && !attempt) close();
  }, [attempt, attemptId, close]);

  if (attemptId && showProgress)
    return (
      <SheetScreen
        title="New Chat"
        closable={!starting}
        onClose={() => {
          requestClose();
          startupAttempts.dismiss(attemptId);
        }}
      >
        <Screen background="sheet">
          <StartupTrace
            attemptId={attemptId}
            onEditChoices={form.editChoices}
            onRepairSavedSession={form.repairSavedSession}
          />
        </Screen>
      </SheetScreen>
    );

  return (
    <SheetScreen title="New Chat" closable={!starting} onClose={requestClose}>
      <Screen background="sheet">
        <ActionForm
          note={request.blockedReason && !starting ? request.blockedReason : null}
          primary={
            <CreateChatButton
              creating={starting}
              disabled={request.input === null || !gate.open}
              onCreate={() => {
                if (!starting && request.input) form.submit();
              }}
            />
          }
        >
          <FormBody>
            <FormLead text="Choose where the agent works and how it starts." />
            <NewChatWorkspaceField workspace={workspace} disabled={starting} />
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
              editable={!starting}
              returnKeyType="done"
            />
            <ModelFields
              model={model}
              modelError={request.fieldErrors.model}
              repoConfig={repoConfig}
              disabled={starting}
            />
            <CustomRoleField form={form} disabled={starting} />
            <WorkLocationField form={form} disabled={starting} />
            {form.location === "existing_worktree" ? (
              <ExistingWorktreeField form={form} disabled={starting} />
            ) : null}
            <TargetBranchField form={form} disabled={starting} />
            {form.location === "local_worktree" ? (
              <WorktreeFields
                form={form}
                request={request}
                branchPrefix={branchPrefix}
                prefixFailed={repoConfig.isError}
                disabled={starting}
              />
            ) : null}
          </FormBody>
        </ActionForm>
      </Screen>
    </SheetScreen>
  );
}

const openCreated = ({
  record,
  attemptId,
  workspaceId,
  startupAttempts,
  close,
  router,
}: {
  record: WorkspaceSession;
  attemptId: string;
  workspaceId: string;
  startupAttempts: StartupAttemptStore;
  close: () => void;
  router: ReturnType<typeof useRouter>;
}): void => {
  const identity = workspaceSessionIdentity(record);
  if (
    !identity ||
    !startupAttempts.isReadyForHandoff(attemptId) ||
    startupAttempts.getAttempt(attemptId)?.presentation !== "dialog"
  )
    return;
  close();
  router.push(routes.session(sessionParams(workspaceId, identity)));
  startupAttempts.handoff(attemptId);
};

/** Back and swipe keep pending starts open and ask before discarding filled choices. */
const useClose = (edited: boolean, running: boolean) => {
  const router = useRouter();
  const confirmDiscard = useConfirmDiscard();
  const closed = useRef(false);
  const allowRemoval = usePreventRemove(edited || running, () => {
    if (!running) requestClose();
  });
  const close = useCallback(() => {
    if (closed.current) return;
    closed.current = true;
    allowRemoval();
    router.back();
  }, [allowRemoval, router]);
  const requestClose = useCallback(() => {
    if (running) return;
    if (!edited) {
      close();
      return;
    }
    void confirmDiscard({
      title: "Discard the New Chat?",
      message: "Your choices are not saved.",
    }).then((confirmed) => {
      if (!confirmed) return;
      close();
    });
  }, [close, confirmDiscard, edited, running]);
  return { requestClose, close };
};

function CreateChatButton({
  creating,
  disabled,
  onCreate,
}: {
  creating: boolean;
  disabled: boolean;
  onCreate: () => void;
}): ReactElement {
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
