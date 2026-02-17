import { AgentChatPanel } from "@/components/features/agent-chat-panel";
import { SpecMarkdownPreview, SpecTemplateGuardrails } from "@/components/features/planner";
import { TaskSelector } from "@/components/features/tasks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useSpecState, useTasksState, useWorkspaceState } from "@/state";
import { defaultSpecTemplateMarkdown, validateSpecMarkdown } from "@openblueprint/contracts";
import { type ReactElement, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

export function PlannerPage(): ReactElement {
  const { activeRepo } = useWorkspaceState();
  const { tasks } = useTasksState();
  const { loadSpec, saveSpec } = useSpecState();
  const [searchParams, setSearchParams] = useSearchParams();
  const taskId = searchParams.get("task") ?? "";
  const [markdown, setMarkdown] = useState(defaultSpecTemplateMarkdown);

  useEffect(() => {
    if (!taskId) {
      setMarkdown(defaultSpecTemplateMarkdown);
      return;
    }

    loadSpec(taskId)
      .then((doc) => setMarkdown(doc))
      .catch(() => setMarkdown(defaultSpecTemplateMarkdown));
  }, [taskId, loadSpec]);

  const validation = useMemo(() => validateSpecMarkdown(markdown), [markdown]);
  const missingHeadings = useMemo(
    () => new Set(validation.missing.map((heading) => heading.toLowerCase())),
    [validation.missing],
  );

  return (
    <div className="grid h-full gap-4 xl:grid-cols-[minmax(320px,1fr)_minmax(540px,1.6fr)]">
      <AgentChatPanel
        mode="planner"
        conversationId={`planner-${taskId || "none"}`}
        title="Architect Agent"
        subtitle="Co-author specification details before implementation."
      />

      <div className="grid h-full gap-4 xl:grid-cols-[minmax(280px,0.8fr)_minmax(520px,1.4fr)]">
        <SpecTemplateGuardrails missingHeadings={missingHeadings} />

        <Card className="h-full">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="text-lg">Specification Workspace</CardTitle>
                <CardDescription>
                  Canonical spec is persisted in OpenDucktor metadata on the Beads issue.
                </CardDescription>
              </div>
              {validation.valid ? (
                <Badge variant="success">Template complete</Badge>
              ) : (
                <Badge variant="danger">Missing sections</Badge>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <div className="min-w-[260px]">
                <TaskSelector
                  tasks={tasks}
                  value={taskId}
                  onValueChange={(nextTaskId) => {
                    setSearchParams(nextTaskId ? { task: nextTaskId } : {});
                  }}
                />
              </div>
              <Button
                type="button"
                disabled={!activeRepo || !taskId || !validation.valid}
                onClick={() => {
                  if (!taskId) {
                    return;
                  }
                  void saveSpec(taskId, markdown);
                }}
              >
                Save Spec
              </Button>
            </div>
          </CardHeader>
          <CardContent className="grid h-[calc(100%-7rem)] gap-3 xl:grid-cols-[minmax(320px,1fr)_minmax(320px,1fr)]">
            <div className="grid min-h-[420px] grid-rows-[auto_1fr] gap-2">
              {!validation.valid ? (
                <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                  Missing required sections: {validation.missing.join(", ")}
                </div>
              ) : (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
                  All required sections are present.
                </div>
              )}

              <Textarea
                className="h-full min-h-[420px] resize-none font-mono text-xs leading-relaxed"
                value={markdown}
                onChange={(event) => setMarkdown(event.currentTarget.value)}
              />
            </div>
            <SpecMarkdownPreview markdown={markdown} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
