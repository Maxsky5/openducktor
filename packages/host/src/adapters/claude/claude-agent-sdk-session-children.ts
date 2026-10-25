export const childSessions = <T>(session: {
  subagentEventSessionsByToolUseId?: ReadonlyMap<string, T>;
  subagentEventSessionsByTaskId?: ReadonlyMap<string, T>;
}): T[] => [
  ...new Set([
    ...(session.subagentEventSessionsByToolUseId?.values() ?? []),
    ...(session.subagentEventSessionsByTaskId?.values() ?? []),
  ]),
];
