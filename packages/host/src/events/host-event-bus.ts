import { HostValidationError } from "../effect/host-errors";

export const HOST_EVENT_CHANNELS = [
  "openducktor://run-event",
  "openducktor://dev-server-event",
  "openducktor://agent-session-live-event",
] as const;

export type HostEventChannel = (typeof HOST_EVENT_CHANNELS)[number];
export type HostEventListener = (payload: unknown) => void;
export type HostEventUnsubscribe = () => void;
export type HostEventDeliveryFailure = {
  channel: HostEventChannel;
  cause: unknown;
};
export type HostEventDeliveryReporter = {
  report(failure: HostEventDeliveryFailure): void;
};

export type HostEventBusPort = {
  publish(channel: string, payload: unknown): void;
  subscribe(channel: string, listener: HostEventListener): HostEventUnsubscribe;
};

const hostEventChannelSet = new Set<string>(HOST_EVENT_CHANNELS);

export const isHostEventChannel = (value: string): value is HostEventChannel =>
  hostEventChannelSet.has(value);

export const parseHostEventChannel = (value: string): HostEventChannel => {
  if (isHostEventChannel(value)) {
    return value;
  }

  throw new HostValidationError({
    message: `Unknown OpenDucktor host event channel: ${value}`,
    field: "channel",
    details: { value },
  });
};

export const createHostEventBus = (reporter: HostEventDeliveryReporter): HostEventBusPort => {
  const listenersByChannel = new Map<HostEventChannel, Set<HostEventListener>>();

  return {
    publish(channel, payload) {
      const hostChannel = parseHostEventChannel(channel);
      const listeners = listenersByChannel.get(hostChannel);
      if (!listeners) {
        return;
      }

      for (const listener of [...listeners]) {
        try {
          listener(payload);
        } catch (cause) {
          reporter.report({ channel: hostChannel, cause });
        }
      }
    },
    subscribe(channel, listener) {
      const hostChannel = parseHostEventChannel(channel);
      const listeners = listenersByChannel.get(hostChannel) ?? new Set<HostEventListener>();
      listeners.add(listener);
      listenersByChannel.set(hostChannel, listeners);

      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          listenersByChannel.delete(hostChannel);
        }
      };
    },
  };
};
