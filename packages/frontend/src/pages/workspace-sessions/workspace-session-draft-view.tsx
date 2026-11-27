import type { WorkspaceRecord } from "@openducktor/contracts";
import { MessageCirclePlus, RefreshCw, Trash2 } from "lucide-react";
import { type ReactElement, useLayoutEffect, useRef } from "react";
import {
  type AgentChatComposerDraft,
  draftToSerializedText,
} from "@openducktor/frontend-core/drafts/agent-chat-composer-draft";
import { workspaceSessionDraftTitle } from "@openducktor/frontend-core/drafts/new-workspace-session-draft-store";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { AgentChatComposer } from "@/components/features/agents/agent-chat/agent-chat-composer";
import { AgentChatSettingsProvider } from "@/components/features/agents/agent-chat/agent-chat-settings-context";
import { SessionPageHeader } from "@/components/features/agents/session-page-header";
import {
  WorkspacePicker,
  type WorkspacePickerWorkspace,
} from "@/components/features/workspace-picker/workspace-picker";
import { DiscardWorkspaceSessionDraftDialog } from "@/components/features/workspace-sessions/discard-workspace-session-draft-dialog";
import { WorkspaceTile, type WorkspaceTileSource } from "@/components/layout/workspace-tile";
import { Button } from "@/components/ui/button";
import { InlineStartup } from "@/features/session-startup/inline-session-startup";
import { useWorkspaceState } from "@/state/app-state-provider";
import type { ActiveWorkspace } from "@/types/state-slices";
import {
  useWorkspaceSessionDraftController,
  type WorkspaceSessionDraftViewProps,
} from "./use-workspace-session-draft-controller";
import { DraftConfigurationBar } from "./workspace-session-draft-config-bar";

