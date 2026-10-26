import {
  isChatLocalDestination,
  parseChatFileLink,
} from "@openducktor/frontend-core/sessions/messages/chat-file-link";

/**
 * Decides what a Markdown link does on the device. Web and email links open in the device
 * browser or mail app, like the desktop external URL policy. File links follow the shared chat
 * file-link rules, and the caller opens the file. Every other link stays closed and shows its
 * reason.
 */
export type LinkTarget =
  | { readonly kind: "external"; readonly url: string }
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "rejected"; readonly reason: string };

// oxlint-disable-next-line no-control-regex -- Control characters must never reach a URL or path.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const SCHEME = /^([a-z][a-z\d+.-]*):/i;
// Phone and message links look like file citations, such as `tel:123`, but they are URLs.
const DEVICE_URL_SCHEME = /^(?:tel|sms):/i;

const rejected = (reason: string): LinkTarget => ({ kind: "rejected", reason });

export const classifyLink = (href: string): LinkTarget => {
  const destination = href.trim();
  if (destination.length === 0) return rejected("The link has no destination.");
  if (CONTROL_CHARACTERS.test(destination)) {
    return rejected("The link contains control characters, so it does not open.");
  }
  if (destination.startsWith("#")) {
    return rejected("The link points to a place in this text. Scroll to find it.");
  }
  const scheme = SCHEME.exec(destination)?.[1]?.toLowerCase();
  if (scheme === "http" || scheme === "https") return webLink(destination);
  if (scheme === "mailto") {
    return destination.length > "mailto:".length
      ? { kind: "external", url: destination }
      : rejected("The email link has no address.");
  }
  if (!DEVICE_URL_SCHEME.test(destination) && isChatLocalDestination(destination)) {
    const file = parseChatFileLink(destination);
    if (file.kind === "path") return { kind: "file", path: file.path };
    if (file.kind === "invalid") return rejected(file.message);
  }
  return rejected(
    "This kind of link does not open on this device. Web, email, and file links open.",
  );
};

const webLink = (destination: string): LinkTarget => {
  let url: URL;
  try {
    url = new URL(destination);
  } catch {
    return rejected("The web address is not valid.");
  }
  if (url.hostname.length === 0) return rejected("The web address has no host name.");
  return { kind: "external", url: url.href };
};
