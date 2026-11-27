import type { StartupInstruction } from "@openducktor/contracts";
import type { ReactElement } from "react";
import type { StyleProp, TextStyle } from "react-native";
import { Text } from "@/ui/text";
import { useAnnounce } from "@/ui/use-announce";

const INSTRUCTION_TEXT = {
  submitting: "Submitting the initial instruction.",
  accepted: null,
  queued: "The initial instruction is queued.",
  not_sent: "The initial instruction was not sent.",
  unknown:
    "Initial instruction delivery is unconfirmed. Inspect the session before you send again.",
} satisfies Record<StartupInstruction["state"], string | null>;

export function StartupInstructionNotice({
  instruction,
  style,
}: {
  instruction: StartupInstruction | undefined;
  style?: StyleProp<TextStyle>;
}): ReactElement | null {
  const baseMessage = instruction ? INSTRUCTION_TEXT[instruction.state] : null;
  const message =
    baseMessage && instruction?.state === "unknown" && instruction.submissionId
      ? `${baseMessage} Submission ID: ${instruction.submissionId}.`
      : baseMessage;
  useAnnounce(message);
  return message ? (
    <Text variant="footnote" tone="secondary" accessibilityLiveRegion="polite" style={style}>
      {message}
    </Text>
  ) : null;
}
