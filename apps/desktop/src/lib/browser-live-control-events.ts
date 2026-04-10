export type BrowserLiveControlEventKind = "reconnected" | "stream-warning";

export type BrowserLiveControlEvent = {
  __openducktorBrowserLive: true;
  kind: BrowserLiveControlEventKind;
  message?: string;
};

export const browserLiveControlEvent = (
  kind: BrowserLiveControlEventKind,
  message?: string,
): BrowserLiveControlEvent => ({
  __openducktorBrowserLive: true,
  kind,
  ...(message ? { message } : {}),
});

export const isBrowserLiveControlEvent = (payload: unknown): payload is BrowserLiveControlEvent => {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const record = payload as Record<string, unknown>;
  return (
    record.__openducktorBrowserLive === true &&
    (record.kind === "reconnected" || record.kind === "stream-warning")
  );
};
