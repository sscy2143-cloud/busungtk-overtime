import { format, startOfWeek, endOfWeek, isWeekend, parseISO } from 'date-fns'
import { ko } from 'date-fns/locale'

export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? parseISO(date) : date
  return format(d, 'yyyy-MM-dd', { locale: ko })
}

export function formatDateTime(date: string | Date): string {
  const d = typeof date === 'string' ? parseISO(date) : date
  return format(d, 'yyyy-MM-dd HH:mm', { locale: ko })
}

export function formatTime(date: string | Date): string {
  const d = typeof date === 'string' ? parseISO(date) : date
  return format(d, 'HH:mm', { locale: ko })
}

export function formatKoreanDate(date: string | Date): string {
  const d = typeof date === 'string' ? parseISO(date) : date
  return format(d, 'M월 d일 (EEE)', { locale: ko })
}

export function getWeekRange(date: Date) {
  return {
    start: startOfWeek(date, { weekStartsOn: 1 }),
    end: endOfWeek(date, { weekStartsOn: 1 }),
  }
}

export function isHolidayOrWeekend(date: Date): boolean {
  // 주말 체크 (공휴일은 추후 API 연동)
  return isWeekend(date)
}

export function getWeekLabel(date: Date): string {
  const { start, end } = getWeekRange(date)
  return `${format(start, 'M/d')} ~ ${format(end, 'M/d')}`
}
