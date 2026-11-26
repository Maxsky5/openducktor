import { type PropsWithChildren, type ReactElement, use, useSyncExternalStore } from "react";
import type { TerminalContext } from "@openducktor/contracts";
import {
  EMPTY_TERMINAL_ACTIVITY,
  terminalActivityOwnerKey,
} from "@openducktor/frontend-core/terminals/terminal-activity-store";
import { useTerminalTransport } from "@openducktor/frontend-core/terminals/use-terminal-transport";
import { useShellPlatform } from "@/lib/shell-platform";
import { TerminalActivityContext } from "../terminal-activity-context";

/** Share the terminal connection with the panels without attaching to their output. */
export function TerminalActivityProvider({ children }: PropsWithChildren): ReactElement {
  const { controller } = useTerminalTransport(useShellPlatform().terminals);
  return <TerminalActivityContext value={controller}>{children}</TerminalActivityContext>;
}

const noSubscription = (): (() => void) => () => {};
const emptyActivity = () => EMPTY_TERMINAL_ACTIVITY;

export function useTerminalActivity(context: TerminalContext | null) {
  const controller = use(TerminalActivityContext);
  const key = context ? terminalActivityOwnerKey(context) : null;
  return useSyncExternalStore(
    controller && key !== null ? controller.subscribeActivity : noSubscription,
    controller && key !== null ? () => controller.readActivity(key) : emptyActivity,
    emptyActivity,
  );
}
