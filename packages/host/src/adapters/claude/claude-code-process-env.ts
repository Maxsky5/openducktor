type OpenDucktorClaudeClientApp = "openducktor" | "openducktor/runtime-probe";

/**
 * Names OpenDucktor as the client of each Claude Code process it starts.
 *
 * `CLAUDE_CODE_ENTRYPOINT` is absent from the public SDK types. The SDK sets `sdk-ts` only when it is unset.
 * Claude Code sends the value as `cc_entrypoint` on API requests, and `sdk-ts` gets lower subscription usage limits.
 * An inherited host value such as `cli` or `claude-desktop` names the wrong client, so OpenDucktor always replaces it.
 *
 * Claude Code turns off its `Artifact` tool only for `sdk-*` entrypoints, so OpenDucktor keeps it off unless the user sets `CLAUDE_CODE_ARTIFACT`.
 * Claude Code `/resume` lists these sessions, because the CLI hides only `sdk-*` entrypoints.
 */
export const withOpenDucktorClaudeCodeEnv = (
  env: NodeJS.ProcessEnv,
  clientApp: OpenDucktorClaudeClientApp,
): NodeJS.ProcessEnv => ({
  ...env,
  CLAUDE_AGENT_SDK_CLIENT_APP: clientApp,
  CLAUDE_CODE_ENTRYPOINT: "openducktor",
  CLAUDE_CODE_ARTIFACT: env.CLAUDE_CODE_ARTIFACT ?? "0",
});
