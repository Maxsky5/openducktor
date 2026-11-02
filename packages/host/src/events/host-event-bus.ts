import {
  type HostEventChannel,
  type HostEventEnvelope,
  parseHostEventChannel as parseContractHostEventChannel,
} from "@openducktor/contracts";
import { HostValidationError } from "../effect/host-errors";

export type HostEventListener = (envelope: HostEventEnvelope) => void;
export type HostEventUnsubscribe = () => void;
export type HostEventDeliveryFailure = {
  channel: HostEventChannel;
  cause: unknown;
};
export type HostEventDeliveryReporter = {
  report(failure: HostEventDeliveryFailure): void;
};

export type HostEventBusPort = {
  subscribeDeliveryFailures(
    listener: (failure: HostEventDeliveryFailure) => void,
  ): HostEventUnsubscribe;
  publish(envelope: HostEventEnvelope): void;
  subscribe(channel: string, listener: HostEventListener): HostEventUnsubscribe;
};

const parseHostEventChannel = (value: string): HostEventChannel => {
  try {
    return parseContractHostEventChannel(value);
  } catch (cause) {
    throw new HostValidationError({
      message: `Unknown OpenDucktor host event channel: ${value}`,
      field: "channel",
      details: { value },
      cause,
    });
  }
};

export const createHostEventBus = (reporter: HostEventDeliveryReporter): HostEventBusPort => {
  const listenersByChannel = new Map<HostEventChannel, Set<HostEventListener>>();
  const failureListeners = new Set<(failure: HostEventDeliveryFailure) => void>();

  return {
    subscribeDeliveryFailures(listener) {
      failureListeners.add(listener);
      return () => {
        failureListeners.delete(listener);
      };
    },
    publish(envelope) {
      const listeners = listenersByChannel.get(envelope.channel);
      if (!listeners) {
        return;
      }

      // oxlint-disable-next-line unicorn/no-useless-spread -- listeners can unsubscribe during delivery
      for (const listener of [...listeners]) {
        try {
          listener(envelope);
        } catch (cause) {
          for (const observe of failureListeners) observe({ channel: envelope.channel, cause });
          reporter.report({ channel: envelope.channel, cause });
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
