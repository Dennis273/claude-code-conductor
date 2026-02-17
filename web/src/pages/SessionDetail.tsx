import { useEffect, useState, useRef, useCallback } from "react"
import { useParams, useNavigate } from "react-router-dom"
import {
  getSession,
  cancelSession,
  subscribeEvents,
  sendMessage,
  type SessionDetail as SessionDetailType,
  type SSEEvent,
  type Message,
  type ContentBlock,
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
import Markdown from "react-markdown"

export default function SessionDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [session, setSession] = useState<SessionDetailType | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
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

  // On mount: load REST first, then conditionally subscribe to SSE
  useEffect(() => {
    if (!id) return

    const controller = new AbortController()
    abortRef.current = controller

    ;(async () => {
      try {
        const data = await getSession(id)
        setSession(data)

        if (data.status === "running" && data.run_message_offset != null) {
          // Running: show historical messages, SSE takes over for current run
          setMessages(data.messages.slice(0, data.run_message_offset))
          setLoading(false)
          setIsStreaming(true)
          try {
            const events = subscribeEvents(id, controller.signal)
            await consumeStream(events)
          } catch (sseErr) {
            // SSE failed (bus just cleaned up, etc.) — show all REST messages
            if (sseErr instanceof Error && sseErr.name === "AbortError") return
            setMessages(data.messages)
            setIsStreaming(false)
          }
        } else {
          // Completed/cancelled/idle: show all REST messages
          setMessages(data.messages)
          setLoading(false)
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      }
    })()

    return () => {
      controller.abort()
    }
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll when content changes
  useEffect(() => {
    scrollToBottom()
  }, [messages, streamingText, scrollToBottom])

  function appendBlock(role: "user" | "assistant", block: ContentBlock) {
    setMessages((prev) => {
      const next = [...prev]
      const last = next[next.length - 1]

      if (last && last.role === role) {
        next[next.length - 1] = {
          ...last,
          content: [...last.content, block],
        }
      } else {
        next.push({
          role,
          content: [block],
          timestamp: new Date().toISOString(),
        })
      }
      return next
    })
  }

  async function consumeStream(events: AsyncGenerator<SSEEvent>) {
    let accumulated = ""

    try {
      for await (const event of events) {
        switch (event.type) {
          case "session_created":
            setSession((prev) =>
              prev
                ? { ...prev, session_id: event.session_id, workspace: event.workspace, status: "running" }
                : {
                    session_id: event.session_id,
                    workspace: event.workspace,
                    env: "",
                    repo: null,
                    branch: null,
                    status: "running",
                    title: "",
                    created_at: new Date().toISOString(),
                    last_active_at: new Date().toISOString(),
                    message_count: 0,
                    run_message_offset: null,
                    messages: [],
                  },
            )
            break

          case "text_delta":
            accumulated += event.text
            setStreamingText(accumulated)
            break

          case "tool_use": {
            if (accumulated) {
              appendBlock("assistant", { type: "text", text: accumulated })
              accumulated = ""
              setStreamingText("")
            }
            appendBlock("assistant", {
              type: "tool_use",
              id: event.id,
              name: event.tool,
              input: event.input,
            })
            break
          }

          case "tool_result":
            appendBlock("user", {
              type: "tool_result",
              tool_use_id: event.tool_use_id,
              content: event.content,
              is_error: event.is_error,
            })
            break

          case "result":
            if (accumulated) {
              appendBlock("assistant", { type: "text", text: accumulated })
              accumulated = ""
              setStreamingText("")
            }
            if (event.is_error) {
              const errorMsg = event.errors.length > 0
                ? event.errors.join("\n")
                : `Execution stopped: ${event.subtype}`
              setError(errorMsg)
            }
            setSession((prev) => (prev ? { ...prev, status: "idle" } : prev))
            break

          case "raw_message":
            appendBlock("assistant", {
              type: "raw_message",
              message_type: event.message_type,
              raw: event.raw,
            })
            break

          case "error":
            setError(event.message)
            break
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return
      throw err
    } finally {
      if (accumulated) {
        appendBlock("assistant", { type: "text", text: accumulated })
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

    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        content: [{ type: "text", text }],
        timestamp: new Date().toISOString(),
      },
    ])
    setSession((prev) => (prev ? { ...prev, status: "running" } : prev))

    const controller = new AbortController()
    abortRef.current = controller

    try {
      await sendMessage(id, text)
      const events = subscribeEvents(id, controller.signal)
      await consumeStream(events)
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        setError(err.message)
      } else if (!(err instanceof Error)) {
        setError(String(err))
      }
      setIsStreaming(false)
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

  // Build tool_use_id → tool_result map for pairing
  const toolResultMap = new Map<string, { content: string; is_error: boolean }>()
  for (const msg of messages) {
    for (const block of msg.content) {
      if (block.type === "tool_result") {
        toolResultMap.set(block.tool_use_id, {
          content: block.content,
          is_error: block.is_error,
        })
      }
    }
  }

  const lastBlock = messages.at(-1)?.content.at(-1)
  const lastBlockIsToolUse = lastBlock?.type === "tool_use"

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Top bar */}
      <div className="flex items-center gap-3 border-b px-4 py-2.5">
        <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{session.title || id?.slice(0, 8)}</span>
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
          {messages.map((msg, msgIdx) =>
            msg.content.map((block, blockIdx) => {
              const key = `${msgIdx}-${blockIdx}`

              if (block.type === "text") {
                if (msg.role === "user") {
                  return (
                    <div key={key} className="flex justify-end">
                      <div className="max-w-[80%] rounded-lg bg-primary px-3 py-2 text-primary-foreground">
                        <p className="text-sm whitespace-pre-wrap">
                          {block.text}
                        </p>
                      </div>
                    </div>
                  )
                }
                return (
                  <div key={key} className="flex justify-start">
                    <div className="max-w-[80%] rounded-lg bg-muted px-3 py-2 prose prose-sm dark:prose-invert prose-p:my-1 prose-pre:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-headings:my-1 max-w-none">
                      <Markdown>{block.text}</Markdown>
                    </div>
                  </div>
                )
              }

              if (block.type === "tool_use") {
                const result = toolResultMap.get(block.id)
                return (
                  <ToolUseCard
                    key={key}
                    tool={block.name}
                    input={block.input}
                    result={result}
                  />
                )
              }

              if (block.type === "raw_message") {
                return (
                  <RawMessageCard
                    key={key}
                    messageType={block.message_type}
                    raw={block.raw}
                  />
                )
              }

              // tool_result blocks are rendered inline with ToolUseCard via toolResultMap
              return null
            }),
          )}

          {/* Streaming text (current assistant response being built) */}
          {streamingText && (
            <div className="flex justify-start">
              <div className="max-w-[80%] rounded-lg bg-muted px-3 py-2 prose prose-sm dark:prose-invert prose-p:my-1 prose-pre:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-headings:my-1 max-w-none">
                <Markdown>{streamingText}</Markdown>
                <span className="inline-block w-1.5 h-4 bg-foreground/70 animate-pulse ml-0.5 align-text-bottom" />
              </div>
            </div>
          )}

          {/* Streaming indicator when no text yet */}
          {isStreaming && !streamingText && !lastBlockIsToolUse && (
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
        <Card className="hover:bg-muted/50 transition-colors py-0 gap-0">
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

function RawMessageCard({
  messageType,
  raw,
}: {
  messageType: string
  raw: Record<string, unknown>
}) {
  return (
    <Collapsible>
      <CollapsibleTrigger className="w-full">
        <Card className="hover:bg-muted/50 transition-colors py-0 gap-0">
          <CardContent className="flex items-center gap-2 py-2 px-3">
            <span className="h-3.5 w-3.5 rounded-full bg-muted-foreground/30 shrink-0" />
            <span className="text-sm font-medium text-muted-foreground">{messageType}</span>
            <ChevronDown className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
          </CardContent>
        </Card>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-4 mt-1">
          <div className="rounded-md bg-muted/30 p-3">
            <pre className="text-xs overflow-x-auto whitespace-pre-wrap break-all text-muted-foreground">
              {JSON.stringify(raw, null, 2)}
            </pre>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
