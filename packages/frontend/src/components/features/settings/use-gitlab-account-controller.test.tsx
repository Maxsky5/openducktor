import { describe, expect, mock, test } from "bun:test";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
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

const renderController = (fromSavedSettings: boolean) => {
  const onLink = mock((_accountId: string | null, _instanceUrl: string) => undefined);
  const connection = createTestClientConnection({
    client: { gitlabAccountsList: async () => [account] },
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
