import { createHash } from "node:crypto";
import type { RuntimeKind } from "@openducktor/contracts";
import {
  createOpenCodeMessageId,
  matchesOpenCodeMessageId,
} from "@openducktor/adapters-opencode-sdk";

const receipt = (runtime: Exclude<RuntimeKind, "opencode">, bytes: Buffer) => {
  // Claude requires a UUID. Set the version and variant while preserving the hash bits.
  const hex = bytes.toString("hex", 0, 16);
  const variant = (8 | (Number.parseInt(hex.charAt(16), 16) & 3)).toString(16);
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20)}`;
  return runtime === "claude" ? uuid : `odt-handoff-${uuid}`;
};

/** Correlates a client submission with the existing first-message ID of a saved link. */
export const nativeHandoffAdmission = {
  create(runtime: RuntimeKind, key: string) {
    const bytes = createHash("sha256").update(key).digest();
    return runtime === "opencode" ? createOpenCodeMessageId(bytes) : receipt(runtime, bytes);
  },
  matches(runtime: RuntimeKind, key: string, messageId: string) {
    const bytes = createHash("sha256").update(key).digest();
    return runtime === "opencode"
      ? matchesOpenCodeMessageId(messageId, bytes)
      : messageId === receipt(runtime, bytes);
  },
};
