import type { HostRuntimeSnapshot } from "@openducktor/contracts";
import { QueryClient } from "@tanstack/react-query";
import type { RuntimeChangeListener } from "@/lib/shell-bridge";
import { createHostRuntimeStatusOwner } from "@/state/host-runtime/host-runtime-status-owner";

/**
 * Starts a host runtime status owner on a fake event transport. `emit` sends one transport
 * event, for example a runtime event or a browser `stream-warning`.
 */
export const startHostRuntimeEventsHarness = ({
  onSubscribe,
}: {
  /** Runs while the owner subscribes. The browser transport reports its current warning here. */
  onSubscribe?: (listener: RuntimeChangeListener) => void;
} = {}) => {
  let listener: RuntimeChangeListener | null = null;
  const owner = createHostRuntimeStatusOwner({
    queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    ports: {
      subscribeRuntimeChanges: async (next) => {
        listener = next;
        onSubscribe?.(next);
        return () => {
          listener = null;
        };
      },
      runtimeStatus: async (): Promise<HostRuntimeSnapshot> => ({
        hostInstanceId: "host-1",
        runtimes: [],
      }),
    },
    onRuntimeGenerationChange: () => {},
  });
  owner.start();
  const emit: RuntimeChangeListener = (event) => {
    if (!listener) throw new Error("The host runtime status owner has not subscribed.");
    listener(event);
  };
  return { owner, emit };
};
