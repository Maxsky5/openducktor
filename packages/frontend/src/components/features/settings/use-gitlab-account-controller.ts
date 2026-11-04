import type {
  GitlabAccount,
  GitlabAccountAddTokenInput,
  GitlabDeviceCode,
} from "@openducktor/contracts";
import { isGitlabComInstance } from "@openducktor/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { connectionHost } from "@openducktor/frontend-core/connection/client-connection";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { openExternalUrl } from "@/lib/open-external-url";
import {
  gitlabAccountsQueryOptionsOrSkip,
  gitlabConnectionStatusQueryOptionsOrSkip,
  invalidateGitlabQueries,
  singleGitlabAccountId,
} from "@openducktor/frontend-core/queries/gitlab";
import {
  type GitlabDraft,
  gitlabDraftInstanceUrl,
  gitlabStatusInput,
  parseGitlabDraft,
} from "./gitlab-provider-model";

export type GitlabConnectMode = "closed" | "token" | "sign_in";

type GitlabAccountOperation = "add_token" | "sign_in";

const OPERATION_LABELS = {
  add_token: "Add token",
  sign_in: "GitLab sign-in",
} as const satisfies Record<GitlabAccountOperation, string>;

type UseGitlabAccountControllerInput = {
  draft: GitlabDraft;
  enabled: boolean;
  /**
   * The draft comes from saved settings. Then a complete project without a link means a saved
   * Disconnect, so the open draft does not auto-link its instance.
   */
  fromSavedSettings: boolean;
  /**
   * Links an account to the repository draft, or removes the link. A result can arrive after
   * the user changed the draft or closed the form, so the caller applies it only while its
   * latest draft still uses `instanceUrl`.
   */
  onLink: (accountId: string | null, instanceUrl: string) => void;
};

const SETTLE_DELAY_MS = 400;

