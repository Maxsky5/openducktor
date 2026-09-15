export const CONTEXT_MENU_CLAIM_WINDOW_MS = 250;

export type ContextMenuClaimTarget = {
  webContentsId: number;
  x: number;
  y: number;
};

export type ContextMenuClaimTracker = {
  claim(target: ContextMenuClaimTarget): void;
  trackEvent(target: ContextMenuClaimTarget): number;
  takeClaim(eventId: number): boolean;
};

type PendingContextMenuEvent = {
  claimed: boolean;
  eventAt: number;
  target: ContextMenuClaimTarget;
};

type UnmatchedContextMenuClaim = {
  claimedAt: number;
  target: ContextMenuClaimTarget;
};

const isSameTarget = (left: ContextMenuClaimTarget, right: ContextMenuClaimTarget): boolean =>
  left.webContentsId === right.webContentsId && left.x === right.x && left.y === right.y;

export const createContextMenuClaimTracker = (
  now: () => number = Date.now,
  claimWindowMs = CONTEXT_MENU_CLAIM_WINDOW_MS,
): ContextMenuClaimTracker => {
  const pendingEvents = new Map<number, PendingContextMenuEvent>();
  let unmatchedClaims: UnmatchedContextMenuClaim[] = [];
  let nextEventId = 0;

  return {
    claim: (target) => {
      const claimedAt = now();
      let matchingEvent: PendingContextMenuEvent | undefined;
      for (const event of pendingEvents.values()) {
        if (
          !event.claimed &&
          isSameTarget(event.target, target) &&
          claimedAt - event.eventAt < claimWindowMs
        ) {
          matchingEvent = event;
        }
      }
      if (matchingEvent) {
        matchingEvent.claimed = true;
        return;
      }
      unmatchedClaims = unmatchedClaims.filter(
        (claim) => claimedAt - claim.claimedAt < claimWindowMs,
      );
      unmatchedClaims.push({ claimedAt, target });
    },
    trackEvent: (target) => {
      const eventAt = now();
      unmatchedClaims = unmatchedClaims.filter(
        (claim) => eventAt - claim.claimedAt < claimWindowMs,
      );
      const claimIndex = unmatchedClaims.findLastIndex(
        (claim) => isSameTarget(claim.target, target) && eventAt - claim.claimedAt < claimWindowMs,
      );
      const eventId = nextEventId;
      nextEventId += 1;
      pendingEvents.set(eventId, {
        claimed: claimIndex >= 0,
        eventAt,
        target,
      });
      if (claimIndex >= 0) {
        unmatchedClaims.splice(claimIndex, 1);
      }
      return eventId;
    },
    takeClaim: (eventId) => {
      const event = pendingEvents.get(eventId);
      pendingEvents.delete(eventId);
      return event?.claimed ?? false;
    },
  };
};
