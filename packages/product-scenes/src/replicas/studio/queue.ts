// The queued message stack of QueueStack.tsx. The stack CSS animates each change, as
// agent-chat-message-queue.css does, so the scenes only set the state of the stack.
import { all, must } from "../../motion/dom";

/** A queued message of the stack. */
export type QueuedCard = {
  id: string;
  text: string;
  /** The pointer rests on the card of an open stack: it shows its actions and the Steer now hint. */
  hover?: boolean;
};

/** The state of a queued message: it waits, or it is on its way to the agent. */
type QueuedState = "queued" | "sending" | "steering";

/** The count label of the front card, as QueuedMessageTrailing shows it. */
export function queueCountLabel(count: number): string {
  return count > 1 ? `${count} queued` : "Queued";
}

/** The steps of the queued message stack. */
export type QueueStackSteps = {
  card: (id: string) => HTMLElement;
  /** Empties the stack, closed and without a pointer. */
  clear: () => void;
  /** A new message rises out of the composer, in front of the stack. */
  add: (id: string) => void;
  /**
   * Opens or closes the stack. A closing stack keeps the whole messages until its cards have
   * shrunk back, as useLingeringFlag does.
   */
  spread: (state: "open" | "closing" | "closed") => void;
  /** Puts the pointer on the card `id`, or takes it off every card. */
  hover: (id: string | null) => void;
  /** Shows or hides the Steer now hint of the card `id`. */
  hint: (id: string, shown: boolean) => void;
  setState: (id: string, state: QueuedState) => void;
  /** The agent received the message: its card fades out, and the cards around it close the gap. */
  leave: (id: string) => void;
  /** Takes a card that left out of the layout. */
  remove: (id: string) => void;
};

/** The queued message stack in `root`. */
export function queueStack(root: HTMLElement): QueueStackSteps {
  const stack = must(root, "[data-queue]");
  const cards = all(stack, "[data-queue-card]");
  const card = (id: string): HTMLElement => must(stack, `[data-queue-card="${id}"]`);

  /** Gives each card in the queue its depth, and the stack its count. A leaving card keeps its place. */
  const layout = (): void => {
    const queued = cards.filter((item) => !item.hidden && item.dataset.presence !== "exiting");
    const count = queued.length;
    stack.dataset.count = String(count);
    stack.style.setProperty("--queue-count", String(count));
    for (const [index, item] of queued.entries()) {
      const depth = count - 1 - index;
      item.dataset.depth = String(depth);
      item.dataset.buried = String(depth > 2);
      item.style.setProperty("--queue-depth", String(depth));
      must(item, "[data-queue-count]").textContent = queueCountLabel(count);
    }
  };

  const spread = (state: "open" | "closing" | "closed"): void => {
    stack.dataset.spread = String(state === "open");
    stack.toggleAttribute("data-full", state === "closing");
  };

  return {
    card,
    clear: () => {
      spread("closed");
      for (const item of cards) {
        item.hidden = true;
        item.dataset.state = "queued";
        item.removeAttribute("data-hover");
        must(item, "[data-queue-tooltip]").hidden = true;
      }
      layout();
    },
    add: (id) => {
      const item = card(id);
      item.dataset.animateEntry = "true";
      item.hidden = false;
      layout();
    },
    spread,
    hover: (id) => {
      for (const item of cards) item.toggleAttribute("data-hover", item.dataset.queueCard === id);
    },
    hint: (id, shown) => {
      must(card(id), "[data-queue-tooltip]").hidden = !shown;
    },
    setState: (id, state) => {
      card(id).dataset.state = state;
    },
    leave: (id) => {
      card(id).dataset.presence = "exiting";
      layout();
    },
    remove: (id) => {
      const item = card(id);
      item.hidden = true;
      delete item.dataset.presence;
    },
  };
}
