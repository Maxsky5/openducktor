import { Check, Plus, Tag, X } from "lucide-react";
import { type KeyboardEvent, type ReactElement, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type TagSelectorProps = {
  value: string[];
  onChange: (next: string[]) => void;
  suggestions?: string[];
  disabled?: boolean;
  placeholder?: string;
};

const normalizeTag = (label: string): string => label.trim().replace(/\s+/g, "-").toLowerCase();

export function TagSelector({
  value,
  onChange,
  suggestions = [],
  disabled = false,
  placeholder = "Type a label and press Enter",
}: TagSelectorProps): ReactElement {
  const [query, setQuery] = useState("");
  const [isFocused, setIsFocused] = useState(false);

  const selectedSet = useMemo(() => new Set(value), [value]);
  const allSuggestions = useMemo(() => {
    const merged = new Set<string>([...suggestions, ...value]);
    return Array.from(merged).sort((left, right) => left.localeCompare(right));
  }, [suggestions, value]);

  const candidateTag = normalizeTag(query);
  const filteredSuggestions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return allSuggestions.filter((label) => {
      if (selectedSet.has(label)) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      return label.toLowerCase().includes(normalizedQuery);
    });
  }, [allSuggestions, query, selectedSet]);

  const canCreateCandidate =
    candidateTag.length > 0 &&
    !allSuggestions.some((label) => label.toLowerCase() === candidateTag.toLowerCase());
  const shouldShowSuggestions =
    !disabled && isFocused && (filteredSuggestions.length > 0 || canCreateCandidate);

  const addTag = (label: string): void => {
    const normalized = normalizeTag(label);
    if (!normalized || selectedSet.has(normalized)) {
      return;
    }
    onChange([...value, normalized]);
    setQuery("");
  };

  const removeTag = (label: string): void => {
    onChange(value.filter((entry) => entry !== label));
  };

  const selectSuggestion = (label: string): void => {
    addTag(label);
    setIsFocused(true);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (disabled) {
      return;
    }

    if ((event.key === "Enter" || event.key === ",") && candidateTag) {
      event.preventDefault();
      addTag(candidateTag);
      return;
    }

    if (event.key === "Backspace" && query.length === 0 && value.length > 0) {
      event.preventDefault();
      removeTag(value[value.length - 1] ?? "");
    }
  };

  return (
    <div
      className="space-y-2"
      onFocusCapture={() => setIsFocused(true)}
      onBlurCapture={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
          return;
        }
        setIsFocused(false);
      }}
    >
      <div className="rounded-md border border-input bg-card px-2 py-2 shadow-sm focus-within:ring-2 focus-within:ring-ring/40">
        <div className="flex min-h-10 flex-wrap items-center gap-2">
          {value.map((label) => (
            <Badge key={label} variant="secondary" className="gap-1.5 rounded-md px-2 py-1">
              <Tag className="size-3" />
              {label}
              <button
                type="button"
                className="cursor-pointer rounded-sm p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                onClick={() => removeTag(label)}
                aria-label={`Remove label ${label}`}
                disabled={disabled}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}

          <Input
            value={query}
            disabled={disabled}
            placeholder={value.length === 0 ? placeholder : "Add another label"}
            className="h-8 min-w-[12rem] flex-1 border-0 bg-transparent px-1 py-0 shadow-none focus-visible:ring-0"
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
      </div>

      {shouldShowSuggestions ? (
        <div className="rounded-md border border-border bg-popover p-1 shadow-sm">
          {canCreateCandidate ? (
            <button
              type="button"
              className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectSuggestion(candidateTag)}
            >
              <Plus className="size-4 text-primary" />
              Create "{candidateTag}"
            </button>
          ) : null}

          {filteredSuggestions.map((label) => (
            <button
              key={label}
              type="button"
              className={cn(
                "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
              )}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectSuggestion(label)}
            >
              <Check className="size-4 text-primary" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
