import { useNavigate } from "react-router-dom"
import type { SessionMetadata } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

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

export default function SessionItem({
  session,
  isActive,
}: {
  session: SessionMetadata
  isActive: boolean
}) {
  const navigate = useNavigate()

  return (
    <div
      className={cn(
        "px-3 py-2 cursor-pointer rounded-md hover:bg-sidebar-accent/50 transition-colors",
        isActive && "bg-sidebar-accent",
      )}
      onClick={() => navigate(`/sessions/${session.session_id}`)}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-sm truncate flex-1">
          {session.title || shortId(session.session_id)}
        </span>
        <Badge variant={statusColor(session.status)} className="shrink-0 text-[10px] px-1.5 py-0">
          {session.status === "running" && (
            <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
          )}
          {session.status}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground truncate mt-0.5">
        {session.env}
        {session.repo ? ` · ${session.repo}` : ""}
        {session.branch ? ` @ ${session.branch}` : ""}
        {" · "}
        {formatTime(session.created_at)}
        {" · "}
        {session.message_count} msgs
      </p>
    </div>
  )
}
