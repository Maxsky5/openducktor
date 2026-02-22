import {
  toModelGroupsByProvider,
  toModelOptions,
  toPrimaryAgentOptions,
} from "@/components/features/agents/catalog-select-options";
import {
  DEFAULT_BRANCH_PREFIX,
  ROLE_DEFAULTS,
  clearRoleDefault,
  emptyRepoSettings,
  ensureAgentDefault,
  findCatalogModel,
  getMissingRequiredRoleLabels,
  parseHookLines,
  selectedModelKeyForRole,
  toHookText,
  toRoleVariantOptions,
  updateRoleDefault,
} from "@/components/features/settings";
import { Button } from "@/components/ui/button";
import type { ComboboxOption } from "@/components/ui/combobox";
import { Combobox } from "@/components/ui/combobox";
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
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { useWorkspaceState } from "@/state";
import { loadRepoOpencodeCatalog } from "@/state/operations/opencode-catalog";
import type { AgentModelCatalog } from "@openducktor/core";
import { Settings2 } from "lucide-react";
import { type ReactElement, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

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
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [catalog, setCatalog] = useState<AgentModelCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [worktreeBasePath, setWorktreeBasePath] = useState("");
  const [branchPrefix, setBranchPrefix] = useState(DEFAULT_BRANCH_PREFIX);
  const [trustedHooks, setTrustedHooks] = useState(false);
  const [preStartHooks, setPreStartHooks] = useState("");
  const [postCompleteHooks, setPostCompleteHooks] = useState("");
  const [agentDefaults, setAgentDefaults] = useState(emptyRepoSettings().agentDefaults);

  const updateAgentDefault = (
    role: "spec" | "planner" | "build" | "qa",
    field: "providerId" | "modelId" | "variant" | "opencodeAgent",
    value: string,
  ): void => {
    setAgentDefaults((current) => updateRoleDefault(current, role, field, value));
  };

  const clearAgentDefault = (role: "spec" | "planner" | "build" | "qa"): void => {
    setAgentDefaults((current) => clearRoleDefault(current, role));
  };

  useEffect(() => {
    if (!open) {
      setSaveError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !activeRepo) {
      return;
    }

    let cancelled = false;
    setCatalogError(null);
    setCatalog(null);
    setIsLoadingConfig(true);
    setIsLoadingCatalog(true);
    void Promise.allSettled([loadRepoSettings(), loadRepoOpencodeCatalog(activeRepo)])
      .then(([settingsResult, catalogResult]) => {
        if (cancelled) {
          return;
        }

        if (settingsResult.status === "fulfilled") {
          const settings = settingsResult.value;
          setWorktreeBasePath(settings.worktreeBasePath);
          setBranchPrefix(settings.branchPrefix);
          setTrustedHooks(settings.trustedHooks);
          setPreStartHooks(toHookText(settings.preStartHooks));
          setPostCompleteHooks(toHookText(settings.postCompleteHooks));
          setAgentDefaults(settings.agentDefaults);
        } else {
          const defaults = emptyRepoSettings();
          setWorktreeBasePath(
            activeWorkspace?.configuredWorktreeBasePath ?? defaults.worktreeBasePath,
          );
          setBranchPrefix(defaults.branchPrefix);
          setTrustedHooks(defaults.trustedHooks);
          setPreStartHooks(toHookText(defaults.preStartHooks));
          setPostCompleteHooks(toHookText(defaults.postCompleteHooks));
          setAgentDefaults(defaults.agentDefaults);
        }

        if (catalogResult.status === "fulfilled") {
          setCatalog(catalogResult.value);
        } else {
          setCatalog(null);
          setCatalogError(errorMessage(catalogResult.reason));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingConfig(false);
          setIsLoadingCatalog(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeRepo, activeWorkspace, loadRepoSettings, open]);

  const modelOptions = useMemo<ComboboxOption[]>(() => {
    return toModelOptions(catalog);
  }, [catalog]);

  const agentOptions = useMemo<ComboboxOption[]>(() => {
    return toPrimaryAgentOptions(catalog);
  }, [catalog]);

  const modelGroups = useMemo(() => toModelGroupsByProvider(catalog), [catalog]);

  const missingRequiredRoleLabels = useMemo(() => {
    return getMissingRequiredRoleLabels(agentDefaults);
  }, [agentDefaults]);

  const canSaveRoleDefaults = missingRequiredRoleLabels.length === 0;

  const submit = async (): Promise<void> => {
    if (!canSaveRoleDefaults) {
      return;
    }

    setIsSaving(true);
    setSaveError(null);
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
    } catch (error: unknown) {
      const reason = errorMessage(error);
      setSaveError(reason);
      toast.error("Failed to save workspace settings", {
        description: reason,
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && isSaving) {
          return;
        }
        setOpen(nextOpen);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size={triggerSize} className={cn(triggerClassName)}>
          <Settings2 className="size-4" />
          Settings
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[90vh] max-w-4xl flex-col p-0">
        <DialogHeader className="shrink-0 border-b border-slate-200 px-6 pb-4 pt-6">
          <DialogTitle>Workspace Settings</DialogTitle>
          <DialogDescription>
            Settings are stored in <code>~/.openducktor/config.json</code>.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-6 py-4">
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
                Required defaults applied when sessions start in this repository.
              </p>
            </div>
            {isLoadingCatalog ? (
              <p className="text-xs text-slate-600">
                Loading available agents/models from OpenCode...
              </p>
            ) : null}
            {catalogError ? (
              <p className="text-xs text-amber-700">
                Failed to load OpenCode values: {catalogError}
              </p>
            ) : null}
            {!isLoadingCatalog && !canSaveRoleDefaults ? (
              <p className="text-xs text-rose-700">
                Agent and model are required for: {missingRequiredRoleLabels.join(", ")}.
              </p>
            ) : null}

            {ROLE_DEFAULTS.map(({ role, label }) => {
              const value = ensureAgentDefault(agentDefaults[role]);
              const roleVariantOptions = toRoleVariantOptions(catalog, agentDefaults, role);
              const modelKey = selectedModelKeyForRole(agentDefaults, role);
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

                  <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
                    <div className="grid min-w-0 gap-1">
                      <Label className="text-xs">Agent</Label>
                      <Combobox
                        value={value.opencodeAgent}
                        options={agentOptions}
                        placeholder={isLoadingCatalog ? "Loading agents..." : "Select agent"}
                        disabled={isLoadingCatalog || isSaving || agentOptions.length === 0}
                        onValueChange={(opencodeAgent) =>
                          updateAgentDefault(role, "opencodeAgent", opencodeAgent)
                        }
                      />
                    </div>
                    <div className="grid min-w-0 gap-1">
                      <Label className="text-xs">Model</Label>
                      <Combobox
                        value={modelKey}
                        options={modelOptions}
                        groups={modelGroups}
                        placeholder={isLoadingCatalog ? "Loading models..." : "Select model"}
                        disabled={isLoadingCatalog || isSaving || modelOptions.length === 0}
                        onValueChange={(selectedModelKey) => {
                          const model = findCatalogModel(catalog, selectedModelKey);
                          if (!model) {
                            return;
                          }
                          setAgentDefaults((current) => ({
                            ...current,
                            [role]: {
                              ...ensureAgentDefault(current[role]),
                              providerId: model.providerId,
                              modelId: model.modelId,
                              variant: model.variants[0] ?? "",
                            },
                          }));
                        }}
                      />
                    </div>
                    <div className="grid min-w-0 gap-1">
                      <Label className="text-xs">Variant</Label>
                      <Combobox
                        value={value.variant}
                        options={roleVariantOptions}
                        placeholder={
                          roleVariantOptions.length > 0 ? "Select variant" : "No variants for model"
                        }
                        disabled={
                          isLoadingCatalog ||
                          isSaving ||
                          !modelKey ||
                          roleVariantOptions.length === 0
                        }
                        onValueChange={(variant) => updateAgentDefault(role, "variant", variant)}
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

        <DialogFooter className="mt-0 shrink-0 items-center justify-between border-t border-slate-200 px-6 pb-6 pt-4">
          {saveError ? <p className="text-sm text-rose-700">{saveError}</p> : <span />}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void submit()}
              disabled={isSaving || isLoadingConfig || !activeRepo || !canSaveRoleDefaults}
            >
              {isSaving ? "Saving..." : "Save Settings"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
