import type { WarningLevel } from '../../types'

interface TeamMember {
  name: string
  department: string
  totalHours: number
  warningLevel: WarningLevel
}

interface TeamGaugeListProps {
  members: TeamMember[]
}

const GAUGE_COLOR: Record<WarningLevel, string> = {
  normal: 'bg-success-500',
  caution: 'bg-warning-500',
  warning: 'bg-primary-400',
  exceeded: 'bg-danger-600',
}

const TEXT_COLOR: Record<WarningLevel, string> = {
  normal: 'text-success-600',
  caution: 'text-warning-600',
  warning: 'text-primary-500',
  exceeded: 'text-danger-600',
}

export function TeamGaugeList({ members }: TeamGaugeListProps) {
  const MAX_HOURS = 52

  return (
    <div className="divide-y divide-dark-100">
      {members.map((member) => {
        const pct = Math.min((member.totalHours / MAX_HOURS) * 100, 100)
        const isExceeded = member.warningLevel === 'exceeded'

        return (
          <div
            key={member.name}
            className={`flex items-center gap-3 px-4 py-3 ${isExceeded ? 'bg-danger-50' : ''}`}
          >
            {/* 아바타 */}
            <div className="w-9 h-9 rounded-full bg-primary-100 flex items-center justify-center shrink-0">
              <span className="text-sm font-bold text-primary-700">
                {member.name.charAt(0)}
              </span>
            </div>

            {/* 이름 + 부서 */}
            <div className="w-24 shrink-0">
              <p className="text-sm font-semibold text-dark-900 truncate">{member.name}</p>
              <p className="text-xs text-dark-400 truncate">{member.department}</p>
            </div>

            {/* 게이지 바 */}
            <div className="flex-1 min-w-0">
              <div className="h-2.5 bg-dark-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${GAUGE_COLOR[member.warningLevel]}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              {/* 마커 */}
              <div className="relative h-3">
                {[40, 48, 52].map((h) => (
                  <div
                    key={h}
                    className="absolute top-0 w-px h-2 bg-dark-300"
                    style={{ left: `${(h / MAX_HOURS) * 100}%` }}
                  />
                ))}
              </div>
            </div>

            {/* 시간 */}
            <div className="text-right shrink-0 w-16">
              <span className={`text-sm font-bold ${TEXT_COLOR[member.warningLevel]}`}>
                {member.totalHours.toFixed(1)}h
              </span>
              <p className="text-xs text-dark-400">/ {MAX_HOURS}h</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
