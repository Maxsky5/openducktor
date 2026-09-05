// Keep short semantic keys readable. Hash long source identities before they cross
// the notification contract boundary, without truncating any identity input.
export const boundNotificationOccurrenceId = async (identity: string): Promise<string> => {
  if (identity.length <= 1024) return identity;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
};
