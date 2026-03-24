import type { RequestStatus } from '../../types'

interface StatusBadgeProps {
  status: RequestStatus
}

const STATUS_CONFIG: Record<RequestStatus, { label: string; className: string }> = {
  pending: { label: '대기중', className: 'bg-warning-50 text-warning-500 border border-warning-400' },
  manager_approved: { label: '1차 승인', className: 'bg-primary-50 text-primary-600 border border-primary-200' },
  approved: { label: '승인 완료', className: 'bg-success-50 text-success-600 border border-success-400' },
  rejected: { label: '반려', className: 'bg-danger-50 text-danger-600 border border-danger-400' },
  cancelled: { label: '취소', className: 'bg-dark-100 text-dark-500 border border-dark-200' },
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status]
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${config.className}`}>
      {config.label}
    </span>
  )
}
