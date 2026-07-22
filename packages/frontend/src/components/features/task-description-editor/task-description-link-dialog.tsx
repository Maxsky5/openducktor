import { type ChangeEvent, useState } from "react";
import { defaultUrlTransform } from "react-markdown";
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
    return "Enter a link destination.";
  }
  if (/\s/.test(href)) {
    return "Link destinations cannot contain spaces. Encode the destination or use Markdown mode.";
  }
  if (!defaultUrlTransform(href)) {
    return "Enter a safe web, email, relative, or anchor destination.";
  }
  if (href.startsWith("https://") || href.startsWith("http://")) {
    try {
      const url = new URL(href);
      if (!url.hostname) {
        return "Enter a complete web destination.";
      }
    } catch {
      return "Enter a complete web destination.";
    }
  }
  return null;
};

export function TaskDescriptionLinkDialog({
  href,
  onCancel,
  onRemove,
  onSubmit,
}: {
  href: string;
  onCancel(): void;
  onRemove(): void;
  onSubmit(href: string): boolean;
}) {
  const [destination, setDestination] = useState(href);
  const [error, setError] = useState<string | null>(null);
  const editing = href.length > 0;

  const save = (): void => {
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
              Enter a safe web, email, relative, or anchor destination.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="mt-4 flex flex-col gap-2 overflow-visible">
            <Label htmlFor="task-description-link-destination">Link destination</Label>
            <Input
              id="task-description-link-destination"
              autoFocus
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
              <Button type="button" variant="destructive" onClick={onRemove}>
                Remove link
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit">{editing ? "Save link" : "Insert link"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
