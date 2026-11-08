// The composer of a mobile session, as session-composer.tsx and composer-controls.tsx in
// apps/mobile/src/features/composer: the message field with the placeholder of the composer
// policy, and the bar with attach, the model and effort, the context ring, Stop, and Send. While
// the agent works, the runtime ray circles the card and Stop shows. While a request waits, the
// card has the warning outline and the placeholder asks for the reply. A scene changes
// `data-activity` with composerActivity of replicas/shell/composer.ts. A scene types a draft into
// `data-typed` and sets `data-draft` on the card: the draft replaces the placeholder, Send opens,
// and the second send control shows while the agent works.
import { ChevronsUpDown, ListPlus, Paperclip, SendHorizontal, Zap } from "lucide-react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { modelName } from "../../sample/models";
import type { Session } from "../../sample/sessions";
import { Ray } from "../ui/Ray";
import { RuntimeIcon } from "../ui/RuntimeIcon";
import type { Activity } from "../vocabulary";
import "./MobileComposer.css";

/** The placeholders of agent-chat-composer-policy.ts and agent-session-waiting-input.ts. */
export const COMPOSER_PLACEHOLDERS = {
  ready: "@ for files; / for commands; $ for skills",
  approval: "Respond to the pending approval request above to continue",
} as const;

type MobileComposerProps = {
  session: Session;
  activity: Activity;
  /** The Message Queue on the top edge of the card, as `QueuePanel` of MessageQueue.tsx. */
  queue?: ReactNode;
  /** The notice at the top of the card, such as the pending review comments. */
  notice?: ReactNode;
  /** The second send control while a turn runs: Steer, or Queue when Send steers by default. */
  secondary?: "steer" | "queue";
  /**
   * The review comments that go with the next message. Their count sits on the corner of Send
   * while the card has `data-comments`, and Send opens then. The card has it when the count is
   * above 0, and a scene removes it when the message goes.
   */
  pendingCount?: number;
};

export function MobileComposer({
  session,
  activity,
  queue,
  notice,
  secondary,
  pendingCount = 0,
}: MobileComposerProps): ReactElement {
  const meter: CSSProperties & { "--used": number } = { "--used": session.used };
  return (
    <div className="mob-composer" data-runtime={session.runtime}>
      {queue}
      <div
        className="mob-composer-card"
        data-activity={activity}
        data-composer=""
        data-comments={pendingCount > 0 ? "" : undefined}
      >
        <Ray className="mob-composer-ray" />
        {notice}
        <p className="mob-composer-field">
          <span className="mob-composer-typed" data-typed="" />
          <span className="mob-composer-hint" data-for="ready">
            {COMPOSER_PLACEHOLDERS.ready}
          </span>
          <span className="mob-composer-hint" data-for="waiting">
            {COMPOSER_PLACEHOLDERS.approval}
          </span>
        </p>
        <div className="mob-composer-bar">
          <span className="mob-composer-quiet">
            <Paperclip />
          </span>
          <span className="mob-composer-model">
            <RuntimeIcon kind={session.runtime} />
            <span className="mob-composer-model-name">{modelName(session)}</span>
            <span className="mob-composer-effort">· {session.effort}</span>
            <ChevronsUpDown />
          </span>
          <svg className="mob-composer-ring" style={meter} viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="6" />
            <circle cx="8" cy="8" r="6" pathLength={100} />
          </svg>
          {secondary && (
            <span className="mob-composer-secondary" data-secondary={secondary}>
              {secondary === "steer" ? <Zap /> : <ListPlus />}
            </span>
          )}
          <span className="mob-composer-stop" data-stop="">
            <i />
          </span>
          <span className="mob-composer-send" data-send="">
            <SendHorizontal />
          </span>
          {pendingCount > 0 && (
            <span className="mob-composer-count" data-send-count="">
              {pendingCount}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
