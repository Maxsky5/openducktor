import type { ReactElement } from "react";
import type { TaskDocumentState } from "@/components/features/task-details/use-task-documents";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";
import type { AgentPermissionRequest } from "@/types/agent-orchestrator";

type PermissionReply = "once" | "always" | "reject";

const formatDocumentUpdatedAt = (iso: string | null): string | null => {
  if (!iso) {
    return null;
  }
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) {
    return null;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
};

const hasLabeledCodeFence = (markdown: string): boolean => {
  return markdown.includes("```") && /```[a-z0-9_-]+/i.test(markdown);
};

function DocumentSection({
  title,
  document,
  emptyState,
}: {
  title: string;
  document: TaskDocumentState;
  emptyState: string;
}): ReactElement {
  return (
    <details className="rounded-lg border border-slate-200 bg-white" open>
      <summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
        <span>{title}</span>
        <span className="text-[11px] normal-case text-slate-500">
          {formatDocumentUpdatedAt(document.updatedAt) ?? "Not set"}
        </span>
      </summary>
      <div className="border-t border-slate-200 p-3">
        {document.markdown.trim().length > 0 ? (
          <MarkdownRenderer
            markdown={document.markdown}
            variant="document"
            premiumCodeBlocks={hasLabeledCodeFence(document.markdown)}
          />
        ) : (
          <p className="text-sm text-slate-500">{emptyState}</p>
        )}
      </div>
    </details>
  );
}

function PermissionRequestCard({
  request,
  isSubmitting,
  errorMessage,
  disabled,
  onReplyPermission,
}: {
  request: AgentPermissionRequest;
  isSubmitting: boolean;
  errorMessage: string | undefined;
  disabled: boolean;
  onReplyPermission: (requestId: string, reply: PermissionReply) => void;
}): ReactElement {
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-sm font-medium text-slate-800">{request.permission}</p>
      <p className="text-xs text-slate-600">{request.patterns.join(", ") || "No pattern"}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={disabled || isSubmitting}
          onClick={() => {
            onReplyPermission(request.requestId, "once");
          }}
        >
          Allow Once
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || isSubmitting}
          onClick={() => {
            onReplyPermission(request.requestId, "always");
          }}
        >
          Always Allow
        </Button>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          disabled={disabled || isSubmitting}
          onClick={() => {
            onReplyPermission(request.requestId, "reject");
          }}
        >
          Reject
        </Button>
      </div>
      {errorMessage ? <p className="text-xs text-red-600">{errorMessage}</p> : null}
    </div>
  );
}

export type AgentStudioWorkspaceSidebarModel = {
  agentStudioReady: boolean;
  pendingPermissions: AgentPermissionRequest[];
  isSubmittingPermissionByRequestId: Record<string, boolean>;
  permissionReplyErrorByRequestId: Record<string, string>;
  onReplyPermission: (requestId: string, reply: PermissionReply) => void;
  specDoc: TaskDocumentState;
  planDoc: TaskDocumentState;
  qaDoc: TaskDocumentState;
};

export function AgentStudioWorkspaceSidebar({
  model,
}: {
  model: AgentStudioWorkspaceSidebarModel;
}): ReactElement {
  return (
    <div className="grid h-full min-h-0 content-start gap-4 overflow-y-auto pr-1">
      <Card className="overflow-hidden border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">Permission Requests</CardTitle>
          <CardDescription>Resolve runtime permission prompts for this session.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {model.pendingPermissions.length ? null : (
            <p className="text-sm text-slate-500">No pending permission requests.</p>
          )}
          {model.pendingPermissions.map((request) => (
            <PermissionRequestCard
              key={request.requestId}
              request={request}
              isSubmitting={model.isSubmittingPermissionByRequestId[request.requestId] ?? false}
              errorMessage={model.permissionReplyErrorByRequestId[request.requestId]}
              disabled={!model.agentStudioReady}
              onReplyPermission={model.onReplyPermission}
            />
          ))}
        </CardContent>
      </Card>

      <Card className="min-h-0 overflow-hidden border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">Documents</CardTitle>
          <CardDescription>Live task artifacts for the selected task.</CardDescription>
        </CardHeader>
        <CardContent className="max-h-[40vh] space-y-3 overflow-y-auto">
          <DocumentSection
            title="Spec"
            document={model.specDoc}
            emptyState="No spec document yet."
          />
          <DocumentSection
            title="Implementation Plan"
            document={model.planDoc}
            emptyState="No implementation plan yet."
          />
          <DocumentSection
            title="QA Report"
            document={model.qaDoc}
            emptyState="No QA report yet."
          />
        </CardContent>
      </Card>
    </div>
  );
}
