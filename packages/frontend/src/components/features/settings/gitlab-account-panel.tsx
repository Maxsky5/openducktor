import type { GitlabAccount, GitlabFixAction } from "@openducktor/contracts";
import { gitlabInstanceLabel, gitlabTokenPageUrl } from "@openducktor/core";
import {
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  LogIn,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import type { MouseEvent, ReactElement, ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { openExternalUrl } from "@/lib/open-external-url";
import { useCopyToClipboard } from "@/lib/use-copy-to-clipboard";
import { cn } from "@/lib/utils";
import type { GitlabAccountController } from "./use-gitlab-account-controller";

type GitlabAccountPanelProps = {
  controller: GitlabAccountController;
  linkedAccountId: string | null;
  disabled: boolean;
  /** Confirms HTTP for the instance, for the `confirm_http` fix action. */
  onConfirmHttp: () => void;
};

type ControllerProps = { controller: GitlabAccountController; disabled: boolean };

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
  const locked = disabled || controller.isAddingToken || controller.isStartingSignIn;
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
        <ErrorNote>GitLab accounts could not load: {controller.accountsError}</ErrorNote>
      ) : null}
      {controller.actionError ? <ErrorNote>{controller.actionError}</ErrorNote> : null}
    </section>
  );
}

function ErrorNote({ children }: { children: ReactNode }): ReactElement {
  return (
    <p
      role="alert"
      className="min-w-0 break-words rounded-md border border-destructive-border bg-destructive-surface p-3 text-xs text-destructive-surface-foreground"
    >
      {children}
    </p>
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
  if (controller.deviceCode) return <PendingSignIn controller={controller} />;
  if (controller.connectMode === "token")
    return (
      <TokenForm controller={controller} disabled={disabled} instanceUrl={instance} cancellable />
    );
  if (controller.connectMode === "sign_in")
    return (
      <ConnectOptions
        controller={controller}
        disabled={disabled}
        instanceUrl={instance}
        cancellable
      />
    );
  if (linkedAccountId)
    return (
      <LinkedAccount
        controller={controller}
        disabled={disabled}
        instanceUrl={instance}
        onConfirmHttp={onConfirmHttp}
      />
    );
  if (controller.accountsLoading)
    return <Progress label="Loading saved GitLab accounts…" className="text-xs" />;
  if (controller.accounts.length === 0)
    return (
      <ConnectOptions
        controller={controller}
        disabled={disabled}
        instanceUrl={instance}
        cancellable={false}
      />
    );
  return <ChooseAccount controller={controller} disabled={disabled} />;
}

function Progress({ label, className }: { label: string; className: string }): ReactElement {
  return (
    <p role="status" className={cn("flex items-center gap-2 text-muted-foreground", className)}>
      <LoaderCircle className="size-4 shrink-0 animate-spin" aria-hidden="true" />
      {label}
    </p>
  );
}

function IconTile({ icon: Icon }: { icon: LucideIcon }): ReactElement {
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
      <Icon className="size-4" aria-hidden="true" />
    </span>
  );
}

const credentialDetail = (account: GitlabAccount): string => {
  if (account.tokenExpiresAt)
    return `Token expires ${new Date(account.tokenExpiresAt).toLocaleDateString()}`;
  if (account.authKind === "oauth") return "Signed in with GitLab";
  return "Token without expiry";
};

function LinkedAccount({
  controller,
  disabled,
  instanceUrl,
  onConfirmHttp,
}: ControllerProps & { instanceUrl: string; onConfirmHttp: () => void }): ReactElement {
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
    <div className="grid min-w-0 gap-3 rounded-lg border border-border p-4">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <IconTile icon={UserRound} />
          <div className="min-w-0 space-y-0.5">
            <p className="truncate text-sm font-medium text-foreground">
              {account
                ? `Connected as @${account.username} on ${gitlabInstanceLabel(instanceUrl)}`
                : "Linked account"}
            </p>
            <LinkedAccountDetail account={account} checking={controller.statusLoading} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
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
            variant="outline"
            disabled={disabled}
            onClick={controller.disconnect}
          >
            Disconnect
          </Button>
        </div>
      </div>
      {status?.status === "needs_attention" ? (
        <div className="grid gap-3 rounded-md border border-warning-border bg-warning-surface p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
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
        <div className="grid gap-3 rounded-md border border-destructive-border bg-destructive-surface p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <p role="alert" className="break-words text-xs text-destructive-surface-foreground">
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

function LinkedAccountDetail({
  account,
  checking,
}: {
  account: GitlabAccount | null;
  checking: boolean;
}): ReactElement | null {
  if (checking) return <Progress label="Checking the connection…" className="text-xs" />;
  if (!account) return null;
  return (
    <p className="truncate text-xs text-muted-foreground">
      {account.displayName} · {credentialDetail(account)}
    </p>
  );
}

function ChooseAccount({ controller, disabled }: ControllerProps): ReactElement {
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
            className="flex min-w-0 cursor-pointer items-center gap-3 rounded-lg border border-border p-4 font-normal hover:bg-accent/50"
          >
            <RadioGroupItem id={`gitlab-account-${account.accountId}`} value={account.accountId} />
            <IconTile icon={UserRound} />
            <span className="min-w-0 space-y-0.5">
              <span className="block truncate text-sm font-medium text-foreground">
                @{account.username}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {account.displayName} · {credentialDetail(account)}
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

/**
 * The ways to connect a new account. GitLab.com offers browser sign-in and a token side by side.
 * A self-managed instance accepts a token only.
 */
function ConnectOptions({
  controller,
  disabled,
  instanceUrl,
  cancellable,
}: ControllerProps & { instanceUrl: string; cancellable: boolean }): ReactElement {
  if (!controller.isGitlabCom)
    return (
      <TokenForm
        controller={controller}
        disabled={disabled}
        instanceUrl={instanceUrl}
        cancellable={cancellable}
      />
    );
  return (
    <div className="grid min-w-0 gap-3">
      <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,18rem),1fr))] gap-3">
        <OptionCard
          icon={LogIn}
          title="GitLab sign-in"
          description="Approve OpenDucktor in your browser."
        >
          <Button
            type="button"
            className="w-full"
            disabled={disabled}
            onClick={controller.startSignIn}
          >
            {controller.isStartingSignIn ? (
              <LoaderCircle data-icon="inline-start" className="animate-spin" />
            ) : (
              <LogIn data-icon="inline-start" />
            )}
            Sign in with GitLab
          </Button>
        </OptionCard>
        <OptionCard
          icon={KeyRound}
          title="Access token"
          description="Use a token with the api scope."
          link={<CreateTokenLink url={gitlabTokenPageUrl(instanceUrl)} />}
        >
          <TokenForm
            controller={controller}
            disabled={disabled}
            instanceUrl={instanceUrl}
            cancellable={false}
            stacked
          />
        </OptionCard>
      </div>
      {cancellable ? <CancelConnect controller={controller} /> : null}
    </div>
  );
}

