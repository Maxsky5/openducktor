import { AgentChatPanel } from "@/components/features/agent-chat-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useOrchestrator } from "@/state/orchestrator-context";
import { specTemplateSections } from "@openblueprint/contracts";
import { CheckCircle2, CircleDotDashed } from "lucide-react";
import { type ReactElement, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

export function PlannerPage(): ReactElement {
  const {
    tasks,
    selectedTask,
    setSelectedTaskId,
    loadSpec,
    saveSpec,
    validateSpec,
    specTemplate,
    activeRepo,
  } = useOrchestrator();
  const [searchParams, setSearchParams] = useSearchParams();
  const taskId = searchParams.get("task") ?? selectedTask?.id ?? "";
  const [markdown, setMarkdown] = useState(specTemplate);

  useEffect(() => {
    if (!taskId) {
      setMarkdown(specTemplate);
      return;
    }

    setSelectedTaskId(taskId);
    loadSpec(taskId)
      .then((doc) => setMarkdown(doc))
      .catch(() => setMarkdown(specTemplate));
  }, [taskId, loadSpec, setSelectedTaskId, specTemplate]);

  const validation = useMemo(() => validateSpec(markdown), [markdown, validateSpec]);
  const missingHeadings = useMemo(
    () => new Set(validation.missing.map((heading) => heading.toLowerCase())),
    [validation.missing],
  );
  const previewEntries = useMemo(() => {
    const occurrences = new Map<string, number>();
    return markdown.split("\n").map((line) => {
      const count = (occurrences.get(line) ?? 0) + 1;
      occurrences.set(line, count);
      return { line, key: `${line}::${count}` };
    });
  }, [markdown]);

  return (
    <div className="grid h-full gap-4 xl:grid-cols-[minmax(320px,1fr)_minmax(540px,1.6fr)]">
      <AgentChatPanel
        mode="planner"
        conversationId={`planner-${taskId || "none"}`}
        title="Architect Agent"
        subtitle="Co-author specification details before implementation."
      />

      <div className="grid h-full gap-4 xl:grid-cols-[minmax(280px,0.8fr)_minmax(520px,1.4fr)]">
        <Card className="h-full border-slate-200">
          <CardHeader>
            <CardTitle className="text-lg">Template Guardrails</CardTitle>
            <CardDescription>
              Each section includes explicit purpose text and is required before save.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {specTemplateSections.map((section) => {
              const missing = missingHeadings.has(section.heading.toLowerCase());
              return (
                <div
                  key={section.heading}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                >
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                    {missing ? (
                      <CircleDotDashed className="size-4 text-amber-600" />
                    ) : (
                      <CheckCircle2 className="size-4 text-emerald-600" />
                    )}
                    {section.heading}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600">{section.purpose}</p>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card className="h-full">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="text-lg">Specification Workspace</CardTitle>
                <CardDescription>
                  Canonical spec is persisted in the Beads task description.
                </CardDescription>
              </div>
              {validation.valid ? (
                <Badge variant="success">Template complete</Badge>
              ) : (
                <Badge variant="danger">Missing sections</Badge>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <select
                className="h-9 min-w-[260px] rounded-md border border-slate-300 bg-white px-3 text-sm"
                value={taskId}
                onChange={(event) => {
                  const next = event.currentTarget.value;
                  setSearchParams(next ? { task: next } : {});
                }}
              >
                <option value="">Select task</option>
                {tasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.id} - {task.title}
                  </option>
                ))}
              </select>
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

            <div className="min-h-[420px] overflow-y-auto rounded-lg border border-slate-200 bg-white p-4">
              {previewEntries.map(({ line, key }) => {
                const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
                if (headingMatch) {
                  const [, hashes = "", rawTitle = ""] = headingMatch;
                  const level = hashes.length;
                  const title = rawTitle.trim();
                  return (
                    <p
                      key={key}
                      className={
                        level <= 2
                          ? "mt-4 border-b border-slate-200 pb-1 text-base font-semibold text-slate-900 first:mt-0"
                          : "mt-3 text-sm font-semibold text-slate-800"
                      }
                    >
                      {title}
                    </p>
                  );
                }

                if (line.startsWith(">")) {
                  return (
                    <p
                      key={key}
                      className="mt-2 rounded border-l-2 border-sky-300 bg-sky-50 px-3 py-2 text-xs text-slate-600"
                    >
                      {line.replace(/^>\s?/, "")}
                    </p>
                  );
                }

                if (/^[-*]\s+/.test(line)) {
                  return (
                    <p key={key} className="ml-5 list-item list-disc text-sm text-slate-700">
                      {line.replace(/^[-*]\s+/, "")}
                    </p>
                  );
                }

                if (!line.trim()) {
                  return <div key={key} className="h-2" />;
                }

                return (
                  <p key={key} className="mt-2 text-sm leading-relaxed text-slate-700">
                    {line}
                  </p>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
