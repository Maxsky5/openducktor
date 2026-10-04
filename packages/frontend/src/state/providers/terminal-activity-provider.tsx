import {
  createContext,
  type PropsWithChildren,
  type ReactElement,
  useContext,
  useSyncExternalStore,
} from "react";
import type { TerminalContext } from "@openducktor/contracts";
import {
  EMPTY_TERMINAL_ACTIVITY,
  terminalActivityOwnerKey,
} from "@/features/terminals/terminal-activity-store";
import type { TerminalTransportController } from "@/features/terminals/terminal-transport-controller";
import { useTerminalTransport } from "@/features/terminals/use-terminal-transport";
import { getShellBridge } from "@/lib/shell-bridge";

export const TerminalActivityContext = createContext<TerminalTransportController | null>(null);

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
