import { type CSSProperties, type ReactElement, useEffect, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import { authorInitials } from "./git-history-graph-model";

const GITHUB_NO_REPLY = /^(?:(\d+)\+)?([^@\s]+)@users\.noreply\.github\.com$/iu;
const AVATAR_SIZE_PX = 64;

const normalizedEmail = (email: string): string => email.trim().toLowerCase();

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

/**
 * Photo addresses and failed photos of every author, shared by all History rows. A row mounts and
 * unmounts as the list scrolls, so it reads this store instead of hashing and loading again.
 */
const avatarUrls = new Map<string, string | null>();
const pendingUrls = new Set<string>();
const failedUrls = new Set<string>();
const listeners = new Set<() => void>();
const notify = (): void => {
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const sha256Hex = async (text: string): Promise<string> => {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

async function loadGravatarUrl(key: string): Promise<void> {
  try {
    avatarUrls.set(key, gravatarUrl(await sha256Hex(key)));
  } catch (error) {
    // Without a hash the author keeps the initials. The console keeps the cause.
    avatarUrls.set(key, null);
    console.error("[git-history] Failed to hash an author email.", { error });
  } finally {
    pendingUrls.delete(key);
    notify();
  }
}

/** Finds the photo address of an email once. Gravatar gets only the SHA-256 of the email. */
function requestAvatarUrl(email: string): void {
  const key = normalizedEmail(email);
  if (!key || avatarUrls.has(key) || pendingUrls.has(key)) return;
  const gitHub = gitHubAvatarUrl(key);
  if (gitHub) {
    avatarUrls.set(key, gitHub);
    notify();
    return;
  }
  pendingUrls.add(key);
  void loadGravatarUrl(key);
}

/** The photo address to show for an email, or null while it is unknown or after it failed. */
function useAvatarUrl(email: string): string | null {
  const key = normalizedEmail(email);
  useEffect(() => requestAvatarUrl(key), [key]);
  return useSyncExternalStore(subscribe, () => {
    const url = avatarUrls.get(key) ?? null;
    return url && !failedUrls.has(url) ? url : null;
  });
}

/** The author photo, or the initials when no photo exists or it does not load. */
export function AuthorAvatar({
  name,
  email,
  className,
  initialsClassName,
  style,
}: {
  name: string;
  email: string;
  className?: string;
  initialsClassName?: string;
  style?: CSSProperties;
}): ReactElement {
  const url = useAvatarUrl(email);
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-full",
        className,
      )}
      style={style}
      aria-hidden="true"
      data-testid="agent-studio-git-history-avatar"
    >
      {url ? (
        <img
          src={url}
          alt=""
          width={AVATAR_SIZE_PX}
          height={AVATAR_SIZE_PX}
          loading="lazy"
          decoding="async"
          draggable={false}
          referrerPolicy="no-referrer"
          className="size-full object-cover"
          onError={() => {
            failedUrls.add(url);
            notify();
          }}
        />
      ) : (
        <span className={cn("leading-none font-bold select-none", initialsClassName)}>
          {authorInitials(name)}
        </span>
      )}
    </span>
  );
}
