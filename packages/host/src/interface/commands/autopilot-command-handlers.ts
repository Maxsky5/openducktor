import {
  autopilotRecoveryClaimInputSchema,
  autopilotStateReadInputSchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { AutopilotService } from "../../application/autopilot/autopilot-service";
import { type HostCommandArgs, parseCommandInput } from "./command-inputs";

export const createAutopilotCommandHandlers = (
  autopilot: Pick<AutopilotService, "readState" | "claimRecovery">,
) => ({
  autopilot_state_read: (args: HostCommandArgs) => {
    const input = parseCommandInput(autopilotStateReadInputSchema, args, "autopilot_state_read");
    return Effect.sync(() => autopilot.readState(input));
  },
  autopilot_recovery_claim: (args: HostCommandArgs) => {
    const input = parseCommandInput(
      autopilotRecoveryClaimInputSchema,
      args,
      "autopilot_recovery_claim",
    );
    return Effect.sync(() => autopilot.claimRecovery(input));
  },
});
