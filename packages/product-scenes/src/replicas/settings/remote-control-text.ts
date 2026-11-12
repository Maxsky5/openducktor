// Text of remote control that the desktop app and the mobile app share. Sources: REMOTE_HTTP_WARNING
// and REMOTE_PAIRING_CODE_LIFETIME_MS of remote-host-schemas.ts in packages/contracts.

/** The notice of a host address that starts with http://. */
export const REMOTE_HTTP_WARNING = "HTTP is not encrypted. Use a trusted private network or HTTPS.";

/** A pairing code works for 5 minutes. */
export const PAIRING_CODE_LIFETIME_MS = 5 * 60_000;
