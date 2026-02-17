import { useOutletContext } from "react-router-dom"
import type { AppOutletContext } from "@/layouts/AppLayout"
import { Activity } from "lucide-react"

export default function LandingPage() {
  const { health } = useOutletContext<AppOutletContext>()

  return (
    <div className="flex flex-col items-center justify-center h-full text-center gap-3">
      <h2 className="text-2xl font-bold">Conductor</h2>
      <p className="text-muted-foreground">
        Select a session or create a new one
      </p>
      {health && (
        <p className="text-sm text-muted-foreground flex items-center gap-1.5">
          <Activity className="h-3.5 w-3.5" />
          {health.running_tasks}/{health.concurrency_limit} running
          <span className="mx-0.5">&middot;</span>
          {health.active_sessions} active sessions
        </p>
      )}
    </div>
  )
}
