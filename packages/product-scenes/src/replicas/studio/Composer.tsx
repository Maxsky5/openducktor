// The composer of agent-chat-composer.tsx: the draft, the runtime and model, the effort, the speed
// of a model that offers more than Standard, the context meter, and the send and stop buttons. The
// running ray circles the box while an agent works. The children hold more draft content, the
// menu opens above the draft, the queue holds the queued messages above the box, and the goal row
// sits on the top edge of the box. A runtime with agent profiles shows the agent before the model.
import {
  Bot,
  BrainCog,
  ChevronsUpDown,
  Paperclip,
  SendHorizontal,
  Square,
  Zap,
  ZapOff,
} from "lucide-react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { modelName } from "../../sample/models";
import { contextUse, type Session } from "../../sample/sessions";
import { compactTokens } from "../format";
import type { Activity } from "../vocabulary";
import { Ray } from "../ui/Ray";
import { RuntimeIcon } from "../ui/RuntimeIcon";
import "./Composer.css";

/** The pending items that the send button counts, as agent-chat-composer-pending-items.tsx does. */
type SendBadge = { kind: "comments" | "annotations"; count: number };

type ComposerProps = {
  session: Session;
  /**
   * The send button counts the review comments or the browser annotations that the next message
   * sends. A scene changes the count. The badge hides at 0.
   */
  sendBadge?: SendBadge;
  /** The activity of the static frame. A scene changes `data-activity` of the box. */
  activity?: Activity;
  /** The menu above the draft, such as the slash commands. */
  menu?: ReactNode;
  /** The queued messages above the box. */
  queue?: ReactNode;
  /** The goal row on the top edge of the box, under the queue. */
  goal?: ReactNode;
  /** The agent of a runtime with agent profiles, such as build of OpenCode. */
  agent?: string;
  /**
   * The steer shortcut of the platform, such as ⌘ Enter. While the agent works, the placeholder
   * adds the queue keys of agent-chat-composer-policy.ts. Without it, the placeholder shows none.
   */
  steerKey?: string;
  /** More draft content after the placeholder. */
  children?: ReactNode;
};

function ModelControls({
  session,
  agent,
}: {
  session: Session;
  agent: string | undefined;
}): ReactElement {
  return (
    <span>
      <span className="st-attach">
        <Paperclip className="i14" />
      </span>
      {agent && (
        <span className="st-chip agent">
          <Bot className="i14" />
          <span>{agent}</span>
          <ChevronsUpDown />
        </span>
      )}
      <span className="st-chip">
        <RuntimeIcon kind={session.runtime} />
        <span data-model="">{modelName(session)}</span>
        <ChevronsUpDown />
      </span>
      <span className="st-chip effort">
        <BrainCog className="i14" />
        <span data-effort="">{session.effort}</span>
        <ChevronsUpDown />
      </span>
      {session.speed && (
        <span className="st-speed" data-speed={session.speed}>
          {session.speed === "fast" ? <Zap /> : <ZapOff />}
        </span>
      )}
    </span>
  );
}

export function Composer({
  session,
  sendBadge,
  activity = "idle",
  menu,
  queue,
  goal,
  agent,
  steerKey,
  children,
}: ComposerProps): ReactElement {
  const context = contextUse(session);
  const meter: CSSProperties & { "--used": number } = { "--used": context.percent };
  return (
    <div className="st-composer">
      {queue}
      {goal}
      <div className="st-box" data-activity={activity} data-composer="">
        <Ray className="st-ray" />
        <div className="st-draft">
          {menu}
          <div className="st-editor" data-editor="">
            <span className="when-ready">
              @ for files; / for commands; $ for skills
              {steerKey && (
                <span className="when-working">{`; Enter to queue; ${steerKey} to steer`}</span>
              )}
            </span>
            {children}
          </div>
        </div>
        <div className="st-controls">
          <ModelControls session={session} agent={agent} />
          <span>
            <span className="st-context" style={meter} data-meter="">
              <svg className="st-ring" viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="8" cy="8" r="6" />
                <circle cx="8" cy="8" r="6" pathLength={100} />
              </svg>
              <small data-tokens="">{compactTokens(context.tokens)}</small>
            </span>
            <span className="st-actions">
              <span className="st-stop">
                <Square className="i12" />
              </span>
              <span className="st-send" data-send="">
                <SendHorizontal className="i14" />
                {sendBadge && (
                  <b className="st-send-badge" data-tone={sendBadge.kind} data-send-badge="">
                    {sendBadge.count > 0 ? sendBadge.count : null}
                  </b>
                )}
              </span>
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * The draft that a scene types over the placeholder, with composerDraft of shell/composer.ts. The
 * children come before the typed text, such as a chip.
 */
export function ComposerDraft({ children }: { children?: ReactNode }): ReactElement {
  return (
    <span className="st-draft-text">
      {children}
      <span className="typed" data-typed="" />
    </span>
  );
}
