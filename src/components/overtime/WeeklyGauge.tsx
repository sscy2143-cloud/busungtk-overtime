interface WeeklyGaugeProps {
  currentHours: number
  maxHours?: number
}

export function WeeklyGauge({ currentHours, maxHours = 12 }: WeeklyGaugeProps) {
  const pct = Math.min((currentHours / maxHours) * 100, 100)

  const barColor =
    currentHours >= 12
      ? 'bg-danger-500'
      : currentHours >= 10
        ? 'bg-warning-500'
        : currentHours >= 8
          ? 'bg-warning-400'
          : 'bg-success-500'

  const marker = (h: number, label: string) => {
    const left = (h / maxHours) * 100
    return (
      <div
        key={h}
        className="absolute top-0 flex flex-col items-center"
        style={{ left: `${left}%`, transform: 'translateX(-50%)' }}
      >
        <div className="h-4 w-px bg-gray-400" />
        <span className="text-xs text-gray-400 mt-0.5 whitespace-nowrap">{label}</span>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
      <div className="flex items-baseline gap-1 mb-3">
        <span className="text-3xl font-bold text-gray-900">{currentHours.toFixed(1)}</span>
        <span className="text-sm text-gray-400">h / {maxHours}h (주간 연장)</span>
      </div>

      {/* 프로그레스 바 */}
      <div className="relative mb-6">
        <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${barColor}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        {/* 마커 */}
        <div className="relative mt-0">
          {marker(8, '8h')}
          {marker(10, '10h')}
          {marker(12, '12h')}
        </div>
      </div>

      {/* 요약 텍스트 */}
      <p className="text-xs text-gray-500 mt-4">
        이번 주 연장근무{' '}
        <span className={`font-bold ${barColor.replace('bg-', 'text-')}`}>
          {currentHours.toFixed(1)}h
        </span>
        {currentHours >= 12 && <span className="text-danger-500 ml-1">(한도 초과)</span>}
      </p>
    </div>
  )
}
