import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { Sparkles, User } from "lucide-react";
import { type ReactElement, useMemo, useState } from "react";

type Props = {
  mode: "planner" | "builder";
  conversationId: string;
  title: string;
  subtitle: string;
};

const textParts = (message: UIMessage): string => {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
};

const assistantResponse = (mode: "planner" | "builder", input: string): string => {
  if (mode === "planner") {
    return `Planner acknowledged: ${input}\n\nI will keep the spec aligned with required sections and orchestration constraints.`;
  }
  return `Builder acknowledged: ${input}\n\nI will continue orchestration and surface blockers for approval when needed.`;
};

export function AgentChatPanel({ mode, conversationId, title, subtitle }: Props): ReactElement {
  const [input, setInput] = useState("");
  const { messages, setMessages } = useChat<UIMessage>({
    id: conversationId,
    messages: [],
  });

  const orderedMessages = useMemo(() => [...messages].reverse(), [messages]);

  const sendMessage = (): void => {
    const text = input.trim();
    if (!text) {
      return;
    }

    setMessages((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        role: "user",
        parts: [{ type: "text", text }],
      },
      {
        id: crypto.randomUUID(),
        role: "assistant",
        parts: [{ type: "text", text: assistantResponse(mode, text) }],
      },
    ]);

    setInput("");
  };

  return (
    <Card className="h-full border-slate-200 bg-white/90">
      <CardHeader className="rounded-t-xl border-b border-slate-100 bg-gradient-to-r from-sky-50 via-white to-emerald-50">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Sparkles className="size-4 text-sky-500" />
          {title}
        </CardTitle>
        <CardDescription>{subtitle}</CardDescription>
      </CardHeader>
      <CardContent className="flex h-[calc(100%-5rem)] flex-col gap-4">
        <div className="flex-1 space-y-3 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/80 p-3">
          {orderedMessages.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
              Start the conversation. This panel uses Vercel AI SDK UI message state.
            </div>
          ) : null}
          {orderedMessages.map((message) => {
            const text = textParts(message) || "(non-text message)";
            const isUser = message.role === "user";
            return (
              <article
                key={message.id}
                className={cn(
                  "rounded-lg border px-3 py-2 text-sm shadow-sm animate-rise-in",
                  isUser
                    ? "border-sky-200 bg-sky-50 text-slate-800"
                    : "border-slate-200 bg-white text-slate-700",
                )}
              >
                <header className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {isUser ? <User className="size-3" /> : <Sparkles className="size-3" />}
                  {message.role}
                </header>
                <p className="whitespace-pre-wrap leading-relaxed">{text}</p>
              </article>
            );
          })}
        </div>

        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            sendMessage();
          }}
        >
          <Input
            placeholder={
              mode === "planner" ? "Refine spec details..." : "Give builder instructions..."
            }
            value={input}
            onChange={(event) => setInput(event.currentTarget.value)}
          />
          <Button type="submit">Send</Button>
        </form>
      </CardContent>
    </Card>
  );
}
