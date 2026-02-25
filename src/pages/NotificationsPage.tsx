import { useState } from 'react'
import { Bell, CheckCheck, Clock, CalendarCheck, AlertTriangle, UserCheck } from 'lucide-react'
import type { Notification } from '../types'

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '방금 전'
  if (mins < 60) return `${mins}분 전`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}시간 전`
  const days = Math.floor(hours / 24)
  return `${days}일 전`
}

const ICON_MAP: Record<string, React.ReactNode> = {
  overtime_approved: <CheckCheck className="w-5 h-5 text-success-600" />,
  overtime_rejected: <Clock className="w-5 h-5 text-danger-500" />,
  leave_approved: <CalendarCheck className="w-5 h-5 text-primary-600" />,
  weekly_warning: <AlertTriangle className="w-5 h-5 text-warning-500" />,
  approval_request: <UserCheck className="w-5 h-5 text-purple-600" />,
}

const BG_MAP: Record<string, string> = {
  overtime_approved: 'bg-success-50',
  overtime_rejected: 'bg-danger-50',
  leave_approved: 'bg-primary-50',
  weekly_warning: 'bg-warning-50',
  approval_request: 'bg-purple-50',
}

export function NotificationsPage() {
  const [notifications, setNotifications] = useState<(Notification & { icon_type: string })[]>([])

  const unreadCount = notifications.filter((n) => !n.is_read).length

  function markRead(id: string) {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)),
    )
  }

  function markAllRead() {
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })))
  }

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold text-gray-900">알림</h1>
          {unreadCount > 0 && (
            <span className="inline-flex items-center justify-center w-5 h-5 text-xs font-bold bg-primary-600 text-white rounded-full">
              {unreadCount}
            </span>
          )}
        </div>
        {unreadCount > 0 && (
          <button
            onClick={markAllRead}
            className="flex items-center gap-1 text-xs text-primary-600 font-medium hover:text-primary-700"
          >
            <CheckCheck className="w-3.5 h-3.5" />
            모두 읽음
          </button>
        )}
      </div>

      {/* 알림 목록 */}
      <div className="space-y-2">
        {notifications.map((notif) => (
          <button
            key={notif.id}
            onClick={() => markRead(notif.id)}
            className={`w-full text-left rounded-2xl border shadow-sm p-4 flex items-start gap-3 transition-colors ${
              !notif.is_read
                ? 'bg-primary-50 border-primary-100'
                : 'bg-white border-gray-100'
            }`}
          >
            {/* 미읽음 점 */}
            <div className="relative shrink-0 mt-0.5">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${BG_MAP[notif.icon_type] ?? 'bg-gray-100'}`}>
                {ICON_MAP[notif.icon_type] ?? <Bell className="w-5 h-5 text-gray-500" />}
              </div>
              {!notif.is_read && (
                <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-primary-600 rounded-full border-2 border-white" />
              )}
            </div>

            {/* 내용 */}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <p className={`text-sm font-semibold ${!notif.is_read ? 'text-gray-900' : 'text-gray-700'}`}>
                  {notif.title}
                </p>
                <span className="text-xs text-gray-400 shrink-0 mt-0.5">
                  {timeAgo(notif.created_at)}
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-0.5 leading-relaxed line-clamp-2">
                {notif.body}
              </p>
            </div>
          </button>
        ))}

        {notifications.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <Bell className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">새로운 알림이 없습니다</p>
          </div>
        )}
      </div>
    </div>
  )
}
