// The composer of agent-chat-composer.tsx: the draft, the attach button, the model picker trigger,
// the context meter, and the send and stop buttons. The trigger sums up the runtime, the agent
// profile of OpenCode, the model, the effort, and a speed above Standard. The running ray circles
// the box while an agent works. The children hold more draft content, the menu opens above the
// draft, the queue holds the queued messages above the box, and the goal row sits on the top edge
// of the box.
import { Paperclip, SendHorizontal, Square } from "lucide-react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import type { RuntimeKind } from "../../sample/models";
import { contextUse, type Session } from "../../sample/sessions";
import { compactTokens } from "../format";
import { type KeyLabels, steerKey } from "../keys";
import type { Activity } from "../vocabulary";
import { ModelTrigger } from "../models/ModelTrigger";
import { Ray } from "../ui/Ray";
import "./Composer.css";

/**
 * The runtimes whose composer references subagents with @: supportsSubagentReferences of the
 * prompt input capabilities in runtime-descriptors.ts. Each runtime also searches files and offers
 * commands and skills.
 */
const SUBAGENT_REFERENCES = {
  opencode: true,
  codex: false,
  claude: false,
  antigravity: false,
} as const satisfies Record<RuntimeKind, boolean>;

/** The trigger hints of the placeholder on `runtime`, as agent-chat-composer-policy.ts writes them. */
export function composerHints(runtime: RuntimeKind): string {
  const reference = SUBAGENT_REFERENCES[runtime] ? "@ for files and subagents" : "@ for files";
  return `${reference}; / for commands; $ for skills`;
}

/** The keys that queue and steer, which the placeholder adds while the agent works. */
export function queueHints(keys: KeyLabels): string {
  return `Enter to queue; ${steerKey(keys)} to steer`;
}

/** The pending items that the send button counts, as agent-chat-composer-pending-items.tsx does. */
type SendBadge = { kind: "comments" | "annotations"; count: number };

type ComposerProps = {
  session: Session;
  /** The keys of the platform. The placeholder names the steer shortcut while the agent works. */
  keys: KeyLabels;
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
  /** The agent profile of a runtime with agent profiles, such as build of OpenCode. */
  agent?: string;
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
      <ModelTrigger variant="composer" value={{ ...session, profile: agent }} />
    </span>
  );
}

export function Composer({
  session,
  keys,
  sendBadge,
  activity = "idle",
  menu,
  queue,
  goal,
  agent,
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
              {composerHints(session.runtime)}
              <span className="when-working">{`; ${queueHints(keys)}`}</span>
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
