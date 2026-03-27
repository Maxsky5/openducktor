export function getClipboardErrorMessage(error: DOMException): string {
  switch (error.name) {
    case "NotAllowedError":
      return "Permission denied: clipboard access not allowed";
    case "NotFoundError":
      return "No clipboard available in this environment";
    case "AbortError":
      return "Copy operation was cancelled";
    default:
      return `Copy failed: ${error.message}`;
  }
}
