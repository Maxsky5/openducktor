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
  test("times out a success response that stalls after its headers", async () => {
    const probe = createStalledProviderResponse();
    try {
      const http = createGitlabHttp(probe.fetch);
      const result = await timeoutStalledRequest(probe, http.send(request));

      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        expect(result.failure.message).toContain("did not answer within 30 seconds");
        expect(gitlabProblemOf(result.failure)?.problem).toBe("instance_unreachable");
      }
      await probe.responseClosed;
      expect((await probe.requestSignal).aborted).toBe(true);
    } finally {
      await probe.close();
    }
  });

  test("times out a client error response that stalls after its headers", async () => {
    const probe = createStalledProviderResponse({ status: 400 });
    try {
      const http = createGitlabHttp(probe.fetch);
      const result = await timeoutStalledRequest(probe, http.sendAllowingClientErrors(request));

      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        expect(result.failure.message).toContain("did not answer within 30 seconds");
        expect(gitlabProblemOf(result.failure)?.problem).toBe("instance_unreachable");
      }
      await probe.responseClosed;
      expect((await probe.requestSignal).aborted).toBe(true);
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
      expect((await probe.requestSignal).aborted).toBe(true);
    } finally {
      await probe.close();
    }
  });
});
