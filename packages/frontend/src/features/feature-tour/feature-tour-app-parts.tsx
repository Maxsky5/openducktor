import { resolveAgentChatRuntimePresentation } from "@openducktor/frontend-core/sessions/send/agent-chat-runtime-presentation";
import type { AgentChatTranscriptRow } from "@openducktor/frontend-core/sessions/transcript/agent-chat-transcript-model";
import type { WorkflowRoleId } from "@openducktor/workflows";
import {
  Bot,
  BrainCog,
  ChevronsUpDown,
  PanelBottomOpen,
  PanelRightClose,
  Paperclip,
  Plus,
  X,
  Zap,
} from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { AgentChatSettingsProvider } from "@/components/features/agents/agent-chat/agent-chat-settings-context";
import { ACTIVE_COMPOSER_CARD_CLASS_NAME } from "@/components/features/agents/agent-chat/agent-chat-composer-surface";
import { AgentChatComposerSendControl } from "@/components/features/agents/agent-chat/agent-chat-composer-pending-items";
import { AgentChatThreadRow } from "@/components/features/agents/agent-chat/agent-chat-thread-row";
import { ChatWorkflowContext } from "@/components/features/agents/agent-chat/agent-chat-workflow-context";
import { AgentRuntimeIcon } from "@/components/features/agents/agent-runtime-icon";
import { AgentStudioHeaderTitle } from "@/components/features/agents/agent-studio-header";
import { WorkflowRail } from "@/components/features/agents/agent-studio-header-workflow-rail";
import {
  SessionActionButton,
  SessionActionMenuTrigger,
} from "@/components/features/agents/session-action-button";
import { SessionPageHeader } from "@/components/features/agents/session-page-header";
import { Button } from "@/components/ui/button";
import { PANEL_TAB_KIND_RULES } from "@/features/session-panels/panel-tab-kinds";
import { previewWorkflow } from "@/features/session-navigation/session-preview-model";
import { cn } from "@/lib/utils";
import { noop, type TaskSessionEntry } from "./feature-tour-samples";

// The parts of a task session that the tour pictures show. Each part uses a real component of the
// app, or the exact markup of a part that reads app state. The parts have no menus or handlers,
// because the pictures only show the app.

type TourStudioProps = {
  session: TaskSessionEntry;
  /** The label of the main quick action of the header. */
  actionLabel: string;
  /** The latest transcript rows of the chat. */
  rows: readonly AgentChatTranscriptRow[];
  /** The review comments that the next message sends. */
  pendingComments?: number;
  /** The text that the user is typing. Without it, the composer shows its placeholder. */
  draft?: string | null;
  panel: ReactNode;
  /** The share of the right panel in the width, in percent. */
  panelShare: number;
};

/**
 * The task session of `session`: the header with the main quick action and the panel toggles, the
 * workflow rail, the chat with its composer, and the right panel.
 */
export function TourStudio({
  session,
  actionLabel,
  rows,
  pendingComments = 0,
  draft = null,
  panel,
  panelShare,
}: TourStudioProps): ReactElement {
  const { task } = session.context;
  const { role } = session.target;
  const { steps } = previewWorkflow(session, null);
  return (
    <>
      <SessionPageHeader
        title={
          <AgentStudioHeaderTitle
            taskTitle={task.title}
            taskId={task.id}
            onOpenTaskDetails={noop}
          />
        }
        actions={<TourQuickAction label={actionLabel} />}
        openIn={null}
        viewControls={
          <span className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-7 text-muted-foreground"
            >
              <PanelBottomOpen className="size-4" />
            </Button>
            <Button type="button" size="icon" variant="ghost" className="size-7 text-foreground">
              <PanelRightClose className="size-4" />
            </Button>
          </span>
        }
      />
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="@container/workflow min-w-0 shrink-0 overflow-hidden border-b border-border bg-card px-4 py-2">
            <WorkflowRail
              steps={steps}
              selectedStepId={steps.find((step) => step.role === role)?.id ?? null}
              onStepSelect={noop}
            />
          </div>
          <TourTranscript task={task} rows={rows}>
            <TourComposer role={role} pendingComments={pendingComments} draft={draft} />
          </TourTranscript>
        </div>
        <div
          className="min-w-0 shrink-0 border-l border-border"
          style={{ width: `${panelShare}%` }}
        >
          {panel}
        </div>
      </div>
    </>
  );
}

/** The main quick action of the session header, with its menu. */
function TourQuickAction({ label }: { label: string }): ReactElement {
  return (
    <span className="flex items-center">
      <SessionActionButton>
        <Zap className="size-3.5" />
        {label}
      </SessionActionButton>
      <SessionActionMenuTrigger />
    </span>
  );
}

