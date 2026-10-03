import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FieldProps } from "./workspace-provider-fields";

export function GithubSetupFields({ provider, disabled }: FieldProps): ReactElement {
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {(
          [
            ["host", "Host"],
            ["owner", "Owner or organization"],
            ["name", "Repository"],
          ] as const
        ).map(([field, label]) => {
          const error = provider.errors[`repository.${field}`];
          return (
            <div className="grid gap-1.5" key={field}>
              <Label htmlFor={`setup-github-${field}`}>{label}</Label>
              <Input
                id={`setup-github-${field}`}
                value={provider.draft.github[field]}
                disabled={disabled}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? `setup-github-${field}-error` : undefined}
                onChange={(event) =>
                  provider.update((current) => ({
                    ...current,
                    github: { ...current.github, [field]: event.currentTarget.value },
                  }))
                }
              />
              {error ? (
                <p
                  id={`setup-github-${field}-error`}
                  className="text-xs text-destructive"
                  role="alert"
                >
                  {error}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
      <Button
        type="button"
        variant="outline"
        disabled={disabled || Boolean(provider.errors["repository.host"])}
        onClick={() => void provider.inspectGithub()}
      >
        Check GitHub CLI and authentication
      </Button>
      {provider.github ? (
        <div className="text-sm" role="status">
          <p>{provider.github.version ?? "GitHub CLI is unavailable."}</p>
          <p>
            {provider.github.authenticated
              ? `Authenticated${provider.github.account ? ` as ${provider.github.account}` : ""} on ${provider.draft.github.host}.`
              : (provider.github.reason ?? "Run gh auth login for this host.")}
          </p>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        GitHub uses the installed gh CLI. Install it if needed, then run gh auth login --hostname{" "}
        {provider.draft.github.host || "github.com"}.
      </p>
    </div>
  );
}
