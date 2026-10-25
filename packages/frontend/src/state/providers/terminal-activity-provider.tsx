import { type PropsWithChildren, type ReactElement, useContext, useSyncExternalStore } from "react";
import type { TerminalContext } from "@openducktor/contracts";
import {
  EMPTY_TERMINAL_ACTIVITY,
  terminalActivityOwnerKey,
} from "@openducktor/frontend-core/terminals/terminal-activity-store";
import { useTerminalTransport } from "@openducktor/frontend-core/terminals/use-terminal-transport";
import { getShellBridge } from "@/lib/shell-bridge";
import { TerminalActivityContext } from "../terminal-activity-context";

/** Share the terminal connection with the panels without attaching to their output. */
export function TerminalActivityProvider({ children }: PropsWithChildren): ReactElement {
  const { controller } = useTerminalTransport(getShellBridge().terminals);
  return <TerminalActivityContext value={controller}>{children}</TerminalActivityContext>;
}

const noSubscription = (): (() => void) => () => {};
const emptyActivity = () => EMPTY_TERMINAL_ACTIVITY;

export function useTerminalActivity(context: TerminalContext) {
  const controller = useContext(TerminalActivityContext);
  const key = terminalActivityOwnerKey(context);
  return useSyncExternalStore(
    controller?.subscribeActivity ?? noSubscription,
    controller ? () => controller.readActivity(key) : emptyActivity,
    emptyActivity,
  );
}
