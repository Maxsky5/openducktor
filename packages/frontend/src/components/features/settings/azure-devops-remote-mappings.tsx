import { ChevronDown, Plus, Trash2 } from "lucide-react";
import { type ReactElement, useState } from "react";
import { Button } from "@/components/ui/button";
import { CollapsibleContent } from "@/components/ui/collapsible-content";
import { Collapsible } from "@/components/ui/collapsible-root";
import { CollapsibleTrigger } from "@/components/ui/collapsible-trigger";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  type AzureRemoteMappingDraft,
  type AzureRemoteMappingDraftErrors,
  type AzureRemoteMappingDraftField,
} from "./azure-devops-git-provider-form-model";

const EMPTY_REMOTE_MAPPING_ERRORS = {
  remoteName: null,
  fetchUrl: null,
  pushUrls: null,
} satisfies AzureRemoteMappingDraftErrors;

const remoteMappingErrorMessage = (field: AzureRemoteMappingDraftField, error: string): string => {
  if (field === "remoteName")
    return error.includes("different remote name")
      ? "Each remote mapping needs a different name."
      : "Remote name is required.";
  if (field === "fetchUrl") return "Enter a valid fetch URL.";
  return "Enter at least one valid push URL.";
};

type AzureDevOpsRemoteMappingsProps = {
  disabled: boolean;
  drafts: AzureRemoteMappingDraft[];
  errors: AzureRemoteMappingDraftErrors[];
  onChange: (drafts: AzureRemoteMappingDraft[]) => void;
};

export function AzureDevOpsRemoteMappings({
  disabled,
  drafts,
  errors,
  onChange,
}: AzureDevOpsRemoteMappingsProps): ReactElement {
  const [open, setOpen] = useState(() => drafts.length > 0);
  const addMapping = (): void => {
    setOpen(true);
    onChange([
      ...drafts,
      {
        draftId: crypto.randomUUID(),
        remoteName: "",
        fetchUrl: "",
        pushUrls: "",
      },
    ]);
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-t border-border pt-3">
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="h-auto w-full justify-between gap-4 px-0 py-2 text-left hover:bg-transparent"
          disabled={disabled}
        >
          <span className="min-w-0 space-y-1">
            <span className="block text-sm font-medium text-foreground">
              Advanced remote mappings
              {drafts.length > 0 ? ` (${drafts.length})` : ""}
            </span>
            <span className="block text-xs font-normal text-muted-foreground">
              Use this only for an SSH alias or a custom clone URL.
            </span>
          </span>
          <ChevronDown
            className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")}
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="grid gap-3 pt-3">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="justify-self-start"
            disabled={disabled}
            onClick={addMapping}
          >
            <Plus className="size-4" />
            Add mapping
          </Button>
          {drafts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No custom mapping is needed for a standard Azure Repos remote.
            </p>
          ) : null}
          {drafts.map((mapping, index) => (
            <AzureDevOpsRemoteMapping
              key={mapping.draftId}
              disabled={disabled}
              draft={mapping}
              errors={errors[index] ?? EMPTY_REMOTE_MAPPING_ERRORS}
              index={index}
              onChange={(next) =>
                onChange(drafts.map((item, itemIndex) => (itemIndex === index ? next : item)))
              }
              onRemove={() => onChange(drafts.filter((_item, itemIndex) => itemIndex !== index))}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

type AzureDevOpsRemoteMappingProps = {
  disabled: boolean;
  draft: AzureRemoteMappingDraft;
  errors: AzureRemoteMappingDraftErrors;
  index: number;
  onChange: (draft: AzureRemoteMappingDraft) => void;
  onRemove: () => void;
};

function AzureDevOpsRemoteMapping({
  disabled,
  draft,
  errors,
  index,
  onChange,
  onRemove,
}: AzureDevOpsRemoteMappingProps): ReactElement {
  const [touchedFields, setTouchedFields] = useState<Set<AzureRemoteMappingDraftField>>(
    () => new Set(),
  );

  return (
    <div className="grid gap-3 rounded-md border border-border bg-muted/20 p-3">
      <div className="grid gap-3 md:grid-cols-2">
        {(
          [
            ["remoteName", "Remote name"],
            ["fetchUrl", "Fetch URL"],
            ["pushUrls", "Push URLs"],
          ] as const
        ).map(([field, label]) => (
          <div
            key={field}
            className={field === "pushUrls" ? "grid gap-2 md:col-span-2" : "grid gap-2"}
          >
            <Label htmlFor={`repo-azure-mapping-${index}-${field}`}>{label}</Label>
            {field === "pushUrls" ? (
              <Textarea
                id={`repo-azure-mapping-${index}-${field}`}
                value={draft[field]}
                placeholder="One URL per line or comma-separated"
                disabled={disabled}
                aria-invalid={touchedFields.has(field) && errors[field] ? true : undefined}
                aria-describedby={
                  touchedFields.has(field) && errors[field]
                    ? `repo-azure-mapping-${index}-${field}-error`
                    : undefined
                }
                onBlur={() => setTouchedFields((current) => new Set(current).add(field))}
                onChange={(event) => onChange({ ...draft, [field]: event.currentTarget.value })}
              />
            ) : (
              <Input
                id={`repo-azure-mapping-${index}-${field}`}
                value={draft[field]}
                disabled={disabled}
                aria-invalid={touchedFields.has(field) && errors[field] ? true : undefined}
                aria-describedby={
                  touchedFields.has(field) && errors[field]
                    ? `repo-azure-mapping-${index}-${field}-error`
                    : undefined
                }
                onBlur={() => setTouchedFields((current) => new Set(current).add(field))}
                onChange={(event) => onChange({ ...draft, [field]: event.currentTarget.value })}
              />
            )}
            {touchedFields.has(field) && errors[field] ? (
              <p
                id={`repo-azure-mapping-${index}-${field}-error`}
                role="alert"
                className="text-xs text-danger"
              >
                {remoteMappingErrorMessage(field, errors[field])}
              </p>
            ) : null}
          </div>
        ))}
      </div>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="justify-self-start"
        disabled={disabled}
        onClick={onRemove}
      >
        <Trash2 className="size-4" />
        Remove mapping
      </Button>
    </div>
  );
}
