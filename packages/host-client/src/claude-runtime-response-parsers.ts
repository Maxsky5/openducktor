import type {
  ClaudeRuntimeCommandContract,
  ClaudeRuntimeCommandName,
} from "@openducktor/contracts";
import type { InvokeFn } from "./invoke-utils";

export const claudeRuntimeCommand = async <Input, Response, RawInput = Input>(
  invokeFn: InvokeFn,
  contract: ClaudeRuntimeCommandContract<Input, Response> & { command: ClaudeRuntimeCommandName },
  input: RawInput,
): Promise<Response> => {
  const parsedInput = contract.inputSchema.parse(input);
  const payload = await invokeFn(contract.command, { input: parsedInput });
  return contract.responseSchema.parse(payload);
};
