import { useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { createSession, type SessionMetadata, type HealthInfo } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Plus, Loader2, Activity, ChevronDown, RefreshCw } from "lucide-react"
import SessionItem from "@/components/SessionItem"

export default function Sidebar({
  sessions,
  health,
  sessionsLoading,
  sessionsError,
  onRefresh,
}: {
  sessions: SessionMetadata[]
  health: HealthInfo | null
  sessionsLoading: boolean
  sessionsError: string | null
  onRefresh: () => Promise<void>
}) {
  const navigate = useNavigate()
  const { id: activeSessionId } = useParams<{ id: string }>()

  const [prompt, setPrompt] = useState("")
  const [env, setEnv] = useState("")
  const [repo, setRepo] = useState("")
  const [branch, setBranch] = useState("")
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  async function handleCreate() {
    if (!prompt.trim() || !env || creating) return

    setCreating(true)
    setCreateError(null)

    try {
      const body: { prompt: string; env: string; repo?: string; branch?: string } = {
        prompt: prompt.trim(),
        env,
      }
      if (repo.trim()) body.repo = repo.trim()
      if (branch.trim()) body.branch = branch.trim()

      const result = await createSession(body)

      setPrompt("")
      setRepo("")
      setBranch("")

      navigate(`/sessions/${result.session_id}`)
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }

  const sorted = [...sessions].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  )

  return (
    <aside className="flex h-full w-80 flex-col border-r bg-sidebar text-sidebar-foreground">
      {/* Create form */}
      <div className="border-b p-3 space-y-2">
        <Textarea
          placeholder="Describe the task..."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          className="resize-none text-sm"
        />
        <div className="flex items-center gap-2">
          <Select value={env} onValueChange={setEnv}>
            <SelectTrigger className="flex-1 h-8 text-xs">
              <SelectValue placeholder="Select env" />
            </SelectTrigger>
            <SelectContent>
              {health?.envs.map((e) => (
                <SelectItem key={e} value={e}>
                  {e}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            className="h-8"
            onClick={handleCreate}
            disabled={!prompt.trim() || !env || creating || !health}
          >
            {creating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
          </Button>
        </div>

        <Collapsible>
          <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <ChevronDown className="h-3 w-3" />
            Repository (optional)
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-2 pt-2">
            <Input
              placeholder="https://github.com/user/repo.git"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              className="h-8 text-xs"
            />
            {repo.trim() && (
              <Input
                placeholder="Branch (optional)"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                className="h-8 text-xs"
              />
            )}
          </CollapsibleContent>
        </Collapsible>

        {createError && (
          <p className="text-xs text-destructive">{createError}</p>
        )}
      </div>

      {/* Session list */}
      <ScrollArea className="flex-1">
        <div className="p-1.5 space-y-0.5">
          {sessionsLoading ? (
            <p className="text-xs text-muted-foreground text-center py-8">
              Loading...
            </p>
          ) : sessionsError ? (
            <div className="text-center py-8 space-y-2">
              <p className="text-xs text-destructive">{sessionsError}</p>
              <Button variant="outline" size="sm" onClick={onRefresh}>
                <RefreshCw className="mr-1.5 h-3 w-3" />
                Retry
              </Button>
            </div>
          ) : sorted.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">
              No sessions yet
            </p>
          ) : (
            sorted.map((s) => (
              <SessionItem
                key={s.session_id}
                session={s}
                isActive={s.session_id === activeSessionId}
              />
            ))
          )}
        </div>
      </ScrollArea>

      {/* Health status footer */}
      {health && (
        <div className="border-t px-3 py-2 text-xs text-muted-foreground flex items-center gap-1.5">
          <Activity className="h-3 w-3" />
          {health.running_tasks}/{health.concurrency_limit} running
          <span className="mx-0.5">&middot;</span>
          {health.active_sessions} sessions
        </div>
      )}
    </aside>
  )
}
