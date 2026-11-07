// A workspace chat on the session page: the top bar of workspace-session-header.tsx, and the agent
// chat surface with its composer, slash menu, and task tools. The right panel is hidden. The
// templates hold the task details of a new task, the start dialog of its Builder, and the
// notification of the start. Sources: packages/frontend/src/pages/workspace-sessions and
// packages/frontend/src/components/features/agents/agent-chat.
import { Archive, Bot, ChevronDown, ChevronRight, Folder, Terminal } from "lucide-react";
import type { ReactElement } from "react";
import { SceneFrame, type SceneViewProps } from "../../frame/SceneFrame";
import { Stock } from "../../frame/Stock";
import { flag } from "../../replicas/flag";
import { AppWindow } from "../../replicas/shell/AppWindow";
import { Pointer } from "../../replicas/shell/Pointer";
import { Toast } from "../../replicas/shell/Toast";
import { ToastStack } from "../../replicas/shell/ToastStack";
import { ChatColumn } from "../../replicas/studio/ChatColumn";
import { Composer } from "../../replicas/studio/Composer";
import { OpenInMenu } from "../../replicas/studio/OpenInMenu";
import { PanelToggles } from "../../replicas/studio/PanelToggles";
import { RepoActions } from "../../replicas/studio/RepoActions";
import { SessionHeader } from "../../replicas/studio/SessionHeader";
import { StartDialog } from "../../replicas/studio/StartDialog";
import { TaskSheet } from "../../replicas/tasks/TaskSheet";
import { AgentText } from "../../replicas/transcript/AgentText";
import { TaskResult } from "../../replicas/transcript/TaskResult";
import { Thread } from "../../replicas/transcript/Thread";
import { ToolRow } from "../../replicas/transcript/ToolRow";
import { UserMessage } from "../../replicas/transcript/UserMessage";
import { signature } from "../../sample/sessions";
import { BUILDER_SESSION } from "../../sample/studio";
import { studioNav } from "../../sample/studio-nav";
import { taskId } from "../../sample/workspace";
import { OPEN_IN_TERMINAL } from "../../sample/worktree";
import {
  BUILDER,
  CHAT,
  CHAT_ENTRY,
  CHAT_SESSION,
  type ChatTemplate,
  COMMANDS,
  CREATED_TASKS,
  EXISTING,
  MENU_TASK,
  MESSAGE,
  SEARCH,
  STARTED,
} from "./sample";
import "./view.css";

/**
 * The last frame: the turn ended, and the chat settled at the top of Recent. The Builder of the
 * new task runs at the top of Running.
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
          description="Start a fresh session for Start Implementation."
          session={BUILDER_SESSION}
          target="origin/main"
          background
        />
      </Stock>
      <Stock name={"toast-started" satisfies ChatTemplate}>
        <Toast {...STARTED} />
      </Stock>
    </>
  );
}

/** The top bar of the chat: its title, the chat actions, Open In, and the panel toggles. */
function ChatHeader(): ReactElement {
  return (
    <SessionHeader
      title={
        <span className="sh-name">
          <span>{CHAT.title}</span>
        </span>
      }
    >
      <RepoActions />
      <span className="sh-icon">
        <Bot className="i14" />
      </span>
      <span className="sh-icon">
        <Folder />
      </span>
      <span className="sh-split">
        <span className="sh-split-main">
          <Archive />
          <span>Archive</span>
        </span>
        <span className="sh-split-menu">
          <ChevronDown />
        </span>
      </span>
      <OpenInMenu tool={OPEN_IN_TERMINAL} appIcon />
      <PanelToggles right={false} />
    </SessionHeader>
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

export function ChatView(props: SceneViewProps): ReactElement {
  return (
    <SceneFrame
      {...props}
      name="chat"
      alt="A session outside a task, with the Product planner role on Claude Code. The visitor types /tasks- and picks the reusable prompt /tasks-from-request, then adds the request Export notebooks to Markdown and PDF. The agent searches the tasks for export and finds the Markdown export task. Then it creates the two tasks that are missing: a PDF export and an Export item in the notebook menu. The visitor opens the menu task from its card, and its details slide in over the session. The visitor clicks Start Builder and runs the Builder in the background. The session stays on screen, and the new Builder session shows in the Running group of the sidebar."
      stock={<ChatStock />}
    >
      <AppWindow
        chrome={{ sidebar: "collapsed", nav: { scope: "current", entries: NAV } }}
        keys={props.keys}
        className="chat-window"
        data-runtime={CHAT_SESSION.runtime}
        overlay={<Pointer />}
      >
        <ChatHeader />
        <ChatColumn className="ch-column">
          <ChatThread />
          <Composer session={CHAT_SESSION} menu={<SlashMenu />}>
            <span className="ch-draft">
              <span className="ch-chip" hidden data-chip="">
                {`/${COMMANDS[0]?.trigger}`}
              </span>
              <span className="typed" data-typed="" />
            </span>
          </Composer>
        </ChatColumn>
        <ToastStack />
      </AppWindow>
    </SceneFrame>
  );
}
