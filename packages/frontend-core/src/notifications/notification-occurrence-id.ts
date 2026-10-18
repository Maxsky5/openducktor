export const boundNotificationOccurrenceId = async (identity: string): Promise<string> => {
  if (identity.length <= 1024) return identity;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
  const hexDigest = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `sha256:${hexDigest}`;
};
