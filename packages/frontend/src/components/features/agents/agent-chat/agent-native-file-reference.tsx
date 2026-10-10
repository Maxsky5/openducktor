import type { AgentNativeFileReference } from "@openducktor/contracts";

export function AgentNativeFileReferenceView({ file }: { file: AgentNativeFileReference }) {
  return (
    <div className="flex flex-col gap-1 text-xs text-foreground">
      <span>
        {file.name ?? "Native file"}
        {file.mime ? ` (${file.mime})` : ""}
      </span>
      {file.uri ? <code className="break-all text-muted-foreground">{file.uri}</code> : null}
      {file.downloadUri ? (
        <a href={file.downloadUri} download={file.name ?? "attachment"} className="underline">
          Download attachment
        </a>
      ) : null}
      {file.unavailableReason ? (
        <p className="text-muted-foreground">{file.unavailableReason}</p>
      ) : null}
    </div>
  );
}
