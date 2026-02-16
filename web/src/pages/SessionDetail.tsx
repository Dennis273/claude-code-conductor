import { useEffect, useState, useRef, useCallback } from "react"
import { useParams, useNavigate } from "react-router-dom"
import {
  getSession,
  cancelSession,
  streamSSE,
  type SessionDetail as SessionDetailType,
  type SSEEvent,
} from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  ArrowLeft,
  Send,
  Square,
  ChevronDown,
  Wrench,
  CircleCheck,
  CircleX,
} from "lucide-react"

type ChatItem =
  | { kind: "user"; content: string; timestamp?: string }
  | { kind: "assistant"; content: string; timestamp?: string }
  | { kind: "tool_use"; tool: string; input: Record<string, unknown> }
  | { kind: "tool_result"; content: string; is_error: boolean }

export default function SessionDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [session, setSession] = useState<SessionDetailType | null>(null)
  const [chatItems, setChatItems] = useState<ChatItem[]>([])
  const [streamingText, setStreamingText] = useState("")
  const [isStreaming, setIsStreaming] = useState(false)
  const [inputText, setInputText] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const scrollRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      const scrollContainer = scrollRef.current.querySelector(
        "[data-radix-scroll-area-viewport]",
      )
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight
      }
    }
  }, [])

  // Load session data
  useEffect(() => {
    if (!id) return

    async function load() {
      try {
        const data = await getSession(id!)
        setSession(data)

        // Convert messages to chat items
        const items: ChatItem[] = data.messages.map((m) => {
          if (m.role === "tool_use") {
            return {
              kind: "tool_use" as const,
              tool: m.tool ?? "unknown",
              input: m.input ?? {},
            }
          }
          if (m.role === "tool_result") {
            return {
              kind: "tool_result" as const,
              content: m.content,
              is_error: m.is_error ?? false,
            }
          }
          return {
            kind: m.role as "user" | "assistant",
            content: m.content,
            timestamp: m.timestamp,
          }
        })
        setChatItems(items)

        // If session is running, it might have been started from elsewhere
        // We can't attach to its stream, but we can show the status
        if (data.status === "running") {
          setIsStreaming(true)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    }

    load()

    return () => {
      abortRef.current?.abort()
    }
  }, [id])

  // Auto-scroll when content changes
  useEffect(() => {
    scrollToBottom()
  }, [chatItems, streamingText, scrollToBottom])

  async function consumeStream(events: AsyncGenerator<SSEEvent>) {
    let accumulated = ""

    try {
      for await (const event of events) {
        switch (event.type) {
          case "session_created":
            // For new sessions, update session info
            setSession((prev) =>
              prev
                ? { ...prev, session_id: event.session_id, status: "running" }
                : prev,
            )
            break

          case "text_delta":
            accumulated += event.text
            setStreamingText(accumulated)
            break

          case "tool_use":
            // If we have accumulated text before this tool_use, flush it
            if (accumulated) {
              setChatItems((prev) => [
                ...prev,
                { kind: "assistant", content: accumulated },
              ])
              accumulated = ""
              setStreamingText("")
            }
            setChatItems((prev) => [
              ...prev,
              { kind: "tool_use", tool: event.tool, input: event.input },
            ])
            break

          case "tool_result":
            setChatItems((prev) => [
              ...prev,
              {
                kind: "tool_result",
                content: event.content,
                is_error: event.is_error,
              },
            ])
            break

          case "result":
            // Final result — the accumulated text is the complete response
            if (accumulated) {
              setChatItems((prev) => [
                ...prev,
                { kind: "assistant", content: accumulated },
              ])
              accumulated = ""
              setStreamingText("")
            }
            setSession((prev) => (prev ? { ...prev, status: "idle" } : prev))
            break

          case "error":
            setError(event.message)
            break
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError(err instanceof Error ? err.message : String(err))
      }
    } finally {
      // If there's remaining accumulated text (e.g., stream ended without result event)
      if (accumulated) {
        setChatItems((prev) => [
          ...prev,
          { kind: "assistant", content: accumulated },
        ])
        setStreamingText("")
      }
      setIsStreaming(false)
      setSession((prev) =>
        prev && prev.status === "running" ? { ...prev, status: "idle" } : prev,
      )
    }
  }

  async function handleSend() {
    if (!inputText.trim() || !id || isStreaming) return

    const text = inputText.trim()
    setInputText("")
    setError(null)
    setIsStreaming(true)
    setStreamingText("")

    // Add user message to chat
    setChatItems((prev) => [...prev, { kind: "user", content: text }])
    setSession((prev) => (prev ? { ...prev, status: "running" } : prev))

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const events = streamSSE(
        `/sessions/${id}/messages`,
        { prompt: text },
        controller.signal,
      )
      await consumeStream(events)
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError(err instanceof Error ? err.message : String(err))
        setIsStreaming(false)
      }
    }
  }

  async function handleCancel() {
    if (!id) return
    try {
      await cancelSession(id)
      abortRef.current?.abort()
      setIsStreaming(false)
      setSession((prev) =>
        prev ? { ...prev, status: "cancelled" } : prev,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      handleSend()
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <p className="text-muted-foreground">
          {error ?? "Session not found"}
        </p>
        <Button variant="outline" onClick={() => navigate("/")}>
          Back to Sessions
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Top bar */}
      <div className="flex items-center gap-3 border-b px-4 py-2.5">
        <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm">{id?.slice(0, 8)}</span>
            <Badge
              variant={
                session.status === "running"
                  ? "default"
                  : session.status === "cancelled"
                    ? "outline"
                    : "secondary"
              }
            >
              {session.status === "running" && (
                <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
              )}
              {session.status}
            </Badge>
            <Badge variant="outline">{session.env}</Badge>
          </div>
          <p className="text-xs text-muted-foreground truncate">
            {session.workspace}
            {session.repo ? ` · ${session.repo}` : ""}
            {session.branch ? ` @ ${session.branch}` : ""}
          </p>
        </div>

        {isStreaming && (
          <Button variant="destructive" size="sm" onClick={handleCancel}>
            <Square className="mr-1 h-3 w-3" />
            Cancel
          </Button>
        )}
      </div>

      {/* Chat area */}
      <ScrollArea className="flex-1" ref={scrollRef}>
        <div className="mx-auto max-w-3xl p-4 space-y-3">
          {chatItems.map((item, i) => {
            if (item.kind === "user") {
              return (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[80%] rounded-lg bg-primary px-3 py-2 text-primary-foreground">
                    <p className="text-sm whitespace-pre-wrap">
                      {item.content}
                    </p>
                  </div>
                </div>
              )
            }

            if (item.kind === "assistant") {
              return (
                <div key={i} className="flex justify-start">
                  <div className="max-w-[80%] rounded-lg bg-muted px-3 py-2">
                    <p className="text-sm whitespace-pre-wrap">
                      {item.content}
                    </p>
                  </div>
                </div>
              )
            }

            if (item.kind === "tool_use") {
              // Look ahead for a matching tool_result
              const next = chatItems[i + 1]
              const result =
                next?.kind === "tool_result" ? next : undefined
              return (
                <ToolUseCard
                  key={i}
                  tool={item.tool}
                  input={item.input}
                  result={result}
                />
              )
            }

            if (item.kind === "tool_result") {
              // Already rendered as part of the preceding tool_use card
              // But render standalone if there's no preceding tool_use (edge case)
              const prev = chatItems[i - 1]
              if (prev?.kind === "tool_use") return null
              return <ToolResultCard key={i} content={item.content} is_error={item.is_error} />
            }

            return null
          })}

          {/* Streaming text (current assistant response being built) */}
          {streamingText && (
            <div className="flex justify-start">
              <div className="max-w-[80%] rounded-lg bg-muted px-3 py-2">
                <p className="text-sm whitespace-pre-wrap">
                  {streamingText}
                  <span className="inline-block w-1.5 h-4 bg-foreground/70 animate-pulse ml-0.5 align-text-bottom" />
                </p>
              </div>
            </div>
          )}

          {/* Streaming indicator when no text yet */}
          {isStreaming && !streamingText && chatItems.at(-1)?.kind !== "tool_use" && (
            <div className="flex justify-start">
              <div className="rounded-lg bg-muted px-3 py-2">
                <div className="flex gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-foreground/40 animate-bounce [animation-delay:0ms]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-foreground/40 animate-bounce [animation-delay:150ms]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-foreground/40 animate-bounce [animation-delay:300ms]" />
                </div>
              </div>
            </div>
          )}

          {error && (
            <Card className="border-destructive">
              <CardContent className="py-2 px-3 text-sm text-destructive">
                {error}
              </CardContent>
            </Card>
          )}
        </div>
      </ScrollArea>

      {/* Input area */}
      <div className="border-t p-4">
        <div className="mx-auto max-w-3xl flex gap-2">
          <Textarea
            placeholder="Send a message... (Enter to send, Shift+Enter for newline)"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={2}
            className="resize-none"
            disabled={isStreaming}
          />
          <Button
            size="icon"
            className="shrink-0 h-auto"
            onClick={handleSend}
            disabled={!inputText.trim() || isStreaming}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}

// --- Tool Cards ---

function ToolUseCard({
  tool,
  input,
  result,
}: {
  tool: string
  input: Record<string, unknown>
  result?: { content: string; is_error: boolean }
}) {
  return (
    <Collapsible>
      <CollapsibleTrigger className="w-full">
        <Card className="hover:bg-muted/50 transition-colors">
          <CardContent className="flex items-center gap-2 py-2 px-3">
            <Wrench className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-sm font-medium">{tool}</span>
            {result && (
              result.is_error
                ? <CircleX className="h-3.5 w-3.5 text-destructive shrink-0" />
                : <CircleCheck className="h-3.5 w-3.5 text-green-600 shrink-0" />
            )}
            <ChevronDown className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
          </CardContent>
        </Card>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-4 mt-1 space-y-1.5">
          <div className="rounded-md bg-muted/30 p-3">
            <p className="text-xs font-medium text-muted-foreground mb-1">Input</p>
            <pre className="text-xs overflow-x-auto whitespace-pre-wrap break-all">
              {JSON.stringify(input, null, 2)}
            </pre>
          </div>
          {result && (
            <div className={`rounded-md p-3 ${result.is_error ? "bg-destructive/10" : "bg-muted/30"}`}>
              <p className="text-xs font-medium text-muted-foreground mb-1">
                {result.is_error ? "Error" : "Output"}
              </p>
              <pre className="text-xs overflow-x-auto whitespace-pre-wrap break-all">
                {result.content || "(empty)"}
              </pre>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function ToolResultCard({
  content,
  is_error,
}: {
  content: string
  is_error: boolean
}) {
  return (
    <div className={`ml-4 rounded-md p-3 ${is_error ? "bg-destructive/10" : "bg-muted/30"}`}>
      <p className="text-xs font-medium text-muted-foreground mb-1">
        {is_error ? "Tool Error" : "Tool Output"}
      </p>
      <pre className="text-xs overflow-x-auto whitespace-pre-wrap break-all">
        {content || "(empty)"}
      </pre>
    </div>
  )
}
