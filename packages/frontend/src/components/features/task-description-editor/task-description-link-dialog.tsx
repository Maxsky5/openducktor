import { Link, Save, Unlink } from "lucide-react";
import { type ChangeEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const validateLinkDestination = (href: string): string | null => {
  if (!href) {
    return "Enter a web address.";
  }
  if (/\s/.test(href)) {
    return "Use %20 for spaces in the address, or edit the link in Markdown.";
  }
  try {
    const url = new URL(href);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || !url.hostname) {
      return "Enter a full web address that starts with http:// or https://.";
    }
  } catch {
    return "Enter a full web address that starts with http:// or https://.";
  }
  return null;
};

export function TaskDescriptionLinkDialog({
  href,
  disabled,
  onCancel,
  onRemove,
  onSubmit,
}: {
  href: string;
  disabled: boolean;
  onCancel(): void;
  onRemove(): void;
  onSubmit(href: string): boolean;
}) {
  const [destination, setDestination] = useState(href);
  const [error, setError] = useState<string | null>(null);
  const editing = href.length > 0;

  const save = (): void => {
    if (disabled) return;
    const nextDestination = destination.trim();
    const validationError = validateLinkDestination(nextDestination);
    if (validationError) {
      setError(validationError);
      return;
    }
    if (!onSubmit(nextDestination)) {
      setError("The selected text is no longer available. Select it again and retry.");
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-lg">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <DialogHeader>
            <DialogTitle>{editing ? "Edit link" : "Insert link"}</DialogTitle>
            <DialogDescription>
              Paste a web address that starts with https:// or http://.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="mt-4 flex flex-col gap-2 overflow-visible">
            <Label htmlFor="task-description-link-destination">Web address</Label>
            <Input
              id="task-description-link-destination"
              autoFocus
              disabled={disabled}
              value={destination}
              placeholder="https://example.com/docs"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "task-description-link-error" : undefined}
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                setDestination(event.currentTarget.value);
                setError(null);
              }}
            />
            {error ? (
              <p id="task-description-link-error" className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">Press Enter to save.</p>
          </DialogBody>
          <DialogFooter>
            {editing ? (
              <Button type="button" variant="destructive" disabled={disabled} onClick={onRemove}>
                <Unlink data-icon="inline-start" />
                Remove link
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={disabled}>
              {editing ? <Save data-icon="inline-start" /> : <Link data-icon="inline-start" />}
              {editing ? "Save link" : "Insert link"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
