import { useEffect, useState, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import {
  getSessions,
  getHealth,
  createSession,
  type SessionMetadata,
  type HealthInfo,
} from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Plus, Activity, RefreshCw, Loader2 } from "lucide-react"

function statusColor(status: string) {
  switch (status) {
    case "running":
      return "default"
    case "idle":
      return "secondary"
    case "cancelled":
      return "outline"
    default:
      return "secondary"
  }
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString()
}

function shortId(id: string) {
  return id.slice(0, 8)
}

export default function SessionList() {
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<SessionMetadata[]>([])
  const [health, setHealth] = useState<HealthInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [creating, setCreating] = useState(false)

  // Create session form state
  const [prompt, setPrompt] = useState("")
  const [env, setEnv] = useState("")
  const [repo, setRepo] = useState("")
  const [branch, setBranch] = useState("")

  const refresh = useCallback(async () => {
    try {
      const [s, h] = await Promise.all([getSessions(), getHealth()])
      setSessions(s)
      setHealth(h)
      setError(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(
        msg.includes("Failed to fetch") || msg.includes("NetworkError")
          ? "Cannot connect to Conductor backend (port 4577). Is it running?"
          : msg,
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 5000)
    return () => clearInterval(interval)
  }, [refresh])

  async function handleCreate() {
    if (!prompt.trim() || !env || creating) return

    setCreating(true)
    setError(null)

    try {
      const body: { prompt: string; env: string; repo?: string; branch?: string } = {
        prompt: prompt.trim(),
        env,
      }
      if (repo.trim()) body.repo = repo.trim()
      if (branch.trim()) body.branch = branch.trim()

      const result = await createSession(body)

      setDialogOpen(false)
      setPrompt("")
      setRepo("")
      setBranch("")

      navigate(`/sessions/${result.session_id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl p-6">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Conductor</h1>
            {health && (
              <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-1">
                <Activity className="h-3.5 w-3.5" />
                {health.running_tasks} / {health.concurrency_limit} running
                <span className="mx-1">·</span>
                {health.active_sessions} sessions
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={refresh}>
              <RefreshCw className="h-4 w-4" />
            </Button>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button disabled={!health}>
                  <Plus className="mr-2 h-4 w-4" />
                  New Session
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>Create Session</DialogTitle>
                  <DialogDescription>
                    Start a new Claude Code session.
                  </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4 py-4">
                  <div className="grid gap-2">
                    <label className="text-sm font-medium">
                      Prompt <span className="text-destructive">*</span>
                    </label>
                    <Textarea
                      placeholder="Describe the task..."
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      rows={4}
                    />
                  </div>

                  <div className="grid gap-2">
                    <label className="text-sm font-medium">
                      Environment <span className="text-destructive">*</span>
                    </label>
                    <Select value={env} onValueChange={setEnv}>
                      <SelectTrigger>
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
                  </div>

                  <div className="grid gap-2">
                    <label className="text-sm font-medium">
                      Repository{" "}
                      <span className="text-muted-foreground">(optional)</span>
                    </label>
                    <Input
                      placeholder="https://github.com/user/repo.git"
                      value={repo}
                      onChange={(e) => setRepo(e.target.value)}
                    />
                  </div>

                  {repo.trim() && (
                    <div className="grid gap-2">
                      <label className="text-sm font-medium">
                        Branch{" "}
                        <span className="text-muted-foreground">(optional)</span>
                      </label>
                      <Input
                        placeholder="main"
                        value={branch}
                        onChange={(e) => setBranch(e.target.value)}
                      />
                    </div>
                  )}
                </div>

                {error && (
                  <p className="text-sm text-destructive">{error}</p>
                )}

                <DialogFooter>
                  <Button
                    onClick={handleCreate}
                    disabled={!prompt.trim() || !env || creating}
                  >
                    {creating ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      "Create & Start"
                    )}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Session list */}
        {loading ? (
          <p className="text-muted-foreground text-center py-12">Loading...</p>
        ) : error && !dialogOpen ? (
          <Card className="border-destructive">
            <CardContent className="py-8 text-center">
              <p className="text-destructive font-medium mb-1">Connection Error</p>
              <p className="text-sm text-muted-foreground">{error}</p>
              <Button variant="outline" size="sm" className="mt-4" onClick={refresh}>
                <RefreshCw className="mr-2 h-3.5 w-3.5" />
                Retry
              </Button>
            </CardContent>
          </Card>
        ) : sessions.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No sessions yet. Create one to get started.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-2">
            {sessions
              .sort(
                (a, b) =>
                  new Date(b.created_at).getTime() -
                  new Date(a.created_at).getTime(),
              )
              .map((s) => (
                <Card
                  key={s.session_id}
                  className="cursor-pointer transition-colors hover:bg-muted/50"
                  onClick={() => navigate(`/sessions/${s.session_id}`)}
                >
                  <CardHeader className="py-3 px-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <CardTitle className="text-sm truncate">
                          {s.title || shortId(s.session_id)}
                        </CardTitle>
                        <Badge variant={statusColor(s.status)} className="shrink-0">
                          {s.status === "running" && (
                            <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                          )}
                          {s.status}
                        </Badge>
                        <Badge variant="outline" className="shrink-0">{s.env}</Badge>
                      </div>
                      <CardDescription className="text-xs shrink-0 ml-2">
                        {s.message_count} msgs · {formatTime(s.created_at)}
                      </CardDescription>
                    </div>
                    {s.repo && (
                      <CardDescription className="text-xs mt-1">
                        {s.repo}
                        {s.branch ? ` @ ${s.branch}` : ""}
                      </CardDescription>
                    )}
                  </CardHeader>
                </Card>
              ))}
          </div>
        )}
      </div>
    </div>
  )
}
