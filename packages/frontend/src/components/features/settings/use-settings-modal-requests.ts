import { useCallback, useRef, useState } from "react";
import type { SettingsDeepLink } from "./settings-deep-link";

export type SettingsModalOpenRequest = {
  deepLink?: SettingsDeepLink;
  onOpenChange?: (open: boolean) => void;
};

type ActiveSettingsRequest = SettingsModalOpenRequest & { id: number };

export const useSettingsModalRequests = () => {
  const [activeRequest, setActiveRequest] = useState<ActiveSettingsRequest | null>(null);
  const activeRequestRef = useRef<ActiveSettingsRequest | null>(null);
  const requestIdRef = useRef(0);

  const openSettings = useCallback((request: SettingsModalOpenRequest = {}): void => {
    if (activeRequestRef.current) return;
    const nextRequest = { ...request, id: ++requestIdRef.current };
    activeRequestRef.current = nextRequest;
    setActiveRequest(nextRequest);
    request.onOpenChange?.(true);
  }, []);

  const handleOpenChange = useCallback((open: boolean): void => {
    if (open) return;
    const request = activeRequestRef.current;
    activeRequestRef.current = null;
    setActiveRequest(null);
    request?.onOpenChange?.(false);
  }, []);

  return { activeRequest, openSettings, handleOpenChange };
};
