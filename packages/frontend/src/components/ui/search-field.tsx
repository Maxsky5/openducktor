import { Search, X } from "lucide-react";
import { type ReactElement, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type SearchFieldProps = {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  disabled?: boolean;
  onValueChange: (value: string) => void;
};

export function SearchField({
  id,
  label,
  value,
  placeholder,
  disabled = false,
  onValueChange,
}: SearchFieldProps): ReactElement {
  const input = useRef<HTMLInputElement>(null);

  return (
    <>
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          ref={input}
          id={id}
          className="pl-9 pr-10"
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
            className="absolute right-0 top-0 size-9"
            aria-label="Clear search"
            disabled={disabled}
            onClick={() => {
              onValueChange("");
              input.current?.focus();
            }}
          >
            <X className="size-4" />
          </Button>
        ) : null}
      </div>
    </>
  );
}
