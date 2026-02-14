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
import { useOrchestrator } from "@/state/orchestrator-context";
import { Settings2 } from "lucide-react";
import { type ReactElement, useEffect, useState } from "react";

export function SettingsModal(): ReactElement {
  const { activeRepo, activeWorkspace, loadRepoSettings, saveRepoSettings, isBusy } =
    useOrchestrator();
  const [open, setOpen] = useState(false);
  const [isLoadingConfig, setIsLoadingConfig] = useState(false);
  const [worktreeBasePath, setWorktreeBasePath] = useState("");
  const [branchPrefix, setBranchPrefix] = useState("obp");
  const [trustedHooks, setTrustedHooks] = useState(false);
  const [preStartHooks, setPreStartHooks] = useState("");
  const [postCompleteHooks, setPostCompleteHooks] = useState("");

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
        setPreStartHooks(settings.preStartHooks.join("\n"));
        setPostCompleteHooks(settings.postCompleteHooks.join("\n"));
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setWorktreeBasePath(activeWorkspace?.configuredWorktreeBasePath ?? "");
        setBranchPrefix("obp");
        setTrustedHooks(false);
        setPreStartHooks("");
        setPostCompleteHooks("");
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
    await saveRepoSettings({
      worktreeBasePath,
      branchPrefix,
      trustedHooks,
      preStartHooks: preStartHooks
        .split("\n")
        .map((entry) => entry.trim())
        .filter(Boolean),
      postCompleteHooks: postCompleteHooks
        .split("\n")
        .map((entry) => entry.trim())
        .filter(Boolean),
    });

    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
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
              disabled={isLoadingConfig}
              onChange={(event) => setWorktreeBasePath(event.currentTarget.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="branch-prefix">Branch prefix</Label>
            <Input
              id="branch-prefix"
              value={branchPrefix}
              disabled={isLoadingConfig}
              onChange={(event) => setBranchPrefix(event.currentTarget.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="pre-hooks">Pre-start hooks (one command per line)</Label>
            <Textarea
              id="pre-hooks"
              rows={4}
              value={preStartHooks}
              disabled={isLoadingConfig}
              onChange={(event) => setPreStartHooks(event.currentTarget.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="post-hooks">Post-complete hooks (one command per line)</Label>
            <Textarea
              id="post-hooks"
              rows={4}
              value={postCompleteHooks}
              disabled={isLoadingConfig}
              onChange={(event) => setPostCompleteHooks(event.currentTarget.value)}
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={trustedHooks}
              disabled={isLoadingConfig}
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
            disabled={isBusy || isLoadingConfig || !activeRepo || !worktreeBasePath}
          >
            Save Settings
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
