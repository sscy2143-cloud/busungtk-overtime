interface WeeklyGaugeProps {
  currentHours: number
  maxHours?: number
}

export function WeeklyGauge({ currentHours, maxHours = 52 }: WeeklyGaugeProps) {
  const pct = Math.min((currentHours / maxHours) * 100, 100)

  const barColor =
    currentHours >= 48
      ? 'bg-danger-500'
      : currentHours >= 40
        ? 'bg-warning-500'
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

  const extraHours = Math.max(currentHours - 40, 0)

  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
      <div className="flex items-baseline gap-1 mb-3">
        <span className="text-3xl font-bold text-gray-900">{currentHours.toFixed(1)}</span>
        <span className="text-sm text-gray-400">h / {maxHours}h</span>
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
          {marker(40, '40h')}
          {marker(48, '48h')}
          {marker(52, '52h')}
        </div>
      </div>

      {/* 요약 텍스트 */}
      <p className="text-xs text-gray-500 mt-4">
        정규 <span className="font-semibold text-gray-700">40h</span>
        {' '}+{' '}연장{' '}
        <span className="font-semibold text-gray-700">{extraHours.toFixed(1)}h</span>
        {' '}={' '}총{' '}
        <span className={`font-bold ${barColor.replace('bg-', 'text-')}`}>
          {currentHours.toFixed(1)}h
        </span>
      </p>
    </div>
  )
}
