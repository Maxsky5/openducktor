import {
  hostEventEnvelopeSchema,
  parseHostEventChannel,
  parseHostEventEnvelope,
} from "./host-event-schemas";

describe("host event contracts", () => {
  test("parses redacted Azure DevOps connection updates", () => {
    expect(
      parseHostEventEnvelope({
        channel: "openducktor://azure-devops-connection-updated",
        payload: {
          workspaceId: "workspace-1",
          repoPath: "/repo",
          providerId: "azure_devops",
          configurationFingerprint: "workspace-1\n/repo\nazure_devops\nrepository-key",
          attemptId: "8f7c9548-59a8-4f0e-a788-370a060d3f4f",
          state: { status: "connected", account: "dev@example.test" },
        },
      }),
    ).toEqual({
      channel: "openducktor://azure-devops-connection-updated",
      payload: {
        workspaceId: "workspace-1",
        repoPath: "/repo",
        providerId: "azure_devops",
        configurationFingerprint: "workspace-1\n/repo\nazure_devops\nrepository-key",
        attemptId: "8f7c9548-59a8-4f0e-a788-370a060d3f4f",
        state: { status: "connected", account: "dev@example.test" },
      },
    });
  });
  test("parses each channel payload through its envelope branch", () => {
    const envelope = parseHostEventEnvelope({
      channel: "openducktor://agent-session-live-event",
      payload: { type: "snapshot", repoPath: "/repo", sessions: [] },
    });

    expect(envelope).toEqual({
      channel: "openducktor://agent-session-live-event",
      payload: { type: "snapshot", repoPath: "/repo", sessions: [] },
    });
    expect(
      hostEventEnvelopeSchema.safeParse({
        channel: "openducktor://dev-server-event",
        payload: { type: "not-a-dev-event" },
      }).success,
    ).toBe(false);
  });

  test("preserves channel and envelope validation messages", () => {
    expect(() => parseHostEventChannel("openducktor://missing-event")).toThrow(
      "Unknown OpenDucktor host event channel: openducktor://missing-event",
    );
    expect(() =>
      parseHostEventEnvelope(JSON.parse('{"channel":"openducktor://missing-event","payload":{}}')),
    ).toThrow("Invalid OpenDucktor host event envelope.");
  });
});