/** The value once its key has not changed for a short pause. */
const useSettledValue = <T>(value: T, key: string): T => {
  const [settled, setSettled] = useState({ key, value });
  useEffect(() => {
    if (settled.key === key) return;
    const timer = setTimeout(() => setSettled({ key, value }), SETTLE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [key, settled.key, value]);
  return settled.value;
};

/** Owns the saved accounts of the instance, sign-in, and token entry for one repository draft. */
export function useGitlabAccountController({
  draft,
  enabled,
  fromSavedSettings,
  onLink,
}: UseGitlabAccountControllerInput) {
  const queryClient = useQueryClient();
  const instanceUrl = enabled ? gitlabDraftInstanceUrl(draft) : null;
  const accountsQuery = useQuery(gitlabAccountsQueryOptionsOrSkip(instanceUrl));
  const statusInput = enabled ? gitlabStatusInput(draft) : null;
  // Each check is a GitLab request, so typing in the project field checks only after a pause.
  const settledStatusInput = useSettledValue(statusInput, JSON.stringify(statusInput));
  const statusQuery = useQuery(gitlabConnectionStatusQueryOptionsOrSkip(settledStatusInput));
  const accounts = accountsQuery.data ?? [];
  const linkedAccount =
    accounts.find((account) => account.accountId === draft.accountId) ??
    (statusQuery.data?.account?.accountId === draft.accountId ? statusQuery.data.account : null);
  const isGitlabCom = instanceUrl !== null && isGitlabComInstance(instanceUrl);

  const [connectMode, setConnectMode] = useState<GitlabConnectMode>("closed");
  const [replaceAccountId, setReplaceAccountId] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [deviceCode, setDeviceCode] = useState<GitlabDeviceCode | null>(null);
  const [pendingOperation, setPendingOperation] = useState<GitlabAccountOperation | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // After Disconnect, the user chooses the account of that instance. Another instance auto-links.
  const declinedInstanceRef = useRef<string | null>(
    fromSavedSettings && draft.accountId === null && parseGitlabDraft(draft)
      ? gitlabDraftInstanceUrl(draft)
      : null,
  );
  const attemptRef = useRef<string | null>(null);
  // Each close of sign-in or token entry starts a new session. A late startup reply of an old
  // session must not restore its sign-in or start polling.
  const connectSessionRef = useRef(0);

  const closeConnect = () => {
    connectSessionRef.current += 1;
    attemptRef.current = null;
    setDeviceCode(null);
    setConnectMode("closed");
    setReplaceAccountId(null);
    setToken("");
  };

  /**
   * Call after each draft edit. A new instance ends the sign-in or token entry of the old one.
   * Without a link, the only saved account of the instance becomes the link.
   */
  const afterDraftChange = (next: GitlabDraft): void => {
    const nextInstanceUrl = gitlabDraftInstanceUrl(next);
    if (nextInstanceUrl !== instanceUrl) closeConnect();
    if (
      next.accountId !== null ||
      !enabled ||
      !nextInstanceUrl ||
      declinedInstanceRef.current === nextInstanceUrl
    )
      return;
    void singleGitlabAccountId(queryClient, nextInstanceUrl)
      .then((accountId) => {
        if (accountId && declinedInstanceRef.current !== nextInstanceUrl)
          onLink(accountId, nextInstanceUrl);
      })
      .catch((cause: unknown) =>
        setActionError(`GitLab accounts could not load: ${errorMessage(cause)}`),
      );
  };

  const connected = async (account: GitlabAccount) => {
    await invalidateGitlabQueries(queryClient);
    closeConnect();
    // The account belongs to the instance that saved it, not to a later draft instance.
    onLink(account.accountId, account.instanceUrl);
  };

  const run = async (operation: GitlabAccountOperation, action: () => Promise<void>) => {
    setPendingOperation(operation);
    setActionError(null);
    try {
      await action();
    } catch (cause) {
      setActionError(`${OPERATION_LABELS[operation]} failed: ${errorMessage(cause)}`);
    } finally {
      setPendingOperation(null);
    }
  };

  const addToken = () =>
    run("add_token", async () => {
      if (!instanceUrl) throw new Error("Enter a valid GitLab instance URL first.");
      const project = parseGitlabDraft(draft);
      const input: GitlabAccountAddTokenInput = { instanceUrl, token };
      if (project) input.projectPath = project.projectPath;
      if (draft.httpConsentInstanceUrl) input.httpConsentInstanceUrl = draft.httpConsentInstanceUrl;
      if (replaceAccountId) input.replaceAccountId = replaceAccountId;
      const account = await connectionHost(queryClient).gitlabAccountAddToken(input);
      await connected(account);
    });

  const pollSignIn = async (code: GitlabDeviceCode) => {
    let nextPollAt = code.nextPollAt;
    while (attemptRef.current === code.attemptId) {
      const delay = Math.max(0, Date.parse(nextPollAt) - Date.now());
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (attemptRef.current !== code.attemptId) return;
      const result = await connectionHost(queryClient).gitlabSignInPoll({
        attemptId: code.attemptId,
      });
      if (attemptRef.current !== code.attemptId) return;
      if (result.status === "pending") {
        nextPollAt = result.nextPollAt;
        continue;
      }
      attemptRef.current = null;
      if (result.status === "connected") await connected(result.account);
      else {
        setDeviceCode(null);
        setActionError(result.reason);
      }
    }
  };

  const startSignIn = () =>
    run("sign_in", async () => {
      const session = connectSessionRef.current;
      const code = await connectionHost(queryClient).gitlabSignInStart();
      if (connectSessionRef.current === session) {
        attemptRef.current = code.attemptId;
        setDeviceCode(code);
        setConnectMode("sign_in");
        // The page URL carries the one-time code, so the user only approves the sign-in there.
        void openExternalUrl(code.verificationUriComplete).catch((cause: unknown) =>
          setActionError(
            `GitLab sign-in did not open: ${errorMessage(cause)}. Use Open GitLab sign-in.`,
          ),
        );
        void pollSignIn(code).catch((cause: unknown) => {
          if (attemptRef.current !== code.attemptId) return;
          attemptRef.current = null;
          setDeviceCode(null);
          setActionError(`GitLab sign-in failed: ${errorMessage(cause)}`);
        });
      }
    });

  useEffect(
    () => () => {
      connectSessionRef.current += 1;
      attemptRef.current = null;
    },
    [],
  );

  return {
    instanceUrl,
    isGitlabCom,
    accounts,
    accountsLoading: accountsQuery.isLoading,
    accountsError: accountsQuery.error ? errorMessage(accountsQuery.error) : null,
    linkedAccount,
    status: statusQuery.data ?? null,
    statusLoading: statusQuery.isFetching,
    statusError: statusQuery.error ? errorMessage(statusQuery.error) : null,
    retryStatus: () => void statusQuery.refetch(),
    connectMode,
    /** Opens token entry or sign-in for a new or other account. */
    useAnotherAccount: () => {
      setReplaceAccountId(null);
      setActionError(null);
      setConnectMode(isGitlabCom ? "sign_in" : "token");
    },
    /** Opens token entry that updates the linked account for every repository. */
    replaceToken: () => {
      setReplaceAccountId(draft.accountId);
      setActionError(null);
      setConnectMode("token");
    },
    closeConnect,
    replacing: replaceAccountId !== null,
    pickAccount: (accountId: string) => {
      if (instanceUrl) onLink(accountId, instanceUrl);
    },
    disconnect: () => {
      declinedInstanceRef.current = instanceUrl;
      if (instanceUrl) onLink(null, instanceUrl);
    },
    afterDraftChange,
    token,
    setToken,
    addToken: () => void addToken(),
    deviceCode,
    startSignIn: () => void startSignIn(),
    isAddingToken: pendingOperation === "add_token",
    isStartingSignIn: pendingOperation === "sign_in",
    actionError,
  };
}

export type GitlabAccountController = ReturnType<typeof useGitlabAccountController>;
