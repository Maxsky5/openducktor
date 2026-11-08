// The Message Queue of a mobile session on the top edge of the composer, as message-queue-panel.tsx
// and queue-item-state.ts in apps/mobile/src/features/composer. A queued message is a card with a
// dashed outline that tucks under the composer card. A closed card shows one line and Queued. A
// tap opens the card: it shows the whole message and the actions Steer now, Edit queued message,
// and Remove queued message. A message on its way shows its spinner and its state, such as
// Steering…, instead of the actions. A scene changes `data-spread` and `data-state` of the card.
import { Clock3, LoaderCircle, Pencil, Trash2, Zap } from "lucide-react";
import type { ReactElement } from "react";
import "./MessageQueue.css";

/** The delivery labels of STATUS_LABELS in queue-item-state.ts that the scenes show. */
export const QUEUE_STATUS_LABELS = { queued: "Queued", steering: "Steering…" } as const;

/** The state of a queued message: it waits, or it is on its way to the running turn. */
export type QueueCardState = keyof typeof QUEUE_STATUS_LABELS;

type QueuePanelProps = {
  /** The text of the queued message. */
  text: string;
  hidden?: boolean | undefined;
};

export function QueuePanel({ text, hidden }: QueuePanelProps): ReactElement {
  return (
    <div className="mob-queue" data-queue="" hidden={hidden}>
      <div className="mob-queue-card" data-queue-card="" data-state="queued" data-spread="false">
        <span className="mob-queue-glyph">
          <Clock3 className="mob-queue-wait" />
          <LoaderCircle className="mob-queue-busy spin" />
        </span>
        <p className="mob-queue-text">{text}</p>
        <span className="mob-queue-status" data-for="queued">
          {QUEUE_STATUS_LABELS.queued}
        </span>
        <span className="mob-queue-status" data-for="steering">
          {QUEUE_STATUS_LABELS.steering}
        </span>
        <span className="mob-queue-actions">
          <span className="mob-queue-action" data-queue-action="steer">
            <Zap />
          </span>
          <span className="mob-queue-action" data-queue-action="edit">
            <Pencil />
          </span>
          <span className="mob-queue-action" data-queue-action="remove">
            <Trash2 />
          </span>
        </span>
      </div>
    </div>
  );
}
