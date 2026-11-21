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

type QueuePanelProps = {
  /** The text of the queued message. */
  text: string;
  hidden?: boolean | undefined;
};

export function QueuePanel({ text, hidden }: QueuePanelProps): ReactElement {
  return (
    <div className="mob-queue" data-queue="" hidden={hidden}>
      <div className="mob-queue-card" data-queue-card="" data-state="queued" data-spread="false">
        <span className="mob-queue-content" data-queue-open="" data-feedback="opacity">
          <span className="mob-queue-glyph">
            <Clock3 className="mob-queue-wait" />
            <LoaderCircle className="mob-queue-busy spin" />
          </span>
          <p className="mob-queue-text">{text}</p>
        </span>
        <span className="mob-queue-status" data-for="queued">
          {QUEUE_STATUS_LABELS.queued}
        </span>
        <span className="mob-queue-status" data-for="steering">
          {QUEUE_STATUS_LABELS.steering}
        </span>
        <span className="mob-queue-actions">
          <span className="mob-queue-action" data-queue-action="steer" data-feedback="opacity">
            <Zap />
          </span>
          <span className="mob-queue-action" data-queue-action="edit" data-feedback="opacity">
            <Pencil />
          </span>
          <span className="mob-queue-action" data-queue-action="remove" data-feedback="opacity">
            <Trash2 />
          </span>
        </span>
      </div>
    </div>
  );
}
