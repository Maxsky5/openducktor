import { describe, expect, test } from "bun:test";
import {
  createStalledProviderResponse,
  interruptStalledRequest,
  timeoutStalledRequest,
} from "../stalled-provider-response.test-support";
import { createGitlabHttp, gitlabProblemOf } from "./http";

const request = {
  operation: "read user",
  instanceUrl: "https://gitlab.example.com",
  path: "/api/v4/user",
};

describe("GitLab HTTP", () => {
  test.each([
    ["send", 200],
    ["sendAllowingClientErrors", 400],
  ] as const)("times out %s when the response stalls after its headers", async (method, status) => {
    const probe = createStalledProviderResponse(status);
    try {
      const http = createGitlabHttp(probe.fetch);
      const result = await timeoutStalledRequest(
        probe,
        method === "send" ? http.send(request) : http.sendAllowingClientErrors(request),
      );

      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        expect(result.failure.message).toContain("did not answer within 30 seconds");
        expect(gitlabProblemOf(result.failure)?.problem).toBe("instance_unreachable");
      }
      await probe.responseClosed;
      const signal = await probe.requestSignal;
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal?.aborted).toBe(true);
    } finally {
      await probe.close();
    }
  });

  test("aborts a stalled response body when the request is interrupted", async () => {
    const probe = createStalledProviderResponse();
    try {
      const http = createGitlabHttp(probe.fetch);

      await interruptStalledRequest(probe, http.send(request));

      await probe.responseClosed;
      const signal = await probe.requestSignal;
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal?.aborted).toBe(true);
    } finally {
      await probe.close();
    }
  });
});