export function DraftSubmittedMessageBubble({
  composer,
  animate = true,
}: {
  composer: AgentChatComposerDraft | null;
  animate?: boolean;
}): ReactElement | null {
  const submittedText = composer ? draftToSerializedText(composer) : "";
  const submittedAttachments = composer?.attachments ?? [];
  if (submittedText.trim().length === 0 && submittedAttachments.length === 0) return null;
  return (
    <div className={animate ? "session-smooth-reveal w-full" : "w-full"}>
      <article className="mb-4 ml-auto flex w-fit max-w-[80%] flex-col items-end text-sm">
        <div
          data-slot="user-message-bubble"
          className="max-w-full rounded-xl rounded-br-sm bg-chat-surface px-3.5 py-2 text-foreground shadow-chat"
        >
          {submittedText.trim().length > 0 ? (
            <p className="whitespace-pre-wrap break-words">{submittedText}</p>
          ) : null}
          {submittedAttachments.length > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
              {submittedAttachments.map((attachment) => (
                <li
                  key={attachment.id}
                  className="rounded-md border border-border bg-muted px-2 py-0.5"
                >
                  {attachment.name}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        {/* Reserves the same meta-row height as the echoed user message timestamp to avoid layout shift. */}
        <div className="mt-1 flex min-h-4 items-center justify-end gap-1.5 px-1 text-[11px] text-muted-foreground">
          <span>Sending…</span>
        </div>
      </article>
    </div>
  );
}

function DraftStatusBanners({
  repoConfigError,
  onRetryRepoConfig,
  preSaveError,
}: {
  repoConfigError: Error | null;
  onRetryRepoConfig: () => void;
  preSaveError: Error | null;
}): ReactElement | null {
  if (!repoConfigError && !preSaveError) return null;
  return (
    <div className="mb-3 flex flex-col gap-2 px-4">
      {repoConfigError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive-border bg-destructive-surface px-3 py-2 text-xs text-destructive"
        >
          <span>Could not load repository defaults: {errorMessage(repoConfigError)}</span>
          <Button type="button" size="sm" variant="outline" onClick={onRetryRepoConfig}>
            <RefreshCw className="size-3.5" aria-hidden="true" />
            Retry defaults
          </Button>
        </div>
      ) : null}

      {preSaveError ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive-border bg-destructive-surface px-3 py-2 text-xs text-destructive"
        >
          {errorMessage(preSaveError)}
        </p>
      ) : null}
    </div>
  );
}

const NOOP_SWITCH_WORKSPACE = (_workspaceId: string): void => {};

function DraftWorkspaceHeading({
  workspace,
  workspaceTile,
  workspaces,
  disabled,
  onSwitchWorkspace,
}: {
  workspace: ActiveWorkspace;
  workspaceTile: WorkspaceTileSource;
  workspaces: readonly WorkspaceRecord[];
  disabled: boolean;
  onSwitchWorkspace?: ((workspaceId: string) => void) | undefined;
}): ReactElement {
  const fallbackWorkspace: WorkspacePickerWorkspace = {
    workspaceId: workspace.workspaceId,
    workspaceName: workspace.workspaceName,
    repoPath: workspace.repoPath,
    abbreviation: workspaceTile.abbreviation,
    tileColor: workspaceTile.tileColor,
  };
  if (workspaceTile.iconDataUrl !== undefined) {
    fallbackWorkspace.iconDataUrl = workspaceTile.iconDataUrl;
  }
  const pickerWorkspaces = workspaces.length > 0 ? workspaces : [fallbackWorkspace];

  return (
    <div className="mb-6 flex flex-col items-center gap-1.5 px-4 text-center">
      <div className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-xl font-semibold tracking-tight text-foreground">
        <h2>Start a new session</h2>
        <div className="inline-flex min-w-0 items-center gap-1">
          <span className="font-normal text-muted-foreground">in</span>
          <WorkspacePicker
            workspaces={pickerWorkspaces}
            value={workspace.workspaceId}
            onValueChange={onSwitchWorkspace ?? NOOP_SWITCH_WORKSPACE}
            label="Workspace"
            placeholder={workspace.workspaceName}
            variant="inline"
            align="center"
            disabled={disabled || !onSwitchWorkspace}
            className="h-8 rounded-lg px-2 text-xl font-semibold tracking-tight"
          />
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Choose where the agent works and send your first message.
      </p>
    </div>
  );
}

function DraftSettingsErrorBanner({
  error,
  onRetry,
}: {
  error: Error | null;
  onRetry: () => void;
}): ReactElement | null {
  if (!error) return null;
  return (
    <div
      role="alert"
      className="flex items-center gap-3 border-b border-border bg-card px-4 py-2 text-sm"
    >
      <span className="flex-1 text-destructive">{errorMessage(error)}</span>
      <Button type="button" size="sm" variant="outline" onClick={onRetry}>
        Retry settings
      </Button>
    </div>
  );
}

/** Glides the composer from centered draft layout to the bottom dock when submitting. */
function useComposerDockGlide(showingStartupTranscript: boolean) {
  const composerDockRef = useRef<HTMLDivElement | null>(null);
  const previousTopRef = useRef<number | null>(null);
  const wasTranscriptRef = useRef(showingStartupTranscript);

  useLayoutEffect(() => {
    const node = composerDockRef.current;
    const wasTranscript = wasTranscriptRef.current;
    wasTranscriptRef.current = showingStartupTranscript;
    if (!node) return;
    if (!showingStartupTranscript) {
      previousTopRef.current = node.getBoundingClientRect().top;
      return;
    }
    if (wasTranscript) return;
    const previousTop = previousTopRef.current;
    previousTopRef.current = null;
    if (previousTop === null) return;
    if (globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const deltaY = previousTop - node.getBoundingClientRect().top;
    if (Math.abs(deltaY) <= 4) return;
    node.animate?.([{ transform: `translateY(${deltaY}px)` }, { transform: "translateY(0)" }], {
      duration: 240,
      easing: "cubic-bezier(0.23, 1, 0.32, 1)",
    });
  }, [showingStartupTranscript]);

  return composerDockRef;
}

function DraftComposerStage({
  workspace,
  workspaceTile,
  workspaces,
  draft,
  controller,
  onSwitchWorkspace,
}: {
  workspace: ActiveWorkspace;
  workspaceTile: WorkspaceTileSource;
  workspaces: readonly WorkspaceRecord[];
  draft: WorkspaceSessionDraftViewProps["draft"];
  controller: ReturnType<typeof useWorkspaceSessionDraftController>;
  onSwitchWorkspace?: ((workspaceId: string) => void) | undefined;
}): ReactElement {
  const { showingTranscript, isStarting, submittedComposer } = controller.startup;
  const composerDockRef = useComposerDockGlide(showingTranscript);

  return (
    <div
      className={
        showingTranscript
          ? "flex min-h-0 flex-1 flex-col overflow-hidden"
          : "hide-scrollbar flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-4 pb-16 pt-[clamp(5rem,30vh,22rem)]"
      }
    >
      {showingTranscript ? (
        <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <InlineStartup
            scope={{ kind: "workspace", repoPath: workspace.repoPath, draftId: draft.id }}
          />
          <DraftSubmittedMessageBubble composer={submittedComposer} />
        </div>
      ) : null}

      <div className={showingTranscript ? "shrink-0" : "flex w-full max-w-3xl flex-col"}>
        {!showingTranscript ? (
          <>
            <DraftWorkspaceHeading
              workspace={workspace}
              workspaceTile={workspaceTile}
              workspaces={workspaces}
              disabled={isStarting}
              onSwitchWorkspace={onSwitchWorkspace}
            />

            <DraftStatusBanners
              repoConfigError={controller.banners.repoConfigError}
              onRetryRepoConfig={controller.banners.onRetryRepoConfig}
              preSaveError={controller.banners.preSaveError}
            />
          </>
        ) : null}

        <div ref={composerDockRef}>
          <AgentChatComposer model={controller.composerModel} />
        </div>

        {!showingTranscript ? (
          <div className="-mt-1.5 px-4">
            <DraftConfigurationBar optionsModel={controller.optionsModel} disabled={isStarting} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function WorkspaceSessionDraftView(props: WorkspaceSessionDraftViewProps): ReactElement {
  const { workspace, draft, onDiscard, onSwitchWorkspace } = props;
  const { workspaces } = useWorkspaceState();
  const controller = useWorkspaceSessionDraftController(props);
  const workspaceTile: WorkspaceTileSource = workspaces.find(
    (entry) => entry.workspaceId === workspace.workspaceId,
  ) ?? {
    workspaceName: workspace.workspaceName,
    abbreviation: null,
    tileColor: null,
  };
  const startingTitle = controller.startup.showingTranscript
    ? workspaceSessionDraftTitle(draft, controller.startup.submittedComposer)
    : null;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-chat-background">
      <SessionPageHeader
        title={
          startingTitle ? (
            <h1 className="min-w-0 truncate text-sm font-semibold leading-5 text-foreground">
              {startingTitle}
            </h1>
          ) : (
            <div className="flex min-w-0 items-center gap-2">
              <MessageCirclePlus
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <h1 className="min-w-0 truncate text-sm font-semibold leading-5 text-foreground">
                New session
              </h1>
              <span className="inline-flex min-w-0 items-center gap-1.5 rounded-md border border-border bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground">
                <WorkspaceTile workspace={workspaceTile} size="xs" className="size-4 shadow-none" />
                <span className="truncate">{workspace.workspaceName}</span>
              </span>
            </div>
          )
        }
        actions={
          controller.startup.isStarting ? null : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:bg-destructive-surface hover:text-destructive"
              onClick={controller.discard.onClick}
            >
              <Trash2 className="size-3.5 shrink-0" aria-hidden="true" />
              <span>Discard</span>
            </Button>
          )
        }
        openIn={null}
        viewControls={null}
      />

      <DraftSettingsErrorBanner
        error={controller.chatSettings.error}
        onRetry={controller.chatSettings.onRetry}
      />

      <AgentChatSettingsProvider value={controller.chatSettings.value}>
        <DraftComposerStage
          workspace={workspace}
          workspaceTile={workspaceTile}
          workspaces={workspaces}
          draft={draft}
          controller={controller}
          onSwitchWorkspace={onSwitchWorkspace}
        />
      </AgentChatSettingsProvider>

      <DiscardWorkspaceSessionDraftDialog
        open={controller.discard.confirmOpen}
        onOpenChange={controller.discard.setConfirmOpen}
        onConfirm={onDiscard}
      />
    </div>
  );
}
