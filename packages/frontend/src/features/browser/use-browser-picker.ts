import type { BrowserPickedElement } from "@openducktor/contracts";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { useHostClient } from "@openducktor/frontend-core/connection/client-connection-react";
import type { BrowserChannel } from "./browser-channel";

export type BrowserPickerState = {
  active: boolean;
  /** The elements that the user picked on the page, in the order of the picks. */
  selection: BrowserPickedElement[];
};

const IDLE: BrowserPickerState = { active: false, selection: [] };

/**
 * The element picker of one browser tab. The page script reports the pointer and the picks to the
 * host, and the host resolves the element and draws the highlight in the page. React only follows
 * the picker state and shows the comment box of a selection.
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
  useEffect(() => {
    activeRef.current = state.active;
  }, [state.active]);

  const setEnabled = (enabled: boolean): void => {
    if (state.active === enabled) return;
    setState(enabled ? { active: true, selection: [] } : IDLE);
    hostClient.browserPickerSet({ tabId, enabled }).catch((cause: unknown) => {
      if (enabled) setState(IDLE);
      reportPickerFailure(cause);
    });
  };

  useEffect(
    () =>
      channel.subscribe((message) => {
        if (message.type === "picker_selection" && message.tabId === tabId) {
          setState((current) =>
            current.active ? { ...current, selection: message.selection } : current,
          );
          return;
        }
        if (message.type === "picker_off" && message.tabId === tabId) {
          setState(IDLE);
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
    clearSelection: () => {
      setState((current) => ({ ...current, selection: [] }));
      channel.send({ type: "picker_clear", tabId });
    },
  };
};

export type BrowserPicker = ReturnType<typeof useBrowserPicker>;

const reportPickerFailure = (cause: unknown): void => {
  toast.error("Could not change Annotate", { description: errorMessage(cause) });
};
