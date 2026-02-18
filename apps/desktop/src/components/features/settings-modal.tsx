import {
  DEFAULT_BRANCH_PREFIX,
  emptyRepoSettings,
  parseHookLines,
  toHookText,
} from "@/components/features/settings";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useWorkspaceState } from "@/state";
import type { RepoAgentDefaultInput } from "@/types/state-slices";
import { Settings2 } from "lucide-react";
import { type ReactElement, useEffect, useState } from "react";

type SettingsModalProps = {
  triggerClassName?: string;
  triggerSize?: "default" | "sm" | "lg" | "icon";
};

export function SettingsModal({
  triggerClassName,
  triggerSize = "sm",
}: SettingsModalProps): ReactElement {
  const { activeRepo, activeWorkspace, loadRepoSettings, saveRepoSettings } = useWorkspaceState();
  const [open, setOpen] = useState(false);
  const [isLoadingConfig, setIsLoadingConfig] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [worktreeBasePath, setWorktreeBasePath] = useState("");
  const [branchPrefix, setBranchPrefix] = useState(DEFAULT_BRANCH_PREFIX);
  const [trustedHooks, setTrustedHooks] = useState(false);
  const [preStartHooks, setPreStartHooks] = useState("");
  const [postCompleteHooks, setPostCompleteHooks] = useState("");
  const [agentDefaults, setAgentDefaults] = useState(emptyRepoSettings().agentDefaults);

  const ensureAgentDefault = (value: RepoAgentDefaultInput | null): RepoAgentDefaultInput =>
    value ?? {
      providerId: "",
      modelId: "",
      variant: "",
      opencodeAgent: "",
    };

  const updateAgentDefault = (
    role: "spec" | "planner" | "build" | "qa",
    field: keyof RepoAgentDefaultInput,
    value: string,
  ): void => {
    setAgentDefaults((current) => {
      const next = ensureAgentDefault(current[role]);
      return {
        ...current,
        [role]: {
          ...next,
          [field]: value,
        },
      };
    });
  };

  const clearAgentDefault = (role: "spec" | "planner" | "build" | "qa"): void => {
    setAgentDefaults((current) => ({
      ...current,
      [role]: null,
    }));
  };

  useEffect(() => {
    if (!open || !activeRepo) {
      return;
    }

    let cancelled = false;
    setIsLoadingConfig(true);
    void loadRepoSettings()
      .then((settings) => {
        if (cancelled) {
          return;
        }
        setWorktreeBasePath(settings.worktreeBasePath);
        setBranchPrefix(settings.branchPrefix);
        setTrustedHooks(settings.trustedHooks);
        setPreStartHooks(toHookText(settings.preStartHooks));
        setPostCompleteHooks(toHookText(settings.postCompleteHooks));
        setAgentDefaults(settings.agentDefaults);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        const defaults = emptyRepoSettings();
        setWorktreeBasePath(
          activeWorkspace?.configuredWorktreeBasePath ?? defaults.worktreeBasePath,
        );
        setBranchPrefix(defaults.branchPrefix);
        setTrustedHooks(defaults.trustedHooks);
        setPreStartHooks(toHookText(defaults.preStartHooks));
        setPostCompleteHooks(toHookText(defaults.postCompleteHooks));
        setAgentDefaults(defaults.agentDefaults);
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingConfig(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeRepo, activeWorkspace, loadRepoSettings, open]);

  const submit = async (): Promise<void> => {
    setIsSaving(true);
    try {
      await saveRepoSettings({
        worktreeBasePath,
        branchPrefix,
        trustedHooks,
        preStartHooks: parseHookLines(preStartHooks),
        postCompleteHooks: parseHookLines(postCompleteHooks),
        agentDefaults,
      });

      setOpen(false);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size={triggerSize} className={cn(triggerClassName)}>
          <Settings2 className="size-4" />
          Settings
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Workspace Settings</DialogTitle>
          <DialogDescription>
            Settings are stored in <code>~/.openblueprint/config.json</code>.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 pt-2">
          {!activeRepo ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              Select or add a workspace first, then save settings for that repository.
            </div>
          ) : null}

          {activeRepo ? (
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Active repo: <code className="font-mono">{activeRepo}</code>
            </div>
          ) : null}

          <div className="grid gap-2">
            <Label htmlFor="worktree-path">Worktree base path</Label>
            <Input
              id="worktree-path"
              placeholder="/absolute/path/outside/repo"
              value={worktreeBasePath}
              disabled={isLoadingConfig || isSaving}
              onChange={(event) => setWorktreeBasePath(event.currentTarget.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="branch-prefix">Branch prefix</Label>
            <Input
              id="branch-prefix"
              value={branchPrefix}
              disabled={isLoadingConfig || isSaving}
              onChange={(event) => setBranchPrefix(event.currentTarget.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="pre-hooks">Pre-start hooks (one command per line)</Label>
            <Textarea
              id="pre-hooks"
              rows={4}
              value={preStartHooks}
              disabled={isLoadingConfig || isSaving}
              onChange={(event) => setPreStartHooks(event.currentTarget.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="post-hooks">Post-complete hooks (one command per line)</Label>
            <Textarea
              id="post-hooks"
              rows={4}
              value={postCompleteHooks}
              disabled={isLoadingConfig || isSaving}
              onChange={(event) => setPostCompleteHooks(event.currentTarget.value)}
            />
          </div>

          <div className="grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Agent Defaults (Per Role)</h3>
              <p className="text-xs text-slate-600">
                Optional defaults applied when sessions start in this repository.
              </p>
            </div>

            {(
              [
                ["spec", "Spec"],
                ["planner", "Planner"],
                ["build", "Build"],
                ["qa", "QA"],
              ] as const
            ).map(([role, label]) => {
              const value = ensureAgentDefault(agentDefaults[role]);
              return (
                <div key={role} className="grid gap-2 rounded border border-slate-200 bg-white p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {label}
                    </p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={isLoadingConfig || isSaving}
                      onClick={() => clearAgentDefault(role)}
                    >
                      Clear
                    </Button>
                  </div>

                  <div className="grid gap-2 md:grid-cols-2">
                    <div className="grid gap-1">
                      <Label htmlFor={`${role}-provider`} className="text-xs">
                        Provider ID
                      </Label>
                      <Input
                        id={`${role}-provider`}
                        value={value.providerId}
                        placeholder="openai"
                        disabled={isLoadingConfig || isSaving}
                        onChange={(event) =>
                          updateAgentDefault(role, "providerId", event.currentTarget.value)
                        }
                      />
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor={`${role}-model`} className="text-xs">
                        Model ID
                      </Label>
                      <Input
                        id={`${role}-model`}
                        value={value.modelId}
                        placeholder="gpt-5"
                        disabled={isLoadingConfig || isSaving}
                        onChange={(event) =>
                          updateAgentDefault(role, "modelId", event.currentTarget.value)
                        }
                      />
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor={`${role}-variant`} className="text-xs">
                        Variant
                      </Label>
                      <Input
                        id={`${role}-variant`}
                        value={value.variant}
                        placeholder="high"
                        disabled={isLoadingConfig || isSaving}
                        onChange={(event) =>
                          updateAgentDefault(role, "variant", event.currentTarget.value)
                        }
                      />
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor={`${role}-agent`} className="text-xs">
                        OpenCode Agent
                      </Label>
                      <Input
                        id={`${role}-agent`}
                        value={value.opencodeAgent}
                        placeholder="build"
                        disabled={isLoadingConfig || isSaving}
                        onChange={(event) =>
                          updateAgentDefault(role, "opencodeAgent", event.currentTarget.value)
                        }
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={trustedHooks}
              disabled={isLoadingConfig || isSaving}
              onChange={(event) => setTrustedHooks(event.currentTarget.checked)}
            />
            Trust hooks for this workspace
          </label>
        </div>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void submit()}
            disabled={isSaving || isLoadingConfig || !activeRepo}
          >
            {isSaving ? "Saving..." : "Save Settings"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
