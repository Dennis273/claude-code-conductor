import { useEffect, useState, useCallback } from "react"
import { Outlet } from "react-router-dom"
import {
  getSessions,
  getHealth,
  type SessionMetadata,
  type HealthInfo,
} from "@/lib/api"
import Sidebar from "@/components/Sidebar"

export interface AppOutletContext {
  sessions: SessionMetadata[]
  health: HealthInfo | null
  sessionsLoading: boolean
  sessionsError: string | null
  refreshSessions: () => Promise<void>
}

export default function AppLayout() {
  const [sessions, setSessions] = useState<SessionMetadata[]>([])
  const [health, setHealth] = useState<HealthInfo | null>(null)
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [sessionsError, setSessionsError] = useState<string | null>(null)

  const refreshSessions = useCallback(async () => {
    try {
      const [s, h] = await Promise.all([getSessions(), getHealth()])
      setSessions(s)
      setHealth(h)
      setSessionsError(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setSessionsError(
        msg.includes("Failed to fetch") || msg.includes("NetworkError")
          ? "Cannot connect to Conductor backend (port 4577). Is it running?"
          : msg,
      )
    } finally {
      setSessionsLoading(false)
    }
  }, [])

  useEffect(() => {
    refreshSessions()
    const interval = setInterval(refreshSessions, 5000)
    return () => clearInterval(interval)
  }, [refreshSessions])

  return (
    <div className="flex h-screen">
      <Sidebar
        sessions={sessions}
        health={health}
        sessionsLoading={sessionsLoading}
        sessionsError={sessionsError}
        onRefresh={refreshSessions}
      />
      <main className="flex-1 min-w-0">
        <Outlet
          context={
            {
              sessions,
              health,
              sessionsLoading,
              sessionsError,
              refreshSessions,
            } satisfies AppOutletContext
          }
        />
      </main>
    </div>
  )
}
