// The composer of agent-chat-composer.tsx: the draft, the runtime and model, the effort, the speed
// of a model that offers more than Standard, the context meter, and the send and stop buttons. The
// running ray circles the box while an agent works. The children hold more draft content, and the
// menu opens above the draft.
import {
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
import { Ray } from "../ui/Ray";
import { RuntimeIcon } from "../ui/RuntimeIcon";
import "./Composer.css";

type ComposerProps = {
  session: Session;
  /** The send button counts the review comments that the next message sends. */
  commentCount?: boolean;
  /** The menu above the draft, such as the slash commands. */
  menu?: ReactNode;
  /** More draft content after the placeholder. */
  children?: ReactNode;
};

function ModelControls({ session }: { session: Session }): ReactElement {
  return (
    <span>
      <span className="st-attach">
        <Paperclip className="i14" />
      </span>
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
  commentCount = false,
  menu,
  children,
}: ComposerProps): ReactElement {
  const context = contextUse(session);
  const meter: CSSProperties & { "--used": number } = { "--used": context.percent };
  return (
    <div className="st-composer">
      <div className="st-box" data-activity="idle" data-composer="">
        <Ray className="st-ray" />
        <div className="st-draft">
          {menu}
          <div className="st-editor" data-editor="">
            <span className="when-ready">@ for files; / for commands; $ for skills</span>
            {children}
          </div>
        </div>
        <div className="st-controls">
          <ModelControls session={session} />
          <span>
            <span className="st-context" style={meter} data-meter="">
              <svg className="st-ring" viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="8" cy="8" r="6" />
                <circle cx="8" cy="8" r="6" pathLength={100} />
              </svg>
              <small data-tokens="">{compactTokens(context.tokens)}</small>
            </span>
            <span className="st-stop">
              <Square className="i12" />
            </span>
            <span className="st-send" data-send="">
              <SendHorizontal className="i14" />
              {commentCount && <b className="st-send-badge" data-send-badge="" />}
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
