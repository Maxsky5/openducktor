const CONTEXT_MENU_CLAIM_WINDOW_MS = 250;

export type ContextMenuClaimTracker = {
  claim(): void;
  shouldSuppressEvent(eventAt: number): boolean;
  claimArrivedAfter(eventAt: number): boolean;
};

export const createContextMenuClaimTracker = (
  now: () => number = Date.now,
  claimWindowMs = CONTEXT_MENU_CLAIM_WINDOW_MS,
): ContextMenuClaimTracker => {
  let pendingClaims = 0;
  let lastClaimedAt = 0;

  return {
    claim: () => {
      pendingClaims += 1;
      lastClaimedAt = now();
    },
    shouldSuppressEvent: (eventAt) => {
      if (pendingClaims === 0) {
        return false;
      }
      if (eventAt - lastClaimedAt >= claimWindowMs) {
        pendingClaims = 0;
        return false;
      }
      pendingClaims -= 1;
      return true;
    },
    claimArrivedAfter: (eventAt) => {
      if (pendingClaims === 0 || lastClaimedAt < eventAt) {
        return false;
      }
      pendingClaims -= 1;
      return true;
    },
  };
};
