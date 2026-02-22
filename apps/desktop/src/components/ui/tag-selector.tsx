import { Check, Plus, Tag, X } from "lucide-react";
import { type ReactElement, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  placeholder = "Search or create label",
}: TagSelectorProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selectedSet = useMemo(() => new Set(value), [value]);
  const allSuggestions = useMemo(() => {
    const merged = new Set<string>([...suggestions, ...value]);
    return Array.from(merged).sort((left, right) => left.localeCompare(right));
  }, [suggestions, value]);

  const filteredSuggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return allSuggestions;
    }
    return allSuggestions.filter((entry) => entry.toLowerCase().includes(q));
  }, [allSuggestions, query]);

  const candidateTag = normalizeTag(query);
  const canCreateCandidate =
    candidateTag.length > 0 &&
    !allSuggestions.some((entry) => entry.toLowerCase() === candidateTag.toLowerCase());

  const addTag = (label: string): void => {
    const normalized = normalizeTag(label);
    if (!normalized) {
      return;
    }
    if (selectedSet.has(normalized)) {
      return;
    }
    onChange([...value, normalized]);
    setQuery("");
  };

  const removeTag = (label: string): void => {
    onChange(value.filter((entry) => entry !== label));
  };

  const toggleTag = (label: string): void => {
    if (selectedSet.has(label)) {
      removeTag(label);
      return;
    }
    addTag(label);
  };

  return (
    <div className="space-y-2">
      <div className="flex min-h-10 flex-wrap items-center gap-2 rounded-md border border-slate-300 bg-white px-2 py-2">
        {value.length > 0 ? (
          value.map((label) => (
            <Badge key={label} variant="secondary" className="gap-1.5 rounded-md px-2 py-1">
              <Tag className="size-3" />
              {label}
              <button
                type="button"
                className="cursor-pointer rounded-sm p-0.5 text-slate-500 hover:bg-slate-200 hover:text-slate-800"
                onClick={() => removeTag(label)}
                aria-label={`Remove label ${label}`}
                disabled={disabled}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))
        ) : (
          <p className="px-1 text-sm text-slate-500">No labels selected</p>
        )}
      </div>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            className="h-9 w-full cursor-pointer justify-start"
          >
            <Plus className="size-4" />
            Add labels
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
          <Command>
            <CommandInput
              placeholder={placeholder}
              value={query}
              onValueChange={(nextValue) => setQuery(nextValue)}
            />
            <CommandList>
              <CommandEmpty>No labels found.</CommandEmpty>
              <CommandGroup>
                {canCreateCandidate ? (
                  <CommandItem
                    value={`create ${candidateTag}`}
                    onSelect={() => {
                      addTag(candidateTag);
                    }}
                  >
                    <Plus className="size-4 text-sky-600" />
                    Create "{candidateTag}"
                  </CommandItem>
                ) : null}
                {filteredSuggestions.map((label) => (
                  <CommandItem key={label} value={label} onSelect={() => toggleTag(label)}>
                    <Check
                      className={cn(
                        "size-4 text-sky-600 transition-opacity",
                        selectedSet.has(label) ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span>{label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
