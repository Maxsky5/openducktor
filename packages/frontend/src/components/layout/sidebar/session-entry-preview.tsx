import type { SessionNavigationTarget } from "@/features/session-navigation/session-navigation-target";
import {
  createContext,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { useSetSessionUnread } from "@/features/session-navigation/session-read-state";
import { useRequiredContext } from "@/state/app-state-contexts";
import type { SessionNavigationEntry } from "@/state/read-models/session-navigation-read-model";
import { useSessionPresent } from "./session-navigation-presence-context";
import { SessionPreviewContent } from "./session-preview-content";
import { SessionEntryMenu } from "./session-entry-menu";

type PreviewController = {
  activeKey: string | null;
  open: (key: string, fromKeyboard?: boolean) => void;
  close: (key: string) => void;
  pin: (key: string) => void;
};
const PreviewContext = createContext<PreviewController | null>(null);

/** Only one rich preview mounts at a time. An answer stays open until explicitly dismissed. */
export function SessionPreviewProvider({ children }: { children: ReactNode }): ReactElement {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const pinnedKey = useRef<string | null>(null);
  const open = useCallback((key: string, fromKeyboard = false) => {
    if (pinnedKey.current !== null && pinnedKey.current !== key && !fromKeyboard) return;
    if (pinnedKey.current !== key) pinnedKey.current = null;
    setActiveKey(key);
  }, []);
  const close = useCallback((key: string) => {
    if (pinnedKey.current === key) pinnedKey.current = null;
    setActiveKey((current) => (current === key ? null : current));
  }, []);
  const pin = useCallback((key: string) => {
    pinnedKey.current = key;
  }, []);
  const value = useMemo(() => ({ activeKey, open, close, pin }), [activeKey, open, close, pin]);
  return <PreviewContext value={value}>{children}</PreviewContext>;
}

/** Hover shows details; ArrowRight or Tab enters the preview without opening the session. */
export function SessionEntryPreview({
  entry,
  isVisible,
  now,
  onOpen,
  children,
}: {
  entry: SessionNavigationEntry;
  isVisible: boolean;
  now: number;
  onOpen: (entry: SessionNavigationEntry, target?: SessionNavigationTarget) => void;
  children: ReactElement;
}): ReactElement {
  const {
    activeKey,
    open: openPreview,
    close: closePreview,
    pin: pinPreview,
  } = useRequiredContext(PreviewContext, "SessionEntryPreview");
  const isPresent = useSessionPresent();
  const [menuOpen, setMenuOpen] = useState(false);
  const setUnread = useSetSessionUnread();
  const open = isPresent && !menuOpen && activeKey === entry.key;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anchor = useRef<HTMLDivElement | null>(null);
  const content = useRef<HTMLDivElement | null>(null);
  const interacting = useRef(false);
  const keyboard = useRef(false);
  const suppressFocus = useRef(false);
  const titleId = useId();
  const clearTimer = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const close = useCallback(() => {
    clearTimer();
    interacting.current = false;
    closePreview(entry.key);
  }, [clearTimer, closePreview, entry.key]);
  useEffect(
    () => () => {
      clearTimer();
      closePreview(entry.key);
    },
    [clearTimer, closePreview, entry.key],
  );
  useEffect(() => {
    if (!isPresent) close();
  }, [close, isPresent]);
  const scheduleClose = () => {
    clearTimer();
    // Gives the pointer time to cross the gap between the row and its portal.
    timer.current = setTimeout(() => {
      if (!interacting.current && document.activeElement !== anchor.current) close();
    }, 240);
  };
  const enterFromKeyboard = () => {
    clearTimer();
    keyboard.current = true;
    interacting.current = true;
    openPreview(entry.key, true);
    pinPreview(entry.key);
    content.current?.focus();
  };
  const restoreFocus = (event: Event) => {
    event.preventDefault();
    suppressFocus.current = true;
    anchor.current?.focus();
  };
  return (
    <ContextMenu
      onOpenChange={(next) => {
        setMenuOpen(next);
        suppressFocus.current = true;
        if (next) close();
      }}
    >
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (!next) close();
        }}
      >
        <PopoverAnchor
          asChild
          ref={anchor}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? `${titleId}-preview` : undefined}
          onPointerEnter={(event) => {
            if (event.pointerType === "touch" || !isPresent || menuOpen) return;
            clearTimer();
            timer.current = setTimeout(() => {
              keyboard.current = false;
              openPreview(entry.key);
            }, 180);
          }}
          onPointerLeave={scheduleClose}
          onFocus={() => {
            if (suppressFocus.current) {
              suppressFocus.current = false;
              return;
            }
            if (isPresent && !menuOpen) openPreview(entry.key, true);
          }}
          onBlur={(event) => {
            if (
              !(event.relatedTarget instanceof Node) ||
              !content.current?.contains(event.relatedTarget)
            )
              scheduleClose();
          }}
          onKeyDown={(event) => {
            if (menuOpen) return;
            if (event.key === "ArrowRight" || (event.key === "Tab" && open && !event.shiftKey)) {
              event.preventDefault();
              enterFromKeyboard();
            } else if (event.key === "Escape") close();
          }}
          onClickCapture={() => {
            close();
            if (isVisible) setUnread(entry, false);
          }}
        >
          <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
        </PopoverAnchor>
        <PopoverContent
          ref={content}
          id={`${titleId}-preview`}
          aria-labelledby={titleId}
          side="right"
          align="start"
          sideOffset={12}
          collisionPadding={12}
          className="w-[420px] max-w-[calc(100vw-24px)] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto overscroll-contain break-words rounded-xl p-0 text-popover-foreground shadow-lg"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            if (keyboard.current) content.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (keyboard.current && isPresent) {
              suppressFocus.current = true;
              anchor.current?.focus();
            }
            keyboard.current = false;
          }}
          onPointerEnter={clearTimer}
          onPointerLeave={scheduleClose}
          onPointerDown={() => {
            interacting.current = true;
            pinPreview(entry.key);
          }}
          onFocusCapture={() => {
            clearTimer();
            interacting.current = true;
            pinPreview(entry.key);
          }}
          onFocusOutside={(event) => {
            if (event.target === anchor.current) event.preventDefault();
          }}
          onEscapeKeyDown={close}
        >
          <SessionPreviewContent
            entry={entry}
            now={now}
            titleId={titleId}
            onOpenDialog={() => {
              keyboard.current = false;
              close();
            }}
            onCloseAutoFocus={restoreFocus}
            onOpen={(target) => {
              close();
              if (target) onOpen(entry, target);
              else onOpen(entry);
            }}
          />
        </PopoverContent>
      </Popover>
      <SessionEntryMenu entry={entry} onCloseAutoFocus={restoreFocus} />
    </ContextMenu>
  );
}
