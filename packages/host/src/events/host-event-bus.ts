import {
  type HostEventChannel,
  type HostEventEnvelope,
  parseHostEventChannel as parseContractHostEventChannel,
  parseHostEventEnvelope as parseContractHostEventEnvelope,
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

const parseHostEventEnvelope = (value: HostEventEnvelope): HostEventEnvelope => {
  try {
    return parseContractHostEventEnvelope(value);
  } catch (cause) {
    throw new HostValidationError({
      message: "Invalid OpenDucktor host event envelope.",
      field: "event",
      cause,
    });
  }
};

export const createHostEventBus = (reporter: HostEventDeliveryReporter): HostEventBusPort => {
  const listenersByChannel = new Map<HostEventChannel, Set<HostEventListener>>();

  return {
    publish(envelope) {
      const validatedEnvelope = parseHostEventEnvelope(envelope);
      const listeners = listenersByChannel.get(validatedEnvelope.channel);
      if (!listeners) {
        return;
      }

      // oxlint-disable-next-line unicorn/no-useless-spread -- listeners can unsubscribe during delivery
      for (const listener of [...listeners]) {
        try {
          listener(validatedEnvelope);
        } catch (cause) {
          reporter.report({ channel: validatedEnvelope.channel, cause });
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
