/**
 * 작은 공용 조각. 모바일 우선 — 터치 영역 44px 이상, 한 열 배치.
 */

import type { ReactNode } from 'react'
import type { ClaimStatus } from '../data'
import type { ValueStatus } from '../engine'
import { CLAIM_STATUS_LABEL, ERROR_ACTION_LABEL, VALUE_STATUS_LABEL, describeError } from '../ui'

export function Card({ title, children, tone = 'default' }: { title?: ReactNode; children: ReactNode; tone?: 'default' | 'warn' | 'info' }) {
  const border = tone === 'warn' ? 'border-amber-300 bg-amber-50' : tone === 'info' ? 'border-sky-200 bg-sky-50' : 'border-dark-200 bg-white'
  return (
    <section className={`rounded-xl border p-4 ${border}`}>
      {title && <h3 className="mb-3 text-sm font-semibold text-dark-800">{title}</h3>}
      {children}
    </section>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-dark-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-dark-500">{hint}</span>}
    </label>
  )
}

export const inputClass = 'h-11 w-full rounded-lg border border-dark-300 px-3 text-base text-dark-900 focus:border-primary-500 focus:outline-none'

export function TimeRange({
  value, onChange, labelStart = '시작', labelEnd = '종료',
}: {
  value?: { start: string; end: string }
  onChange: (v: { start: string; end: string } | undefined) => void
  labelStart?: string
  labelEnd?: string
}) {
  const v = value ?? { start: '', end: '' }
  const set = (patch: Partial<{ start: string; end: string }>) => {
    const next = { ...v, ...patch }
    onChange(next.start === '' && next.end === '' ? undefined : next)
  }
  return (
    <div className="grid grid-cols-2 gap-2">
      <Field label={labelStart}><input type="time" className={inputClass} value={v.start} onChange={(e) => set({ start: e.target.value })} /></Field>
      <Field label={labelEnd}><input type="time" className={inputClass} value={v.end} onChange={(e) => set({ end: e.target.value })} /></Field>
    </div>
  )
}

export function Button({
  children, onClick, kind = 'primary', disabled, type = 'button',
}: { children: ReactNode; onClick?: () => void; kind?: 'primary' | 'secondary' | 'danger' | 'ghost'; disabled?: boolean; type?: 'button' | 'submit' }) {
  const styles = {
    primary: 'bg-primary-500 text-white hover:bg-primary-600 disabled:bg-dark-300',
    secondary: 'border border-dark-300 bg-white text-dark-800 hover:bg-dark-50 disabled:text-dark-400',
    danger: 'border border-red-300 bg-white text-red-700 hover:bg-red-50 disabled:text-dark-400',
    ghost: 'text-dark-600 hover:bg-dark-50 disabled:text-dark-400',
  }[kind]
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`min-h-11 rounded-lg px-4 text-sm font-medium ${styles}`}>
      {children}
    </button>
  )
}

export function StatusPill({ status }: { status: ClaimStatus }) {
  const tone: Record<ClaimStatus, string> = {
    draft: 'bg-dark-100 text-dark-700',
    submitted: 'bg-sky-100 text-sky-800',
    returned: 'bg-amber-100 text-amber-800',
    approved: 'bg-green-100 text-green-800',
    rejected: 'bg-red-100 text-red-800',
    cancelled: 'bg-dark-100 text-dark-500 line-through',
  }
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone[status]}`}>{CLAIM_STATUS_LABEL[status]}</span>
}

export function ValuePill({ status }: { status: ValueStatus }) {
  return status === 'confirmed'
    ? <span className="rounded px-1.5 py-0.5 text-xs font-medium bg-green-100 text-green-800">{VALUE_STATUS_LABEL.confirmed}</span>
    : <span className="rounded px-1.5 py-0.5 text-xs font-medium bg-amber-100 text-amber-900">관리자 확인 필요</span>
}

export function ErrorBanner({ error, onAction, onDismiss }: { error?: { code: string; message: string }; onAction?: (action: 'reload' | 'login') => void; onDismiss?: () => void }) {
  if (!error) return null
  const n = describeError(error.code, error.message)
  const actionLabel = ERROR_ACTION_LABEL[n.action]
  return (
    <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4">
      <p className="font-semibold text-red-800">{n.title}</p>
      <p className="mt-1 text-sm text-red-700">{n.detail}</p>
      <div className="mt-3 flex gap-2">
        {actionLabel && (n.action === 'reload' || n.action === 'login') && (
          <Button kind="secondary" onClick={() => onAction?.(n.action as 'reload' | 'login')}>{actionLabel}</Button>
        )}
        {onDismiss && <Button kind="ghost" onClick={onDismiss}>닫기</Button>}
      </div>
    </div>
  )
}

export function NoticeList({ items, tone = 'info' }: { items: string[]; tone?: 'info' | 'warn' }) {
  if (items.length === 0) return null
  const cls = tone === 'warn' ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-sky-200 bg-sky-50 text-sky-900'
  return (
    <ul className={`space-y-1 rounded-lg border p-3 text-sm ${cls}`}>
      {items.map((t, i) => <li key={i}>• {t}</li>)}
    </ul>
  )
}