const CODEX_PRESENTATION = resolveAgentChatRuntimePresentation({
  runtimeDefinitions: [],
  runtimeKind: "codex",
});

type TourTranscriptProps = {
  /** The task of the session, which the tool cards of the rows read. */
  task: TaskSessionEntry["context"]["task"];
  rows: readonly AgentChatTranscriptRow[];
  /** The composer under the rows. */
  children: ReactNode;
};

/** The real transcript rows of a session, in the scroll region of the chat, and the composer. */
function TourTranscript({ task, rows, children }: TourTranscriptProps): ReactElement {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-chat-background">
      {/* The chat shows its latest rows, as a chat scrolled to its end. */}
      <div className="flex min-h-0 flex-1 flex-col justify-end overflow-hidden px-4 pt-4">
        {/* Without settings, the transcript uses the default chat settings. */}
        <AgentChatSettingsProvider value={null}>
          <ChatWorkflowContext.Provider value={task}>
            {rows.map((row) => (
              <AgentChatThreadRow
                key={row.key}
                row={row}
                isStreamingAssistantMessage={false}
                sessionIdentity={null}
                runtimePresentation={CODEX_PRESENTATION}
              />
            ))}
          </ChatWorkflowContext.Provider>
        </AgentChatSettingsProvider>
      </div>
      {children}
    </div>
  );
}

type TourComposerProps = {
  /** The workflow role of the task session. */
  role: WorkflowRoleId;
  pendingComments: number;
  draft: string | null;
};

/** The chat composer of a task session. Its markup, because the real composer reads the session. */
function TourComposer({ role, pendingComments, draft }: TourComposerProps): ReactElement {
  return (
    <div className="shrink-0 px-4 pb-4 pt-3">
      <div className={ACTIVE_COMPOSER_CARD_CLASS_NAME}>
        <p
          className={cn(
            "px-3 pb-1 pt-3 text-[15px] leading-6",
            draft ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {/* The composer policy builds this placeholder from a full session state. */}
          {draft ?? "@ for files and subagents; / for commands; $ for skills"}
        </p>
        <div className="flex items-end gap-2 px-2 pb-2 pt-1">
          <div className="flex min-w-0 flex-auto items-center gap-1 text-xs text-muted-foreground">
            <span className="flex size-7 items-center justify-center">
              <Paperclip className="size-3.5" />
            </span>
            <TourComposerSelector icon={<Bot className="size-3.5" />} label={role} />
            <TourComposerSelector
              icon={<AgentRuntimeIcon runtimeKind="codex" className="size-3.5" />}
              label="gpt-6-astra"
            />
            <TourComposerSelector icon={<BrainCog className="size-3.5" />} label="high" />
          </div>
          <AgentChatComposerSendControl
            sendDisabled={false}
            showSubmittingState={false}
            pendingSendItems={
              pendingComments > 0
                ? [
                    {
                      key: "review_comments",
                      count: pendingComments,
                      accessibleLabel: `${pendingComments} review comment to send`,
                    },
                  ]
                : []
            }
          />
        </div>
      </div>
    </div>
  );
}

function TourComposerSelector({ icon, label }: { icon: ReactNode; label: string }): ReactElement {
  return (
    <span className="flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2">
      {icon}
      <span>{label}</span>
      <ChevronsUpDown className="size-3.5 opacity-60" />
    </span>
  );
}

// The CI Checks tab shows only when the task has a linked pull request.
const PANEL_TAB_KINDS = ["document", "diffs", "files"] as const;

/** The tab strip of the right panel of a task session. */
export function TourPanelTabs({
  selected,
}: {
  selected: (typeof PANEL_TAB_KINDS)[number];
}): ReactElement {
  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border bg-card px-1">
      {PANEL_TAB_KINDS.map((kind) => {
        const { label, icon: Icon } = PANEL_TAB_KIND_RULES[kind];
        const isSelected = kind === selected;
        return (
          <span
            key={kind}
            className={cn(
              "relative inline-flex h-7 max-w-48 shrink-0 items-center gap-1.5 rounded-md pl-2 pr-7 text-xs font-medium",
              isSelected
                ? "bg-muted text-foreground ring-1 ring-border ring-inset"
                : "text-muted-foreground",
            )}
          >
            <Icon className="size-3.5" />
            {label}
            {isSelected ? <X className="absolute right-1.5 size-3 text-muted-foreground" /> : null}
          </span>
        );
      })}
      <span className="flex size-7 shrink-0 items-center justify-center text-muted-foreground">
        <Plus className="size-4" />
      </span>
    </div>
  );
}
