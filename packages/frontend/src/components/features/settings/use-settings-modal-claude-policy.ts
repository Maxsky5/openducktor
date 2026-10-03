import { claudeRuntimeConfigSchema, type ClaudeRuntimeConfig } from "@openducktor/contracts";
import { useState } from "react";
import { buildNewClaudeDangerousSelectionKey } from "./settings-claude-policy";

export const useSettingsModalClaudePolicy = ({
  open,
  baseline,
  draft,
}: {
  open: boolean;
  baseline: ClaudeRuntimeConfig | null;
  draft: ClaudeRuntimeConfig | null;
}) => {
  const key = open && draft ? buildNewClaudeDangerousSelectionKey({ baseline, draft }) : "";
  const [acknowledgedKey, setAcknowledgedKey] = useState("");
  if (acknowledgedKey && acknowledgedKey !== key) setAcknowledgedKey("");
  const requiresClaudeDangerAcknowledgement = key !== "";
  const isClaudeDangerAcknowledged = requiresClaudeDangerAcknowledgement && acknowledgedKey === key;
  const parsed = draft ? claudeRuntimeConfigSchema.safeParse(draft) : null;
  const claudeValidationError =
    parsed && !parsed.success
      ? parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")
      : null;
  const claudeSettingsSaveError = claudeValidationError
    ? `Fix Claude settings: ${claudeValidationError}`
    : requiresClaudeDangerAcknowledgement && !isClaudeDangerAcknowledged
      ? "Confirm the Claude safety acknowledgement before saving."
      : null;
  return {
    requiresClaudeDangerAcknowledgement,
    isClaudeDangerAcknowledged,
    setClaudeDangerAcknowledged: (value: boolean) => setAcknowledgedKey(value ? key : ""),
    claudeValidationError,
    claudeSettingsSaveError,
  };
};
