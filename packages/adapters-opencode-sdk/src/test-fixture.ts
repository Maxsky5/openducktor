import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import type { JsonObject } from "@openducktor/contracts";

export const createInvalidOpencodeEventFixture = (value: JsonObject): JsonObject => value;

export const createInvalidOpencodePartFixture = (value: JsonObject): JsonObject => value;

export const createGlobalEventClientFixture = (
  client: Pick<OpencodeClient, "global">,
): Pick<OpencodeClient, "global"> => client;
