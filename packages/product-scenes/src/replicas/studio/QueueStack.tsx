// Queued messages stacked on the top edge of the composer, newest in front. A closed stack shows
// the start of the front message, and the older cards peek behind it. An open stack shows every
// message in full, and the card under the pointer shows its actions. Sources:
// agent-chat-queued-message-stack.tsx and agent-chat-message-queue.css.
//
// queue.ts changes the stack: `data-count` and `--queue-count` hold the number of cards, and
// `data-depth` and `--queue-depth` hold the place of a card, where 0 is the front card.
import { Clock3, LoaderCircle, Pencil, Trash } from "lucide-react";
import type { CSSProperties, ReactElement } from "react";
import { flag } from "../flag";
import { Zap } from "../ui/Zap";
import { type QueuedCard, queueCountLabel } from "./queue";
import "./QueueStack.css";

type QueueStackProps = {
  /** In delivery order: the first card goes out first, and the last card is in front. */
  cards: readonly QueuedCard[];
  spread?: boolean;
};

/** The hint of Steer now in QueuedMessageActions. */
const STEER_HINT = "Send this message to the running work now";

/** The actions of a card: Steer now, Edit queued message, and Remove queued message. */
function Actions({ hover }: { hover: boolean }): ReactElement {
  return (
    <span className="qs-actions">
      <span className="qs-action" data-queue-action="steer">
        <Zap className="i14" />
        <span className="qs-tooltip" data-queue-tooltip="" hidden={!hover}>
          {STEER_HINT}
          <i />
        </span>
      </span>
      <span className="qs-action" data-queue-action="edit">
        <Pencil className="i14" />
      </span>
      {/* Trash of lucide-react 1 is Trash2 of the app. */}
      <span className="qs-action" data-queue-action="remove">
        <Trash className="i14" />
      </span>
    </span>
  );
}

function Card({
  card,
  depth,
  count,
}: {
  card: QueuedCard;
  depth: number;
  count: number;
}): ReactElement {
  const style: CSSProperties & { "--queue-depth": number } = { "--queue-depth": depth };
  return (
    <li
      className="qs-card"
      data-queue-card={card.id}
      data-depth={depth}
      data-buried={String(depth > 2)}
      data-state="queued"
      data-hover={flag(card.hover)}
      style={style}
    >
      <div className="qs-surface">
        <div className="qs-content">
          <span className="qs-glyph">
            <Clock3 className="i14 qs-wait" />
            <LoaderCircle className="i14 spin qs-busy" />
          </span>
          <p className="qs-text">{card.text}</p>
        </div>
        <div className="qs-trailing">
          <span className="qs-count" data-queue-count="">
            {queueCountLabel(count)}
          </span>
          <Actions hover={card.hover ?? false} />
          <span className="qs-delivery" data-for="sending">
            Sending…
          </span>
          <span className="qs-delivery" data-for="steering">
            Steering…
          </span>
        </div>
      </div>
    </li>
  );
}

export function QueueStack({ cards, spread = false }: QueueStackProps): ReactElement {
  const count = cards.length;
  const style: CSSProperties & { "--queue-count": number } = { "--queue-count": count };
  return (
    <div
      className="qs-stack"
      data-queue=""
      data-count={count}
      data-spread={String(spread)}
      style={style}
    >
      <ol className="qs-list">
        {cards.map((card, index) => (
          <Card key={card.id} card={card} depth={count - 1 - index} count={count} />
        ))}
      </ol>
    </div>
  );
}
