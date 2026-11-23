const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const UINT64_MASK = 0xffffffffffffffffn;
const encoder = new TextEncoder();

/**
 * A 64-bit FNV-1a fingerprint of a user message text. A saved turn applies to a history entry only
 * when the entry text still has this fingerprint, so it detects a message that another client
 * changed. It has no security role.
 */
export const agentSessionMessageFingerprint = (text: string): string => {
  let hash = FNV_OFFSET_BASIS;
  for (const byte of encoder.encode(text)) {
    hash = ((hash ^ BigInt(byte)) * FNV_PRIME) & UINT64_MASK;
  }
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
};

/** True when a saved turn still names this user message text. */
export const turnMatchesMessage = (
  turn: { readonly userMessageHash: string },
  text: string,
): boolean => turn.userMessageHash === agentSessionMessageFingerprint(text);
