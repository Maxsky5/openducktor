import { Effect } from "effect";
import { steeringPartsBlockedReason } from "@openducktor/core";
import { HostValidationError } from "../../effect/host-errors";
import type { AgentMessageDeliveryDependencies } from "./agent-message-delivery-service";
import type { AgentSessionSendContent } from "./agent-session-operation-policy";

export const messageSteeringBlock = (
  content: AgentSessionSendContent,
  availability: AgentMessageDeliveryDependencies["steeringAvailability"],
) => {
  const partsReason = steeringPartsBlockedReason(content.parts);
  if (partsReason)
    return Effect.succeed(new HostValidationError({ field: "parts", message: partsReason }));
  return availability(content.runtimeKind).pipe(
    Effect.map((steering) =>
      steering.available
        ? null
        : new HostValidationError({ field: "mode", message: steering.reason }),
    ),
  );
};
