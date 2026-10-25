import {
  type KeyboardEvent,
  memo,
  type ReactElement,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";
import { readUserMessageSummary } from "@openducktor/frontend-core/sessions/messages/agent-chat-user-message-content";
import type { AgentChatUserMessageAnchor } from "@openducktor/frontend-core/sessions/transcript/agent-chat-transcript-model";
import type { AgentChatTranscriptNavigation } from "../use-agent-chat-transcript-navigation";
import {
  MINIMAP_CARD_CLOSE_DELAY_MS,
  MINIMAP_GUTTER_PX,
  MINIMAP_RAIL_INSET_PX,
  MINIMAP_TICK_LENGTH_PX,
  MINIMAP_TICK_LEFT_PX,
} from "./constants";
import { findTickOfMessage, layoutConversationMinimap } from "./conversation-minimap-layout";
import { type MinimapTickState, readTickState } from "./conversation-minimap-markers";
import { ConversationMinimapPreview } from "./conversation-minimap-preview";
import { useMinimapMarkers } from "./use-minimap-markers";
import { useMinimapWave } from "./use-minimap-wave";

type ConversationMinimapProps = {
  anchors: AgentChatUserMessageAnchor[];
  navigation: AgentChatTranscriptNavigation;
  railMaxHeight: number;
  frame: HTMLElement;
};

/** The tick under the pointer, and the group row under the pointer in the preview card. */
type MinimapHover = { tick: number; markedMessage: number | null };

/**
 * A rail beside the transcript with one tick per user message. Hover and keyboard focus grow the
 * nearby ticks and preview the message. A click or Enter jumps to the message.
 *
 * The rail is outside the transcript scroll container, so its focus, keys, and pointer input never
 * scroll the transcript or change auto-follow. It forwards wheel input to the transcript.
 */
export const ConversationMinimap = memo(function ConversationMinimap({
  anchors,
  navigation,
  railMaxHeight,
  frame,
}: ConversationMinimapProps): ReactElement {
  const { spacing, ticks } = useMemo(
    () => layoutConversationMinimap(anchors.length, railMaxHeight),
    [anchors.length, railMaxHeight],
  );
  const railHeight = spacing * ticks.length;
  // The rail is centered in the frame on whole pixels, so its ticks stay sharp.
  const railTop = MINIMAP_RAIL_INSET_PX + Math.floor((railMaxHeight - railHeight) / 2);
  const markers = useMinimapMarkers(anchors, navigation);
  const options = useMemo(
    () =>
      anchors.map((anchor, index) => ({
        rowKey: anchor.rowKey,
        label: readOptionLabel(anchor, index, anchors.length),
      })),
    [anchors],
  );
  const optionIdPrefix = useId();
  const railRef = useRef<HTMLDivElement | null>(null);
  const ticksRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hover, setHover] = useState<MinimapHover | null>(null);
  // Focus follows its message, also when older messages load above it.
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [isCardDismissed, setIsCardDismissed] = useState(false);

  const focusIndex =
    focusKey === null ? -1 : anchors.findIndex((anchor) => anchor.rowKey === focusKey);
  const focusedMessage = focusIndex < 0 ? null : focusIndex;
  const focusedTick = focusedMessage === null ? null : findTickOfMessage(ticks, focusedMessage);
  // The layout can change while the pointer keeps a tick.
  const hoverTick = hover && hover.tick < ticks.length ? hover.tick : null;
  const crestTick = hoverTick ?? focusedTick;
  const markedMessage = hoverTick === null ? focusedMessage : (hover?.markedMessage ?? null);
  const cardTick = isCardDismissed ? null : crestTick;
  const crestY = useMinimapWave({
    ticksRef,
    spacing,
    ticks,
    // The crest stays up while the pointer is on the card, and settles when the card closes.
    isRaised: crestTick !== null,
  });

  // Keyboard focus puts the crest on the tick of the focused message.
  useEffect(() => {
    if (hoverTick === null && focusedTick !== null) {
      crestY.set((focusedTick + 0.5) * spacing);
    }
  }, [focusedTick, hoverTick, spacing, crestY]);

  // Stable, so the unmount cleanup below runs only once.
  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);
  useEffect(() => clearCloseTimer, [clearCloseTimer]);

  const scheduleClose = () => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      setHover(null);
    }, MINIMAP_CARD_CLOSE_DELAY_MS);
  };

  // Moves the crest to the pointer and gives the tick under it.
  const placeCrest = (clientY: number): number => {
    const top = railRef.current?.getBoundingClientRect().top ?? 0;
    const y = clientY - top;
    crestY.set(y);
    return Math.max(0, Math.min(ticks.length - 1, Math.floor(y / spacing)));
  };

  const hoverAt = (clientY: number) => {
    const tick = placeCrest(clientY);
    if (hover?.tick !== tick) {
      setHover({ tick, markedMessage: null });
      setIsCardDismissed(false);
    }
  };

  const jumpToMessage = (message: number) => {
    const anchor = anchors[message];
    if (anchor) {
      navigation.jumpToRow(anchor.rowKey);
    }
  };

  const moveFocus = (message: number) => {
    setHover(null);
    setFocusKey(anchors[message]?.rowKey ?? null);
    setIsCardDismissed(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = focusedMessage ?? 0;
    switch (event.key) {
      case "ArrowUp":
      case "ArrowLeft":
        moveFocus(Math.max(0, current - 1));
        break;
      case "ArrowDown":
      case "ArrowRight":
        moveFocus(Math.min(anchors.length - 1, current + 1));
        break;
      case "Home":
        moveFocus(0);
        break;
      case "End":
        moveFocus(anchors.length - 1);
        break;
      case "Enter":
      case " ":
        jumpToMessage(current);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const markMessage = (message: number) => {
    setHover((current) =>
      current && current.markedMessage !== message
        ? { ...current, markedMessage: message }
        : current,
    );
  };

  // The preview card renders beside the rail, so its events do not reach the rail through the portal.
  return (
    <>
      <div
        ref={railRef}
        role="listbox"
        aria-label="User messages"
        aria-activedescendant={
          focusedMessage === null ? undefined : `${optionIdPrefix}-${focusedMessage}`
        }
        tabIndex={0}
        className="group absolute left-0 z-10 cursor-pointer outline-none"
        style={{ top: railTop, width: MINIMAP_GUTTER_PX, height: railHeight }}
        data-testid="conversation-minimap"
        // Rail focus always comes from the keyboard, so a click leaves focus where it was.
        onMouseDown={(event) => event.preventDefault()}
        onPointerEnter={(event) => {
          if (event.pointerType === "touch") return;
          clearCloseTimer();
          hoverAt(event.clientY);
        }}
        onPointerMove={(event) => {
          if (event.pointerType === "touch") return;
          hoverAt(event.clientY);
        }}
        onPointerLeave={scheduleClose}
        onClick={(event) => {
          const tick = ticks[placeCrest(event.clientY)];
          if (tick) jumpToMessage(tick.firstMessage);
        }}
        onWheel={(event) => navigation.scrollByWheel(event.nativeEvent)}
        onFocus={(event) => {
          if (event.target !== event.currentTarget) return;
          moveFocus(markers.activeMessage ?? 0);
        }}
        onBlur={(event) => {
          if (event.target !== event.currentTarget) return;
          setFocusKey(null);
        }}
        onKeyDown={handleKeyDown}
      >
        <div ref={ticksRef} aria-hidden="true">
          {ticks.map((tick) => (
            <MinimapTickRow
              key={tick.firstMessage}
              state={readTickState(tick, markers)}
              spacing={spacing}
            />
          ))}
        </div>
        {focusedTick !== null ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute hidden rounded-sm ring-2 ring-ring group-focus-visible:block"
            // The 2px ring stays inside the gutter, clear of the messages.
            style={{
              top: focusedTick * spacing,
              left: FOCUS_RING_WIDTH_PX,
              width: MINIMAP_GUTTER_PX - FOCUS_RING_WIDTH_PX * 2,
              height: spacing,
            }}
          />
        ) : null}
        <div className="sr-only">
          {options.map(({ rowKey, label }, index) => (
            <MinimapOption
              key={rowKey}
              id={`${optionIdPrefix}-${index}`}
              label={label}
              isSelected={index === focusedMessage}
              isCurrent={index === markers.activeMessage}
            />
          ))}
        </div>
      </div>
      <ConversationMinimapPreview
        anchors={anchors}
        ticks={ticks}
        cardTick={cardTick}
        spacing={spacing}
        markedMessage={markedMessage}
        railRef={railRef}
        frame={frame}
        onPointerEnter={clearCloseTimer}
        onPointerLeave={scheduleClose}
        onMarkMessage={markMessage}
        onJump={jumpToMessage}
        onDismiss={() => setIsCardDismissed(true)}
      />
    </>
  );
});

