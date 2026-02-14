import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { pickRepositoryDirectory } from "@/lib/repo-directory";
import { useOrchestrator } from "@/state/orchestrator-context";
import { FolderOpen, Sparkles } from "lucide-react";
import { type ReactElement, useState } from "react";
import { useNavigate } from "react-router-dom";

export function OpenRepositoryPage(): ReactElement {
  const {
    activeRepo,
    workspaces,
    addWorkspace,
    selectWorkspace,
    statusText,
    isSwitchingWorkspace,
  } = useOrchestrator();
  const [isPickingRepo, setIsPickingRepo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const openSelectedRepo = async (): Promise<void> => {
    setIsPickingRepo(true);
    setError(null);
    try {
      const path = await pickRepositoryDirectory();
      if (!path) {
        return;
      }

      await addWorkspace(path);
      navigate("/kanban", { replace: true });
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setIsPickingRepo(false);
    }
  };

  return (
    <div className="mx-auto grid h-full max-w-4xl place-items-center">
      <Card className="w-full max-w-2xl border-slate-200 bg-white/95 shadow-md">
        <CardHeader className="rounded-t-xl border-b border-slate-100 bg-gradient-to-r from-sky-50 via-white to-emerald-50">
          <CardTitle className="flex items-center gap-2 text-2xl">
            <Sparkles className="size-5 text-sky-600" />
            Open a Repository
          </CardTitle>
          <CardDescription>
            Select the repository you want to orchestrate. OpenBlueprint will contextualize Kanban,
            Planner, and Builder to this repo.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4 p-6">
          <Button
            type="button"
            size="lg"
            className="w-full"
            onClick={() => void openSelectedRepo()}
            disabled={isPickingRepo}
          >
            <FolderOpen className="size-4" />
            {isPickingRepo ? "Opening directory picker..." : "Choose Repository Folder"}
          </Button>

          {activeRepo ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              Active repository: <code className="font-mono">{activeRepo}</code>
            </div>
          ) : null}

          {error ? (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </div>
          ) : null}

          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
            {statusText}
          </div>

          <div className="space-y-2">
            <p className="text-sm font-semibold text-slate-800">Recent Workspaces</p>
            {workspaces.length === 0 ? (
              <p className="text-sm text-slate-500">No repositories configured yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {workspaces.map((workspace) => (
                  <Button
                    key={workspace.path}
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isSwitchingWorkspace}
                    onClick={() => {
                      void selectWorkspace(workspace.path).catch(() => {
                        // Status/error is handled in orchestrator context.
                      });
                      navigate("/kanban", { replace: true });
                    }}
                  >
                    {workspace.path}
                  </Button>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
