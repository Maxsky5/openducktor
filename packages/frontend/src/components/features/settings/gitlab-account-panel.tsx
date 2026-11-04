import type { GitlabAccount, GitlabFixAction } from "@openducktor/contracts";
import { gitlabInstanceLabel, gitlabTokenPageUrl } from "@openducktor/core";
import { Check, Copy, ExternalLink, KeyRound, LoaderCircle, LogIn, UserRound } from "lucide-react";
import type { MouseEvent, ReactElement } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { openExternalUrl } from "@/lib/open-external-url";
import { useCopyToClipboard } from "@/lib/use-copy-to-clipboard";
import type { GitlabAccountController } from "./use-gitlab-account-controller";

type GitlabAccountPanelProps = {
  controller: GitlabAccountController;
  linkedAccountId: string | null;
  disabled: boolean;
  /** Confirms HTTP for the instance, for the `confirm_http` fix action. */
  onConfirmHttp: () => void;
};

const openUrl = (url: string, failure: string) => (event: MouseEvent<HTMLAnchorElement>) => {
  event.preventDefault();
  void openExternalUrl(url).catch((cause) => {
    toast.error(failure, { description: errorMessage(cause) });
  });
};

export function GitlabAccountPanel({
  controller,
  linkedAccountId,
  disabled,
  onConfirmHttp,
}: GitlabAccountPanelProps): ReactElement {
  const locked = disabled || controller.pending !== null;
  return (
    <section
      className="grid min-w-0 gap-3 border-t border-border pt-5"
      aria-labelledby="gitlab-account-heading"
    >
      <div className="space-y-1">
        <h3 id="gitlab-account-heading" className="text-sm font-semibold text-foreground">
          Account
        </h3>
        <p className="text-xs text-muted-foreground">
          Every repository on this GitLab instance can use the same account.
        </p>
      </div>
      <AccountStep
        controller={controller}
        linkedAccountId={linkedAccountId}
        disabled={locked}
        onConfirmHttp={onConfirmHttp}
      />
      {controller.accountsError ? (
        <p role="alert" className="text-xs text-destructive-surface-foreground">
          GitLab accounts could not load: {controller.accountsError}
        </p>
      ) : null}
      {controller.actionError ? (
        <p
          role="alert"
          className="min-w-0 break-words rounded-md border border-destructive-border bg-destructive-surface p-3 text-xs text-destructive-surface-foreground"
        >
          {controller.actionError}
        </p>
      ) : null}
    </section>
  );
}

/** The account step that fits the instance, the open connect form, and the link. */
function AccountStep({
  controller,
  linkedAccountId,
  disabled,
  onConfirmHttp,
}: GitlabAccountPanelProps): ReactElement {
  const instance = controller.instanceUrl;
  if (instance === null)
    return <p className="text-xs text-muted-foreground">Enter a valid instance URL first.</p>;
  if (controller.connectMode !== "closed")
    return <ConnectAccount controller={controller} disabled={disabled} instanceUrl={instance} />;
  if (linkedAccountId)
    return (
      <LinkedAccount
        controller={controller}
        disabled={disabled}
        instanceUrl={instance}
        onConfirmHttp={onConfirmHttp}
      />
    );
  return <ChooseAccount controller={controller} disabled={disabled} />;
}

const credentialDetail = (account: GitlabAccount): string => {
  if (account.tokenExpiresAt)
    return ` · Token expires ${new Date(account.tokenExpiresAt).toLocaleDateString()}`;
  if (account.authKind === "oauth") return " · Signed in with GitLab";
  return " · Token without expiry";
};

