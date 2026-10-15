const GITHUB_NO_REPLY = /^(?:(\d+)\+)?([^@\s]+)@users\.noreply\.github\.com$/iu;
export const AVATAR_SIZE_PX = 64;

export const normalizedEmail = (email: string): string => email.trim().toLowerCase();

/**
 * The photo address of a GitHub no-reply email, or null for another email. The address comes from
 * the email itself, so no hash leaves the app for these authors.
 */
export function gitHubAvatarUrl(email: string): string | null {
  const match = GITHUB_NO_REPLY.exec(normalizedEmail(email));
  if (!match) return null;
  const [, id, login] = match;
  if (id) return `https://avatars.githubusercontent.com/u/${id}?s=${AVATAR_SIZE_PX}&v=4`;
  return `https://github.com/${encodeURIComponent(login ?? "")}.png?size=${AVATAR_SIZE_PX}`;
}

/** Gravatar answers 404 for an email without a photo, so the initials show instead. */
export const gravatarUrl = (emailSha256: string): string =>
  `https://gravatar.com/avatar/${emailSha256}?s=${AVATAR_SIZE_PX}&d=404`;
