import type { GlobalGitConfig, RuntimeCheck } from "@openducktor/contracts";
import type { ReactElement } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type SettingsGitSectionProps = {
  git: GlobalGitConfig;
  runtimeCheck: RuntimeCheck | null;
  disabled: boolean;
  onUpdateGit: (updater: (current: GlobalGitConfig) => GlobalGitConfig) => void;
};

export function SettingsGitSection({
  git,
  runtimeCheck,
  disabled,
  onUpdateGit,
}: SettingsGitSectionProps): ReactElement {
  const ghCliReady = runtimeCheck?.ghOk ?? false;
  const ghAuthReady = runtimeCheck?.ghAuthOk ?? false;
  const ghVersion = runtimeCheck?.ghVersion;
  const ghLogin = runtimeCheck?.ghAuthLogin;
  const ghAuthError = runtimeCheck?.ghAuthError;

  return (
    <div className="grid gap-4 p-4">
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">Git Defaults</h3>
        <p className="text-xs text-muted-foreground">
          Set the default direct-merge behavior used by the human approval flow.
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">Default merge method</p>
        <Tabs
          value={git.defaultMergeMethod}
          onValueChange={(value) =>
            onUpdateGit(() => ({
              defaultMergeMethod: value as GlobalGitConfig["defaultMergeMethod"],
            }))
          }
        >
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="merge_commit" disabled={disabled}>
              Merge Commit
            </TabsTrigger>
            <TabsTrigger value="squash" disabled={disabled}>
              Squash
            </TabsTrigger>
            <TabsTrigger value="rebase" disabled={disabled}>
              Rebase
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-md border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-foreground">GitHub CLI</p>
              <p className="text-xs text-muted-foreground">
                Pull requests require the `gh` command-line client.
              </p>
            </div>
            <span
              className={
                ghCliReady
                  ? "inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700"
                  : "inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700"
              }
            >
              {ghCliReady ? "Installed" : "Missing"}
            </span>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {ghVersion ? ghVersion : "Install GitHub CLI to enable provider-backed pull requests."}
          </p>
        </div>

        <div className="rounded-md border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-foreground">GitHub Authentication</p>
              <p className="text-xs text-muted-foreground">
                Approval can open pull requests only when GitHub authentication is ready.
              </p>
            </div>
            <span
              className={
                ghAuthReady
                  ? "inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700"
                  : "inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700"
              }
            >
              {ghAuthReady ? "Authenticated" : "Action required"}
            </span>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {ghAuthReady
              ? ghLogin
                ? `Authenticated as ${ghLogin}.`
                : "Authenticated with GitHub."
              : ghAuthError ?? "Run `gh auth login` to connect GitHub."}
          </p>
        </div>
      </div>
    </div>
  );
}
