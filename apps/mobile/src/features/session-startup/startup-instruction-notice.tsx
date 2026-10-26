import type { StartupInstruction } from "@openducktor/contracts";
import type { ReactElement } from "react";
import { Text } from "@/ui/text";
import { useAnnounce } from "@/ui/use-announce";

const INSTRUCTION_TEXT = {
  submitting: "Submitting the initial instruction.",
  accepted: "The initial instruction was accepted.",
  queued: "The initial instruction is queued.",
  not_sent: "The initial instruction was not sent.",
  unknown:
    "Initial instruction delivery is unconfirmed. Inspect the session before you send again.",
} satisfies Record<StartupInstruction["state"], string>;

export function StartupInstructionNotice({
  instruction,
}: {
  instruction: StartupInstruction | undefined;
}): ReactElement | null {
  const message = instruction ? INSTRUCTION_TEXT[instruction.state] : null;
  useAnnounce(message);
  return message ? (
    <Text variant="footnote" tone="secondary" accessibilityLiveRegion="polite">
      {message}
    </Text>
  ) : null;
}