const MinimapTickRow = memo(function MinimapTickRow({
  state,
  spacing,
}: {
  state: MinimapTickState;
  spacing: number;
}): ReactElement {
  return (
    <div
      className="flex items-center"
      style={{ height: spacing, paddingLeft: MINIMAP_TICK_LEFT_PX }}
    >
      <span
        data-state={state}
        className={cn(
          "conversation-minimap-tick block h-0.5 rounded-full",
          TICK_STATE_CLASS_NAMES[state],
        )}
        style={{ width: MINIMAP_TICK_LENGTH_PX }}
      />
    </div>
  );
});

const MinimapOption = memo(function MinimapOption({
  id,
  label,
  isSelected,
  isCurrent,
}: {
  id: string;
  label: string;
  isSelected: boolean;
  isCurrent: boolean;
}): ReactElement {
  return (
    <div
      id={id}
      role="option"
      aria-selected={isSelected}
      aria-current={isCurrent ? "location" : undefined}
    >
      {label}
    </div>
  );
});

const FOCUS_RING_WIDTH_PX = 2;

const TICK_STATE_CLASS_NAMES = {
  rest: "bg-muted-foreground/40",
  visible: "bg-muted-foreground",
  active: "bg-foreground",
} satisfies Record<MinimapTickState, string>;

function readOptionLabel(anchor: AgentChatUserMessageAnchor, index: number, count: number): string {
  const summary = readUserMessageSummary(anchor.message);
  const position = `Message ${index + 1} of ${count}`;
  return summary ? `${position}: ${summary}` : position;
}
