// A workspace chat on the session page: the top bar of workspace-session-header.tsx, and the agent
// chat surface with its composer, slash menu, and task tools. The right panel is hidden. The
// templates hold the task details of a new task and the start dialog of its Builder. The last
// frame shows the startup notification of the ready Builder. Sources: packages/frontend/src/pages/workspace-sessions and
// packages/frontend/src/components/features/agents/agent-chat.
import { Bot, ChevronRight, Terminal } from "lucide-react";
import type { ReactElement } from "react";
import { SceneFrame, type SceneViewProps } from "../../frame/SceneFrame";
import { Stock } from "../../frame/Stock";
import { flag } from "../../replicas/flag";
import { AppWindow } from "../../replicas/shell/AppWindow";
import { Pointer } from "../../replicas/shell/Pointer";
import { StartupToast } from "../../replicas/shell/StartupToast";
import { ToastStack } from "../../replicas/shell/ToastStack";
import { ChatColumn } from "../../replicas/studio/ChatColumn";
import { Composer, ComposerDraft } from "../../replicas/studio/Composer";
import { RepoActions } from "../../replicas/studio/RepoActions";
import { StartDialog } from "../../replicas/studio/StartDialog";
import { WorkspaceSessionHeader } from "../../replicas/studio/WorkspaceSessionHeader";
import { TaskSheet } from "../../replicas/tasks/TaskSheet";
import { AgentText } from "../../replicas/transcript/AgentText";
import { TaskResult } from "../../replicas/transcript/TaskResult";
import { Thread } from "../../replicas/transcript/Thread";
import { ToolRow } from "../../replicas/transcript/ToolRow";
import { UserMessage } from "../../replicas/transcript/UserMessage";
import { COMMANDS } from "../../sample/commands";
import { signature } from "../../sample/sessions";
import { BUILDER_SESSION } from "../../sample/studio";
import { studioNav } from "../../sample/studio-nav";
import { taskId } from "../../sample/workspace";
import {
  BUILDER,
  CHAT,
  CHAT_ENTRY,
  CHAT_SESSION,
  type ChatTemplate,
  CREATED_TASKS,
  EXISTING,
  MENU_TASK,
  MESSAGE,
  ORIGIN,
  SEARCH,
  STEPS,
} from "./sample";
import "./view.css";

/** The options of the chat scene. */
export type ChatOptions = {
  /**
   * The window is short, such as on a page of the documentation. The transcript then follows the
   * stream, and its first rows leave at the top. The website shows the full window, so the still
   * frame of reduced motion shows the request too.
   */
  compact: boolean;
};

/**
 * The last frame: the turn ended, and the chat settled at the top of Recent. The Builder of the
 * new task runs at the top of Running, and its startup notification shows it ready.
 */
const NAV = [BUILDER, ...studioNav({ ...CHAT_ENTRY, time: "now", selected: true })];

function ChatStock(): ReactElement {
  return (
    <>
      <Stock name={"sheet" satisfies ChatTemplate}>
        <TaskSheet task={MENU_TASK} />
      </Stock>
      <Stock name={"builder-dialog" satisfies ChatTemplate}>
        <StartDialog
          role="Builder"
          session={BUILDER_SESSION}
          target="origin/main"
          background
          goal
        />
      </Stock>
    </>
  );
}

/** The top bar of the chat: its title, the chat actions, Open In, and the panel toggles. */
function ChatHeader(): ReactElement {
  return (
    <WorkspaceSessionHeader title={CHAT.title}>
      <RepoActions />
      <span className="sh-icon">
        <Bot className="i14" />
      </span>
    </WorkspaceSessionHeader>
  );
}

/** The reusable prompts whose trigger matches the slash query. */
function SlashMenu(): ReactElement {
  return (
    <div className="ch-slash" data-slash="">
      {COMMANDS.map((command, index) => (
        <span className="ch-command" data-active={flag(index === 0)} key={command.trigger}>
          <span className="ch-command-icon">
            <Terminal className="i14" />
          </span>
          <span className="ch-command-text">
            <span className="ch-command-name">
              <span>{`/${command.trigger}`}</span>
              <small>custom</small>
            </span>
            <span className="ch-command-desc">{command.description}</span>
          </span>
          <ChevronRight className="ch-command-chevron" />
        </span>
      ))}
    </div>
  );
}

/** The turn: the message, the task search, and the tasks that the agent creates. */
function ChatThread(): ReactElement {
  return (
    <Thread>
      <UserMessage time="10:24:12 AM" row="message">
        {MESSAGE}
      </UserMessage>
      <ToolRow
        kind="tool"
        name="search_tasks"
        args={SEARCH.done}
        duration="212ms"
        time="10:24:15 AM"
        row="search"
      />
      <AgentText row="plan">
        <p>
          <code>{EXISTING}</code> already covers the Markdown export. I will create the two tasks
          that are missing.
        </p>
      </AgentText>
      {CREATED_TASKS.map((task) => (
        <ToolRow
          kind="tool"
          name="create_task"
          args={task.title}
          duration="64ms"
          time={task.time}
          row={`create-${task.id}`}
          key={task.id}
        >
          <TaskResult task={task} />
        </ToolRow>
      ))}
      <AgentText signature={signature(CHAT_SESSION)} worked="14s" row="final">
        <p>
          The two new tasks are in Backlog. The PDF export is a feature, so it starts with a spec.{" "}
          <code>{taskId(MENU_TASK.id)}</code> is a task, so its Builder can start now.
        </p>
      </AgentText>
    </Thread>
  );
}

export function ChatView({
  options: { compact },
  ...props
}: SceneViewProps & { options: ChatOptions }): ReactElement {
  return (
    <SceneFrame
      {...props}
      name="chat"
      alt="A session outside a task, with the Product planner role on Claude Code. The visitor types /tasks- and picks the reusable prompt /tasks-from-request, then adds the request Export notebooks to Markdown and PDF. The agent searches the tasks for export and finds the Markdown export task. Then it creates the two tasks that are missing: a PDF export and an Export item in the notebook menu. The visitor opens the menu task from its card, and its details slide in over the session. The visitor clicks Start Builder and selects Run in background. The dialog closes, and a notification shows the startup steps of the Builder: Create task worktree, Set branch upstream, and Start session. The session stays on screen. The notification shows Builder session ready, and the new Builder session shows in the Running group of the sidebar."
      stock={<ChatStock />}
    >
      <AppWindow
        chrome={{ sidebar: "collapsed", nav: { scope: "current", entries: NAV } }}
        keys={props.keys}
        className="chat-window"
        data-runtime={CHAT_SESSION.runtime}
        data-compact={flag(compact)}
        overlay={<Pointer />}
      >
        <ChatHeader />
        <ChatColumn className="ch-column">
          <ChatThread />
          <Composer session={CHAT_SESSION} menu={<SlashMenu />}>
            <ComposerDraft>
              <span className="ch-chip" hidden data-chip="">
                {`/${COMMANDS[0]?.trigger}`}
              </span>
            </ComposerDraft>
          </Composer>
        </ChatColumn>
        <ToastStack>
          <StartupToast role="Builder" origin={ORIGIN} steps={STEPS} ready />
        </ToastStack>
      </AppWindow>
    </SceneFrame>
  );
}
