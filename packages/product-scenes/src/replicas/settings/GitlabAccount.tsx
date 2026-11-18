// The Account part of the GitLab setup card, as gitlab-account-panel.tsx in
// packages/frontend/src/components/features/settings shows it on GitLab.com: the ways to connect,
// GitLab sign-in and Access token, then the pending sign-in with its one-time code, then the linked
// account. The markup renders each step, and a scene shows one with `hidden`. While the sign-in
// starts, the connect step has `data-starting`, so its controls are disabled, and the sign-in
// button is busy. While the app checks the new link, the linked step has `data-checking`.
import {
  Copy,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  LogIn,
  type LucideIcon,
  UserRound,
} from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import "./GitlabAccount.css";

/** The steps of the account part that the scenes show. */
export type GitlabAccountStep = "connect" | "pending" | "linked";

/** The words of gitlab-account-panel.tsx. */
export const GITLAB_ACCOUNT_TEXT = {
  heading: "Account",
  hint: "Every repository on this GitLab instance can use the same account.",
  signInTitle: "GitLab sign-in",
  signInDescription: "Approve OpenDucktor in your browser.",
  signIn: "Sign in with GitLab",
  tokenTitle: "Access token",
  tokenDescription: "Use a token with the api scope.",
  createToken: "Create a token in GitLab",
  tokenPlaceholder: "Paste an access token",
  addToken: "Add token",
  approve: "Approve the sign-in in GitLab",
  waiting: "Waiting for your approval…",
  openSignIn: "Open GitLab sign-in",
  oneTimeCode: "One-time code",
  copyCode: "Copy code",
  cancelSignIn: "Cancel sign-in",
  checking: "Checking the connection…",
  signedIn: "Signed in with GitLab",
  useAnother: "Use another account",
  disconnect: "Disconnect",
} as const;

/** The title of a linked account, as LinkedAccount builds it. */
export function connectedAs(username: string, instance: string): string {
  return `Connected as @${username} on ${instance}`;
}

type GitlabAccountProps = {
  step: GitlabAccountStep;
  /** The account that the sign-in links: its GitLab username and display name. */
  account: { username: string; displayName: string };
  /** The label of the instance, such as gitlab.com. */
  instance: string;
  /** The one-time code of the pending sign-in. */
  code: string;
};

function IconTile({ icon: Icon }: { icon: LucideIcon }): ReactElement {
  return (
    <span className="gla-tile">
      <Icon />
    </span>
  );
}

/** Progress of gitlab-account-panel.tsx: a spinner and its label in text-xs. */
function Progress({ label }: { label: string }): ReactElement {
  return (
    <p className="gla-progress">
      <LoaderCircle className="spin" />
      {label}
    </p>
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
    <div className="gla-option">
      <div className="gla-option-head">
        <IconTile icon={icon} />
        <div className="gla-text">
          <b>{title}</b>
          <p>{description}</p>
          {link}
        </div>
      </div>
      <div className="gla-option-body">{children}</div>
    </div>
  );
}

/** ConnectOptions of GitLab.com: browser sign-in and a token side by side. */
function ConnectOptions({ hidden }: { hidden: boolean }): ReactElement {
  const text = GITLAB_ACCOUNT_TEXT;
  return (
    <div className="gla-options" data-account-step="connect" hidden={hidden}>
      <OptionCard icon={LogIn} title={text.signInTitle} description={text.signInDescription}>
        <Button className="gla-wide" data-sign-in>
          <LogIn className="ui-idle-icon" />
          <LoaderCircle className="spin ui-busy-icon" />
          {text.signIn}
        </Button>
      </OptionCard>
      <OptionCard
        icon={KeyRound}
        title={text.tokenTitle}
        description={text.tokenDescription}
        link={
          <span className="gla-link">
            {text.createToken}
            <ExternalLink />
          </span>
        }
      >
        <div className="gla-token">
          <span className="gla-token-field">
            <KeyRound />
            <Input placeholder={text.tokenPlaceholder} />
          </span>
          <Button className="gla-wide" data-disabled>
            {text.addToken}
          </Button>
        </div>
      </OptionCard>
    </div>
  );
}

/** PendingSignIn: the sign-in waits for the approval in the browser. */
function PendingSignIn({ code, hidden }: { code: string; hidden: boolean }): ReactElement {
  const text = GITLAB_ACCOUNT_TEXT;
  return (
    <div className="gla-pending" data-account-step="pending" hidden={hidden}>
      <div className="gla-pending-head">
        <div className="gla-text">
          <b>{text.approve}</b>
          <Progress label={text.waiting} />
        </div>
        <Button size="sm">
          {text.openSignIn}
          <ExternalLink />
        </Button>
      </div>
      <div className="gla-code">
        <div className="gla-text">
          <p>{text.oneTimeCode}</p>
          <strong>{code}</strong>
        </div>
        <Button variant="outline" size="sm">
          <Copy />
          {text.copyCode}
        </Button>
      </div>
      <div className="gla-end">
        <Button variant="outline" size="sm">
          {text.cancelSignIn}
        </Button>
      </div>
    </div>
  );
}

/** LinkedAccount: the account that the repository uses, with its fix buttons. */
function LinkedAccount({
  account,
  instance,
  hidden,
}: Pick<GitlabAccountProps, "account" | "instance"> & { hidden: boolean }): ReactElement {
  const text = GITLAB_ACCOUNT_TEXT;
  return (
    <div className="gla-linked" data-account-step="linked" hidden={hidden}>
      <div className="gla-linked-row">
        <div className="gla-linked-who">
          <IconTile icon={UserRound} />
          <div className="gla-text">
            <b>{connectedAs(account.username, instance)}</b>
            <div className="gla-checking">
              <Progress label={text.checking} />
            </div>
            <p className="gla-detail">
              {account.displayName} · {text.signedIn}
            </p>
          </div>
        </div>
        <div className="gla-buttons">
          <Button variant="outline" size="sm">
            {text.useAnother}
          </Button>
          <Button variant="outline" size="sm">
            {text.disconnect}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function GitlabAccount({ step, account, instance, code }: GitlabAccountProps): ReactElement {
  return (
    <section className="gla" data-gitlab-account="">
      <div className="gla-text">
        <b className="gla-heading">{GITLAB_ACCOUNT_TEXT.heading}</b>
        <p>{GITLAB_ACCOUNT_TEXT.hint}</p>
      </div>
      <ConnectOptions hidden={step !== "connect"} />
      <PendingSignIn code={code} hidden={step !== "pending"} />
      <LinkedAccount account={account} instance={instance} hidden={step !== "linked"} />
    </section>
  );
}
