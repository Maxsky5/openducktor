import { Search, X } from "lucide-react";
import { type ComponentProps, type ReactElement, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type SearchFieldProps = {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  disabled?: boolean;
  onValueChange: (value: string) => void;
};

/** A search field with a visible label, for dialogs and forms. */
export function SearchField({
  id,
  label,
  value,
  placeholder,
  disabled = false,
  onValueChange,
}: SearchFieldProps): ReactElement {
  return (
    <>
      <Label htmlFor={id}>{label}</Label>
      <SearchInput
        id={id}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        classes={DEFAULT_CLASSES}
        onValueChange={onValueChange}
      />
    </>
  );
}

type CompactSearchFieldProps = Omit<SearchFieldProps, "disabled">;

/**
 * A small search field that filters a list, for toolbars and panels. Its label is for screen readers only.
 * Escape clears the text and stops the event from bubbling.
 * A Radix dialog still closes, because it gets Escape first in the capture phase.
 */
export function CompactSearchField({
  id,
  label,
  value,
  placeholder,
  onValueChange,
}: CompactSearchFieldProps): ReactElement {
  return (
    <>
      <Label htmlFor={id} className="sr-only">
        {label}
      </Label>
      <SearchInput
        id={id}
        value={value}
        placeholder={placeholder}
        classes={COMPACT_CLASSES}
        autoComplete="off"
        spellCheck={false}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || value === "") {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          onValueChange("");
        }}
        onValueChange={onValueChange}
      />
    </>
  );
}

type SearchInputClasses = {
  searchIcon: string;
  input: string;
  clearButton: string;
  clearIcon: string;
};

const DEFAULT_CLASSES: SearchInputClasses = {
  searchIcon: "left-3 size-4",
  input: "pl-9 pr-10",
  clearButton: "top-0 right-0 size-9",
  clearIcon: "size-4",
};

const COMPACT_CLASSES: SearchInputClasses = {
  searchIcon: "left-2 size-3.5",
  input: "h-7 px-7 text-xs",
  clearButton: "top-1/2 right-0.5 size-6 -translate-y-1/2 text-muted-foreground",
  clearIcon: "size-3.5",
};

type SearchInputProps = Pick<ComponentProps<"input">, "autoComplete" | "spellCheck" | "onKeyDown"> &
  Omit<SearchFieldProps, "label"> & { classes: SearchInputClasses };

/** The input, the search icon, and the clear button that both search fields share. */
function SearchInput({
  id,
  value,
  placeholder,
  disabled = false,
  classes,
  onValueChange,
  ...inputProps
}: SearchInputProps): ReactElement {
  const input = useRef<HTMLInputElement>(null);

  return (
    <div className="relative">
      <Search
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground",
          classes.searchIcon,
        )}
      />
      <Input
        {...inputProps}
        ref={input}
        id={id}
        className={classes.input}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => onValueChange(event.target.value)}
      />
      {value ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn("absolute", classes.clearButton)}
          aria-label="Clear search"
          disabled={disabled}
          onClick={() => {
            onValueChange("");
            input.current?.focus();
          }}
        >
          <X className={classes.clearIcon} />
        </Button>
      ) : null}
    </div>
  );
}
