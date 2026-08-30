import { HOST_COMMAND_NAMES, type HostCommandName } from "@openducktor/contracts";
import { HostValidationError } from "../../effect/host-errors";

export { HOST_COMMAND_NAMES, type HostCommandName };

const hostCommandNameSet = new Set<string>(HOST_COMMAND_NAMES);

export const isHostCommandName = (value: string): value is HostCommandName =>
  hostCommandNameSet.has(value);

export const parseHostCommandName = (value: string): HostCommandName => {
  if (isHostCommandName(value)) {
    return value;
  }

  throw new HostValidationError({
    message: `Unknown OpenDucktor host command: ${value}`,
    field: "command",
    details: { value },
  });
};