function LinkedAccount({
  controller,
  disabled,
  instanceUrl,
  onConfirmHttp,
}: {
  controller: GitlabAccountController;
  disabled: boolean;
  instanceUrl: string;
  onConfirmHttp: () => void;
}): ReactElement {
  const account = controller.linkedAccount;
  const status = controller.status;
  const fix = {
    replace_token: { label: "Replace token", run: controller.replaceToken },
    sign_in_again: { label: "Sign in again", run: controller.useAnotherAccount },
    use_another_account: { label: "Use another account", run: controller.useAnotherAccount },
    retry: { label: "Retry", run: controller.retryStatus },
    confirm_http: { label: "Confirm HTTP", run: onConfirmHttp },
  } satisfies Record<GitlabFixAction, { label: string; run: () => void }>;
  return (
    <div className="grid min-w-0 gap-3 rounded-md border border-border bg-muted/30 p-3">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <UserRound className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">
              {account
                ? `Connected as @${account.username} on ${gitlabInstanceLabel(instanceUrl)}`
                : "Linked account"}
            </p>
            {account ? (
              <p className="truncate text-xs text-muted-foreground">
                {account.displayName}
                {credentialDetail(account)}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {controller.statusLoading ? (
            <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={controller.useAnotherAccount}
          >
            Use another account
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={controller.disconnect}
          >
            Disconnect
          </Button>
        </div>
      </div>
      {status?.status === "needs_attention" ? (
        <div className="grid gap-2 rounded-md border border-warning-border bg-warning-surface p-3">
          <p role="alert" className="break-words text-xs text-warning-surface-foreground">
            {status.message}
          </p>
          <div className="flex flex-wrap gap-2">
            {status.actions
              .filter((action) => action !== "use_another_account")
              .map((action) => (
                <Button
                  key={action}
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  onClick={fix[action].run}
                >
                  {fix[action].label}
                </Button>
              ))}
          </div>
        </div>
      ) : null}
      {controller.statusError ? (
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="text-xs text-destructive-surface-foreground">
            The GitLab connection check failed: {controller.statusError}
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={controller.retryStatus}
          >
            Retry
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ChooseAccount({
  controller,
  disabled,
}: {
  controller: GitlabAccountController;
  disabled: boolean;
}): ReactElement {
  if (controller.accountsLoading)
    return <p className="text-xs text-muted-foreground">Loading saved GitLab accounts…</p>;
  if (controller.accounts.length === 0)
    return (
      <div className="flex flex-wrap items-center gap-2">
        {controller.isGitlabCom ? (
          <SignInChoice controller={controller} disabled={disabled} />
        ) : (
          <Button type="button" size="sm" disabled={disabled} onClick={controller.useToken}>
            <KeyRound data-icon="inline-start" />
            Add access token
          </Button>
        )}
      </div>
    );
  return (
    <div className="grid gap-3">
      <RadioGroup
        aria-label="GitLab account"
        disabled={disabled}
        className="grid gap-2"
        onValueChange={controller.pickAccount}
      >
        {controller.accounts.map((account) => (
          <Label
            key={account.accountId}
            htmlFor={`gitlab-account-${account.accountId}`}
            className="flex cursor-pointer items-center gap-3 rounded-md border border-input bg-card p-3 hover:bg-accent/50"
          >
            <RadioGroupItem id={`gitlab-account-${account.accountId}`} value={account.accountId} />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">@{account.username}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {account.displayName}
              </span>
            </span>
          </Label>
        ))}
      </RadioGroup>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="justify-self-start"
        disabled={disabled}
        onClick={controller.useAnotherAccount}
      >
        Use another account
      </Button>
    </div>
  );
}

/** GitLab.com offers browser sign-in first and a token second. */
function SignInChoice({
  controller,
  disabled,
}: {
  controller: GitlabAccountController;
  disabled: boolean;
}): ReactElement {
  return (
    <>
      <Button type="button" size="sm" disabled={disabled} onClick={controller.startSignIn}>
        <LogIn data-icon="inline-start" />
        Sign in with GitLab
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={disabled}
        onClick={controller.useToken}
      >
        Use a token instead
      </Button>
    </>
  );
}

function ConnectAccount({
  controller,
  disabled,
  instanceUrl,
}: {
  controller: GitlabAccountController;
  disabled: boolean;
  instanceUrl: string;
}): ReactElement {
  if (controller.connectMode === "sign_in")
    return controller.deviceCode ? (
      <PendingSignIn controller={controller} />
    ) : (
      <div className="flex flex-wrap items-center gap-2">
        <SignInChoice controller={controller} disabled={disabled} />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={disabled}
          onClick={controller.closeConnect}
        >
          Cancel
        </Button>
      </div>
    );
  const tokenPage = gitlabTokenPageUrl(instanceUrl);
  return (
    <form
      className="grid min-w-0 gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        controller.addToken();
      }}
    >
      <p className="text-xs text-muted-foreground">
        {controller.replacing
          ? "The new token replaces the saved one for every repository that uses this account."
          : "Use a personal, project, or group access token with the api scope."}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid min-w-64 flex-1 gap-1.5">
          <Label htmlFor="gitlab-token">Access token</Label>
          <Input
            id="gitlab-token"
            type="password"
            autoComplete="off"
            value={controller.token}
            disabled={disabled}
            onChange={(event) => controller.setToken(event.target.value)}
          />
        </div>
        <Button type="button" size="sm" variant="outline" asChild>
          <a href={tokenPage} onClick={openUrl(tokenPage, "Failed to open the GitLab token page")}>
            Create token
            <ExternalLink data-icon="inline-end" />
          </a>
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={disabled || !controller.token.trim()}>
          {controller.pending === "Add token" ? (
            <LoaderCircle data-icon="inline-start" className="animate-spin" />
          ) : (
            <KeyRound data-icon="inline-start" />
          )}
          {controller.replacing ? "Replace token" : "Add token"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={disabled}
          onClick={controller.closeConnect}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

function PendingSignIn({ controller }: { controller: GitlabAccountController }): ReactElement {
  const { copied, copyToClipboard } = useCopyToClipboard({
    successMessage: "Sign-in code copied",
    errorLogContext: "GitlabAccountPanel.copyDeviceCode",
  });
  const code = controller.deviceCode!;
  const url = code.verificationUriComplete;
  return (
    <div className="grid min-w-0 gap-3">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
          <p className="text-sm text-foreground">Waiting for GitLab sign-in…</p>
        </div>
        <Button type="button" size="sm" asChild>
          <a href={url} onClick={openUrl(url, "Failed to open GitLab sign-in")}>
            Open GitLab sign-in
            <ExternalLink data-icon="inline-end" />
          </a>
        </Button>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">One-time code</p>
          <p className="break-all font-mono text-base font-semibold tracking-wide text-foreground">
            {code.userCode}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void copyToClipboard(code.userCode)}
        >
          {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
          {copied ? "Copied" : "Copy code"}
        </Button>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="justify-self-end"
        onClick={controller.closeConnect}
      >
        Cancel sign-in
      </Button>
    </div>
  );
}
