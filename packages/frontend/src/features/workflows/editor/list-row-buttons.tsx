import { ArrowDown, ArrowUp, X } from "lucide-react";
import { type ReactElement, useLayoutEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { TooltipButton } from "../tooltip-button";

/**
 * Move up and Move down of one list row. A move keeps the focus on a move button: the row moves in
 * the page, and a button at the end of the list turns off, and both drop the focus.
 */
export function MoveButtons({
  name,
  canMoveUp,
  canMoveDown,
  onMove,
}: {
  /** The row name in the button labels. */
  name: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (offset: -1 | 1) => void;
}): ReactElement {
  const up = useRef<HTMLButtonElement>(null);
  const down = useRef<HTMLButtonElement>(null);
  const moved = useRef<-1 | 1 | null>(null);
  useLayoutEffect(() => {
    const offset = moved.current;
    if (offset === null) return;
    moved.current = null;
    const active = document.activeElement;
    if (active === up.current || active === down.current) return;
    const same = offset === -1 ? up.current : down.current;
    const other = offset === -1 ? down.current : up.current;
    (same && !same.disabled ? same : other)?.focus();
  });
  const move = (offset: -1 | 1) => {
    moved.current = offset;
    onMove(offset);
  };
  return (
    <>
      <Button
        ref={up}
        type="button"
        size="icon"
        variant="ghost"
        className="size-6"
        aria-label={`Move ${name} up`}
        disabled={!canMoveUp}
        onClick={() => move(-1)}
      >
        <ArrowUp className="size-3.5" />
      </Button>
      <Button
        ref={down}
        type="button"
        size="icon"
        variant="ghost"
        className="size-6"
        aria-label={`Move ${name} down`}
        disabled={!canMoveDown}
        onClick={() => move(1)}
      >
        <ArrowDown className="size-3.5" />
      </Button>
    </>
  );
}

/** Remove of one list row. A locked row tells why it stays, in the tooltip of the button. */
export function RemoveButton({
  name,
  disabled,
  lockedReason,
  onRemove,
}: {
  name: string;
  disabled: boolean;
  /** The reason that the row must stay, or undefined. */
  lockedReason: string | undefined;
  onRemove: () => void;
}): ReactElement {
  return (
    <TooltipButton
      type="button"
      size="icon"
      variant="ghost"
      className="size-6 text-muted-foreground hover:bg-destructive/10 hover:text-destructive-muted"
      data-remove-row=""
      label={`Remove ${name}`}
      tooltip={lockedReason ?? `Remove ${name}`}
      disabled={disabled}
      onClick={onRemove}
    >
      <X className="size-3.5" />
    </TooltipButton>
  );
}
