import type { Event, OpencodeClient, Part } from "@opencode-ai/sdk/v2/client";
import type { JsonValue } from "@openducktor/contracts";

export const createInvalidOpencodeEventFixture = (value: JsonValue): Event => {
  // SAFETY: These tests deliberately send malformed JSON through the OpenCode event boundary.
  return value as Event;
};

export const createInvalidOpencodePartFixture = (value: JsonValue): Part => {
  // SAFETY: These tests deliberately send malformed JSON through the OpenCode part boundary.
  return value as Part;
};

export const createGlobalEventClientFixture = (
  client: Pick<OpencodeClient, "global">,
): OpencodeClient => {
  // SAFETY: The event-stream test reads only the supplied global event API.
  return client as OpencodeClient;
};
