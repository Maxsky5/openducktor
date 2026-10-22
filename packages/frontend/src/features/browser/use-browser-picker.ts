import { BROWSER_ANNOTATION_MAX_ELEMENTS, type BrowserBox } from "@openducktor/contracts";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { useHostClient } from "@openducktor/frontend-core/connection/client-connection-react";
import type { BrowserChannel } from "./browser-channel";

export type BrowserPickedElement = { nodeRef: string; box: BrowserBox; label: string };

export type BrowserPickerState = {
  active: boolean;
  /** The element under the pointer, from the host. */
  target: BrowserPickedElement | null;
  selection: BrowserPickedElement[];
};

const IDLE: BrowserPickerState = { active: false, target: null, selection: [] };

type PickerPoint = { x: number; y: number };

/**
 * The element picker of one browser tab. The host finds the element under the pointer and pauses
 * page animations while the picker is on. The picker turns off when the page ends or the view goes.
 */
export const useBrowserPicker = (channel: BrowserChannel, tabId: string, live: boolean) => {
  const hostClient = useHostClient();
  const [state, setState] = useState<BrowserPickerState>(IDLE);
  const [pickerLive, setPickerLive] = useState(live);
  // A page that ends takes the host picker with it, so the picker turns off with the page.
  if (pickerLive !== live) {
    setPickerLive(live);
    if (!live) setState(IDLE);
  }
  const activeRef = useRef(false);
  /** The last element that the host found, and the point that it found it at. */
  const lastTarget = useRef<{ point: PickerPoint; target: BrowserPickedElement | null } | null>(
    null,
  );
  /** A click whose point the host did not resolve yet. */
  const pendingPick = useRef<{ point: PickerPoint; shiftKey: boolean } | null>(null);
  useEffect(() => {
    activeRef.current = state.active;
  }, [state.active]);

  const setEnabled = (enabled: boolean): void => {
    if (state.active === enabled) return;
    lastTarget.current = null;
    pendingPick.current = null;
    setState(enabled ? { ...IDLE, active: true } : IDLE);
    hostClient.browserPickerSet({ tabId, enabled }).catch((cause: unknown) => {
      if (enabled) setState(IDLE);
      reportPickerFailure(cause);
    });
  };

  useEffect(
    () =>
      channel.subscribe((message) => {
        if (message.type !== "picker_target" || message.tabId !== tabId) return;
        const point = { x: message.x, y: message.y };
        lastTarget.current = { point, target: message.target };
        setState((current) => (current.active ? { ...current, target: message.target } : current));
        const pending = pendingPick.current;
        if (pending !== null && samePoint(pending.point, point)) {
          pendingPick.current = null;
          setState((current) => withPick(current, message.target, pending.shiftKey));
        }
      }),
    [channel, tabId],
  );

  useEffect(
    () => () => {
      if (activeRef.current) {
        hostClient.browserPickerSet({ tabId, enabled: false }).catch(reportPickerFailure);
      }
    },
    [hostClient, tabId],
  );

  return {
    state,
    toggle: () => setEnabled(!state.active),
    stop: () => setEnabled(false),
    hover: (x: number, y: number) => channel.send({ type: "picker_hover", tabId, x, y }),
    /**
     * Picks the element at the click point. A click can come before the host found the element
     * under a pointer that just moved, so the pick then waits for the host.
     */
    pick: (shiftKey: boolean, x: number, y: number) => {
      const point = { x, y };
      const known = lastTarget.current;
      if (known !== null && samePoint(known.point, point)) {
        setState((current) => withPick(current, known.target, shiftKey));
        return;
      }
      pendingPick.current = { point, shiftKey };
      channel.send({ type: "picker_hover", tabId, x, y });
    },
    clearSelection: () => setState((current) => ({ ...current, selection: [] })),
  };
};

export type BrowserPicker = ReturnType<typeof useBrowserPicker>;

const samePoint = (a: PickerPoint, b: PickerPoint): boolean => a.x === b.x && a.y === b.y;

const withPick = (
  current: BrowserPickerState,
  target: BrowserPickedElement | null,
  shiftKey: boolean,
): BrowserPickerState =>
  current.active && target !== null
    ? { ...current, selection: nextBrowserPickerSelection(current.selection, target, shiftKey) }
    : current;

/** Picks the selection after a click: a click selects one element, Shift-click adds or removes. */
export const nextBrowserPickerSelection = (
  selection: readonly BrowserPickedElement[],
  target: BrowserPickedElement,
  shiftKey: boolean,
): BrowserPickedElement[] => {
  if (!shiftKey) return [target];
  if (selection.some((element) => element.nodeRef === target.nodeRef)) {
    return selection.filter((element) => element.nodeRef !== target.nodeRef);
  }
  return [...selection, target].slice(0, BROWSER_ANNOTATION_MAX_ELEMENTS);
};

const reportPickerFailure = (cause: unknown): void => {
  toast.error("Could not change Annotate", { description: errorMessage(cause) });
};
