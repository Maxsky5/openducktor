export const CONNECTION_RECONNECTED_EVENT_KIND = "reconnected";
export const CONNECTION_STREAM_WARNING_EVENT_KIND = "stream-warning";

/** A host connection reports stream loss and reconnection to its event listeners. */
export type ConnectionControlEvent =
  | {
      __openducktorConnectionControl: true;
      kind: typeof CONNECTION_RECONNECTED_EVENT_KIND;
      /** False when the replay delivered every event since the connection failed. */
      missedEvents: boolean;
    }
  | {
      __openducktorConnectionControl: true;
      kind: typeof CONNECTION_STREAM_WARNING_EVENT_KIND;
      message?: string;
    };

export const connectionReconnectedEvent = (missedEvents: boolean): ConnectionControlEvent => ({
  __openducktorConnectionControl: true,
  kind: CONNECTION_RECONNECTED_EVENT_KIND,
  missedEvents,
});

export const connectionStreamWarningEvent = (message?: string): ConnectionControlEvent => {
  const event: Extract<
    ConnectionControlEvent,
    { kind: typeof CONNECTION_STREAM_WARNING_EVENT_KIND }
  > = {
    __openducktorConnectionControl: true,
    kind: CONNECTION_STREAM_WARNING_EVENT_KIND,
  };
  if (message !== undefined) {
    event.message = message;
  }
  return event;
};
