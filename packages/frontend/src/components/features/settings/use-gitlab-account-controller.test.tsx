import { describe, expect, mock, test } from "bun:test";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { configureShellBridge } from "@/lib/shell-bridge";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import { QueryProvider } from "@/test-utils/query-provider";
import { gitlabDraftFromConfig } from "./gitlab-provider-model";
import { useGitlabAccountController } from "./use-gitlab-account-controller";

const account = {
  accountId: "4b0b1d5a-1c49-4f43-9f7b-5f1d2d4f0c11",
  instanceUrl: "https://gitlab.com",
  userId: 1,
  username: "alice",
  displayName: "Alice",
  authKind: "token" as const,
  tokenExpiresAt: null,
};
const unlinkedProject = { ...gitlabDraftFromConfig(undefined), projectPath: "group/app" };

const deviceCode = {
  attemptId: "attempt-1",
  verificationUri: "https://gitlab.com/oauth/device",
  verificationUriComplete: "https://gitlab.com/oauth/device?user_code=FDG0A2Q2",
  userCode: "FDG0A2Q2",
  expiresAt: "2099-01-01T00:00:00.000Z",
  // A real code polls a few seconds later. The test ends before this poll time.
  nextPollAt: new Date(Date.now() + 60_000).toISOString(),
};

const renderController = (fromSavedSettings: boolean) => {
  const onLink = mock((_accountId: string | null, _instanceUrl: string) => undefined);
  const connection = createTestClientConnection({
    client: {
      gitlabAccountsList: async () => [account],
      gitlabSignInStart: async () => deviceCode,
    },
  });
  const wrapper = ({ children }: PropsWithChildren) =>
    createElement(QueryProvider, { connection }, children);
  const { result } = renderHook(
    () =>
      useGitlabAccountController({
        draft: unlinkedProject,
        enabled: true,
        fromSavedSettings,
        onLink,
      }),
    { wrapper },
  );
  return { result, onLink };
};

describe("GitLab account auto-link", () => {
  test("links the sole account of a new draft that opens without a link", async () => {
    const { result, onLink } = renderController(false);
    result.current.afterDraftChange(unlinkedProject);
    await waitFor(() =>
      expect(onLink).toHaveBeenCalledWith(account.accountId, "https://gitlab.com"),
    );
  });

  test("keeps a saved Disconnect: a saved project without a link does not auto-link", async () => {
    const { result, onLink } = renderController(true);
    result.current.afterDraftChange(unlinkedProject);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onLink).not.toHaveBeenCalled();
  });
});

describe("GitLab browser sign-in", () => {
  test("opens the sign-in page with the one-time code when sign-in starts", async () => {
    const openExternalUrl = mock(async (_url: string) => {});
    configureShellBridge(createShellBridgeFixture({ bridge: { openExternalUrl } }));
    const { result } = renderController(false);

    result.current.startSignIn();

    await waitFor(() =>
      expect(openExternalUrl).toHaveBeenCalledWith(deviceCode.verificationUriComplete),
    );
    expect(result.current.deviceCode).toEqual(deviceCode);
  });
});
