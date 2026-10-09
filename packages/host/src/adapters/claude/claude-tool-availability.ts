import {
  CLAUDE_RESERVED_TOOL_LIMITS,
  claudeToolAvailabilitySchema,
  claudeToolName,
  type ClaudeToolAvailability,
} from "@openducktor/contracts";

export const getDisabledTools = (availability?: ClaudeToolAvailability): ReadonlySet<string> => {
  const parsed = claudeToolAvailabilitySchema.safeParse(availability ?? {});
  if (!parsed.success)
    throw new Error(
      `Claude tool settings are invalid. Correct the tool names in Settings before starting a session. ${parsed.error.message}`,
    );
  const disabled = new Set<string>();
  for (const [name, enabled] of Object.entries(parsed.data)) {
    if (enabled) continue;
    const limitation = disableLimit(name);
    if (limitation)
      throw new Error(
        `${limitation} Enable ${name} in Claude tool settings before starting a session.`,
      );
    disabled.add(claudeToolName(name));
  }
  return disabled;
};

export const disabledToolReason = (name: string): string =>
  `Tool ${name} is disabled by this session's tool settings.`;

export const disableLimit = (name: string): string | undefined =>
  CLAUDE_RESERVED_TOOL_LIMITS.find((tool) => tool.name === name)?.limitation;
