import {
  type ReactElement,
  type RefObject,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { UserMessageContent, UserMessageFirstLine } from "../agent-chat-message-card-content";
import type { AgentChatMessage } from "@openducktor/frontend-core/types/agent-orchestrator";
import type { AgentChatUserMessageAnchor } from "../agent-chat-transcript-model";
import { MINIMAP_TICK_LENGTH_PX, MINIMAP_TICK_LEFT_PX } from "./constants";
import type { MinimapTick } from "./conversation-minimap-layout";

type ConversationMinimapPreviewProps = {
  anchors: AgentChatUserMessageAnchor[];
  ticks: MinimapTick[];
  /** The tick that the card previews, or null when the card is closed. */
  cardTick: number | null;
  spacing: number;
  markedMessage: number | null;
  railRef: RefObject<HTMLDivElement | null>;
  frame: HTMLElement;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onMarkMessage: (message: number) => void;
  onJump: (message: number) => void;
  onDismiss: () => void;
};

/**
 * A card beside the crest tick. It is a pointer surface, hidden from assistive technology, because
 * the rail options already name every message. It never takes focus.
 */
export function ConversationMinimapPreview({
  anchors,
  ticks,
  cardTick,
  spacing,
  markedMessage,
  railRef,
  frame,
  onPointerEnter,
  onPointerLeave,
  onMarkMessage,
  onJump,
  onDismiss,
}: ConversationMinimapPreviewProps): ReactElement {
  // The card keeps its last tick while it closes, so its exit animation shows that message.
  const [shownTick, setShownTick] = useState(cardTick);
  if (cardTick !== null && cardTick !== shownTick) {
    setShownTick(cardTick);
  }
  const tick = shownTick === null ? undefined : ticks[shownTick];
  const singleMessage =
    tick && tick.endMessage - tick.firstMessage === 1
      ? anchors[tick.firstMessage]?.message
      : undefined;
  const virtualTick = useMemo(() => {
    const tickTop = (shownTick ?? 0) * spacing;
    return {
      current: {
        // The card follows scroll, resize, and moves of the rail.
        get contextElement() {
          return railRef.current ?? undefined;
        },
        getBoundingClientRect: () => {
          const rail = railRef.current?.getBoundingClientRect();
          if (!rail) return new DOMRect();
          return new DOMRect(
            rail.left + MINIMAP_TICK_LEFT_PX,
            rail.top + tickTop,
            MINIMAP_TICK_LENGTH_PX,
            spacing,
          );
        },
      },
    };
  }, [shownTick, spacing, railRef]);

  return (
    <Popover
      open={cardTick !== null && tick !== undefined}
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
    >
      <PopoverAnchor virtualRef={virtualTick} />
      {tick ? (
        <PopoverContent
          aria-hidden="true"
          side="right"
          align="center"
          collisionPadding={8}
          collisionBoundary={frame}
          // Inside a dialog, the card goes into the dialog, so it shows above the dialog layer.
          portalContainer={frame.closest<HTMLElement>("[data-slot='dialog-content']")}
          className="w-80 max-h-[var(--radix-popover-content-available-height)] overflow-hidden p-0 text-sm text-popover-foreground"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          // Pointer and focus events on the rail drive the card, so they do not close it.
          onInteractOutside={(event) => {
            if (event.target instanceof Node && railRef.current?.contains(event.target)) {
              event.preventDefault();
            }
          }}
          // A click jumps without moving focus, for example out of the composer. The card buttons
          // are outside the tab order, because the rail options give the keyboard path.
          onMouseDown={(event) => event.preventDefault()}
          onPointerEnter={onPointerEnter}
          onPointerLeave={onPointerLeave}
        >
          {singleMessage ? (
            <SingleMessagePreview
              message={singleMessage}
              onJump={() => onJump(tick.firstMessage)}
            />
          ) : (
            <GroupPreview
              // Each group starts with its list scrolled to the top.
              key={tick.firstMessage}
              anchors={anchors}
              tick={tick}
              markedMessage={markedMessage}
              onMarkMessage={onMarkMessage}
              onJump={onJump}
            />
          )}
        </PopoverContent>
      ) : null}
    </Popover>
  );
}

function SingleMessagePreview({
  message,
  onJump,
}: {
  message: AgentChatMessage;
  onJump: () => void;
}): ReactElement {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [isCut, setIsCut] = useState(false);
  // The card sets its height cap after it measures its position, so the body can shrink later.
  useLayoutEffect(() => {
    void message;
    const body = bodyRef.current;
    if (!body) return;
    const readIsCut = () => setIsCut(body.scrollHeight > body.clientHeight + 1);
    readIsCut();
    const observer = new ResizeObserver(readIsCut);
    observer.observe(body);
    return () => observer.disconnect();
  }, [message]);

  return (
    <div className="relative px-3.5 py-2.5">
      {/* Six lines of the transcript text (`leading-6`), or less when the window has less room.
          The cap subtracts the vertical padding of this card. */}
      <div
        ref={bodyRef}
        inert
        className={cn(
          "max-h-[min(9rem,calc(var(--radix-popover-content-available-height)-1.25rem))] overflow-hidden",
          isCut && "mask-b-from-[calc(100%-1.5rem)]",
        )}
      >
        <UserMessageContent message={message} />
      </div>
      <JumpCover onClick={onJump} />
    </div>
  );
}

function GroupPreview({
  anchors,
  tick,
  markedMessage,
  onMarkMessage,
  onJump,
}: {
  anchors: AgentChatUserMessageAnchor[];
  tick: MinimapTick;
  markedMessage: number | null;
  onMarkMessage: (message: number) => void;
  onJump: (message: number) => void;
}): ReactElement {
  const listRef = useRef<HTMLUListElement | null>(null);
  const members = anchors.slice(tick.firstMessage, tick.endMessage);

  // Keyboard focus keeps the marked row in view by scrolling only the list.
  useLayoutEffect(() => {
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>(`[data-message="${markedMessage}"]`);
    if (!list || !row) return;
    if (row.offsetTop < list.scrollTop) {
      list.scrollTop = row.offsetTop;
    } else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight;
    }
  }, [markedMessage]);

  return (
    <ul
      ref={listRef}
      className="relative max-h-[var(--radix-popover-content-available-height)] overflow-y-auto overscroll-contain p-1"
    >
      {members.map((anchor, index) => {
        const message = tick.firstMessage + index;
        return (
          <li
            key={anchor.rowKey}
            data-message={message}
            className={cn(
              "relative rounded-md px-2.5 py-1.5",
              message === markedMessage && "bg-accent text-accent-foreground",
            )}
          >
            <div inert>
              <UserMessageFirstLine message={anchor.message} />
            </div>
            <JumpCover
              onClick={() => onJump(message)}
              onPointerEnter={() => onMarkMessage(message)}
            />
          </li>
        );
      })}
    </ul>
  );
}

/**
 * A transparent button over a card or row. The content under it is inert, so its chips take no
 * click or focus, and a chip that renders a button does not end up inside this button.
 */
function JumpCover({
  onClick,
  onPointerEnter,
}: {
  onClick: () => void;
  onPointerEnter?: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label="Jump to message"
      className="absolute inset-0 cursor-pointer rounded-[inherit]"
      onClick={onClick}
      onPointerEnter={onPointerEnter}
    />
  );
}
