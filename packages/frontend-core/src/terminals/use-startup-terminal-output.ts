import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useClientConnection } from "../connection/client-connection-react";
import type { ClientConnection } from "../connection/client-connection";
import type { TerminalBridge } from "./terminal-bridge";
import {
  createTerminalTransportController,
  type TerminalTransportController,
} from "./terminal-transport-controller";

export type StartupTerminalOutput = Pick<
  TerminalTransportController,
  "subscribe" | "acknowledge" | "releaseEmulator"
>;

type OutputTransport = {
  output: StartupTerminalOutput;
  release: () => void;
};

const transports = new WeakMap<ClientConnection, Set<OutputTransport>>();

/** Uses an independent consumer cursor and never joins the command recovery barrier. */
export function acquireStartupTerminalOutput(
  connection: ClientConnection,
  bridge: TerminalBridge,
  listener: (error: string | null) => void,
) {
  let owned = transports.get(connection);
  if (!owned) {
    owned = new Set();
    transports.set(connection, owned);
  }
  let released = false;
  const report = (error: string | null) => {
    if (!released) listener(error);
  };
  const controller = createTerminalTransportController(
    { connect: (...args) => bridge.connect(...args) },
    (state) => {
      if (state === "connected") report(null);
    },
    (failure) => report(failure.message),
  );
  const entry: OutputTransport = {
    output: {
      subscribe: controller.subscribe,
      acknowledge: controller.acknowledge,
      releaseEmulator: controller.releaseEmulator,
    },
    release: () => {
      if (released) return;
      released = true;
      owned.delete(entry);
      if (owned.size === 0) transports.delete(connection);
      void controller.dispose().catch((cause: unknown) => {
        console.error("Cannot release startup terminal output.", cause);
      });
    },
  };
  owned.add(entry);
  void controller.connect().catch((cause: unknown) => {
    report(cause instanceof Error ? cause.message : String(cause));
  });
  return {
    controller: entry.output,
    release: entry.release,
  };
}

export function releaseStartupTerminalOutput(connection: ClientConnection): void {
  const owned = transports.get(connection);
  if (!owned) return;
  transports.delete(connection);
  for (const transport of owned) transport.release();
}

export function useStartupTerminalOutput(bridge: TerminalBridge) {
  const connection = useClientConnection();
  const [active, setActive] = useState<{
    connection: ClientConnection;
    controller: StartupTerminalOutput;
  } | null>(null);
  const [transportError, setTransportError] = useState<string | null>(null);
  const lease = useRef<ReturnType<typeof acquireStartupTerminalOutput> | null>(null);
  useLayoutEffect(() => {
    const acquired = acquireStartupTerminalOutput(connection, bridge, setTransportError);
    setActive({ connection, controller: acquired.controller });
    lease.current = acquired;
  }, [connection, bridge]);
  // Passive cleanup lets the destination trace acquire before the old trace releases.
  useEffect(() => {
    const acquired = lease.current;
    return () => acquired?.release();
  }, [connection, bridge]);
  return {
    controller: active?.connection === connection ? active.controller : null,
    transportError,
  };
}