function OptionCard({
  icon,
  title,
  description,
  link,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  link?: ReactNode;
  children: ReactNode;
}): ReactElement {
  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-lg border border-border p-4">
      <div className="flex min-w-0 items-start gap-3">
        <IconTile icon={icon} />
        <div className="min-w-0 space-y-1">
          <h4 className="text-sm font-medium text-foreground">{title}</h4>
          <p className="text-xs text-muted-foreground">{description}</p>
          {link}
        </div>
      </div>
      <div className="mt-auto">{children}</div>
    </section>
  );
}

function CancelConnect({ controller }: { controller: GitlabAccountController }): ReactElement {
  return (
    <div className="flex justify-end">
      <Button type="button" size="sm" variant="outline" onClick={controller.closeConnect}>
        Cancel
      </Button>
    </div>
  );
}

/** Token entry. `stacked` fits it in an option card, with the button under the field. */
function TokenForm({
  controller,
  disabled,
  instanceUrl,
  cancellable,
  stacked = false,
}: ControllerProps & {
  instanceUrl: string;
  cancellable: boolean;
  stacked?: boolean;
}): ReactElement {
  const tokenPage = gitlabTokenPageUrl(instanceUrl);
  const replacing = controller.replacing;
  return (
    <form
      className="grid min-w-0 gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        controller.addToken();
      }}
    >
      <div className="grid min-w-0 gap-2">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <Label htmlFor="gitlab-token" className={stacked ? "sr-only" : undefined}>
            {replacing ? "New access token" : "Access token"}
          </Label>
          {stacked ? null : <CreateTokenLink url={tokenPage} />}
        </div>
        <div
          className={
            stacked ? "grid min-w-0 gap-2" : "grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"
          }
        >
          <div className="relative min-w-0">
            <KeyRound className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="gitlab-token"
              className="pl-9"
              type="password"
              autoComplete="off"
              placeholder="Paste an access token"
              value={controller.token}
              disabled={disabled}
              onChange={(event) => controller.setToken(event.target.value)}
            />
          </div>
          <Button
            type="submit"
            className={stacked ? "w-full" : undefined}
            disabled={disabled || !controller.token.trim()}
          >
            {controller.isAddingToken ? (
              <LoaderCircle data-icon="inline-start" className="animate-spin" />
            ) : null}
            {replacing ? "Replace token" : "Add token"}
          </Button>
        </div>
      </div>
      {stacked ? null : (
        <p className="text-xs text-muted-foreground">
          {replacing
            ? "The new token replaces the saved one for every repository that uses this account."
            : "Use a personal, project, or group access token with the api scope."}
        </p>
      )}
      {cancellable ? <CancelConnect controller={controller} /> : null}
    </form>
  );
}

function CreateTokenLink({ url }: { url: string }): ReactElement {
  return (
    <Button type="button" size="xs" variant="ghost" className="-mx-2 self-start" asChild>
      <a href={url} onClick={openUrl(url, "Failed to open the GitLab token page")}>
        Create a token in GitLab
        <ExternalLink data-icon="inline-end" />
      </a>
    </Button>
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
    <div className="grid min-w-0 gap-4">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium text-foreground">Approve the sign-in in GitLab</p>
          <Progress label="Waiting for your approval…" className="text-xs" />
        </div>
        <Button type="button" size="sm" asChild>
          <a href={url} onClick={openUrl(url, "Failed to open GitLab sign-in")}>
            Open GitLab sign-in
            <ExternalLink data-icon="inline-end" />
          </a>
        </Button>
      </div>
      <div className="flex min-w-0 flex-col gap-3 rounded-md border border-border bg-muted/30 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
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
      <div className="flex justify-end">
        <Button type="button" size="sm" variant="outline" onClick={controller.closeConnect}>
          Cancel sign-in
        </Button>
      </div>
    </div>
  );
}
