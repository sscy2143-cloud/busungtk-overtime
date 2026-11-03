import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Actor, HolidayCalendar, IsoDate, Result } from '../data'
import { createFetchBackend, createTripClient, type SyncInfo, type TripClientService } from '../client'
import { TripScreenProvider } from './TripScreenProvider'
import type { EmployeeOption } from './context'
import { Card, ErrorBanner, NoticeList } from './parts'

export interface TripRemoteProviderProps {
  /** 기존 앱의 DB REST 기본 주소·anon 키 (둘 다 공개값). 서비스 롤 키는 받지 않는다 */
  baseUrl: string
  anonKey: string
  /** 현재 세션의 access_token. 기존 앱의 세션에서 꺼내 준다 */
  getAccessToken: () => Promise<string | null>
  /** 세션 사용자 — 역할은 서버 값으로 다시 확인된다 */
  actor: Actor
  employees: (EmployeeOption & { role: Actor['role'] })[]
  today: IsoDate
  calendar: HolidayCalendar
  /** 기본 '/api/trip-compute' */
  computeUrl?: string
  children: ReactNode
}

type Load = { kind: 'loading' } | { kind: 'ready'; info: SyncInfo } | { kind: 'failed'; code: string; message: string }

/**
 * T7 글루용 제공자 — 기존 앱은 이 컴포넌트에 주소·키·토큰 함수·사용자만 넘기면 된다.
 * 처음 한 번 refresh() 가 끝날 때까지 안내만 보여 주고, 끝나면 TripScreenProvider 에 원격 서비스를 넣는다.
 * 스위치가 꺼져 있으면 refresh 는 성공하되 자료가 없고, 화면은 각자 "아직 열리지 않았습니다" 를 보여 준다.
 */
export function TripRemoteProvider(props: TripRemoteProviderProps) {
  const { baseUrl, anonKey, getAccessToken, computeUrl, actor, employees, today, calendar, children } = props
  const service = useMemo<TripClientService>(
    () => createTripClient(createFetchBackend({ baseUrl, anonKey, getAccessToken, computeUrl }), { calendar }),
    [baseUrl, anonKey, getAccessToken, computeUrl, calendar],
  )
  const [attempt, setAttempt] = useState(0)
  // 동기화 결과는 (서비스, 시도 번호)에 묶는다. 키가 다르면 아직 불러오는 중이다 — 효과 안에서 상태를 미리 바꾸지 않는다
  const [done, setDone] = useState<{ service: TripClientService; attempt: number; load: Load } | null>(null)
  const load: Load = done && done.service === service && done.attempt === attempt ? done.load : { kind: 'loading' }

  useEffect(() => {
    let alive = true
    void service.refresh().then((r: Result<SyncInfo>) => {
      if (!alive) return
      setDone({ service, attempt, load: r.ok ? { kind: 'ready', info: r.value } : { kind: 'failed', code: r.code, message: r.message } })
    })
    return () => { alive = false }
  }, [service, attempt])

  if (load.kind === 'loading') {
    return <div className="mx-auto max-w-lg px-4 pt-4"><Card title="출장 신청"><NoticeList items={['불러오는 중…']} /></Card></div>
  }
  if (load.kind === 'failed') {
    return (
      <div className="mx-auto max-w-lg px-4 pt-4">
        <ErrorBanner error={{ code: load.code, message: load.message }} onAction={(a) => (a === 'reload' ? setAttempt((n) => n + 1) : undefined)} />
      </div>
    )
  }
  return (
    <TripScreenProvider actor={actor} employees={employees} today={today} calendar={calendar} service={service}>
      {children}
    </TripScreenProvider>
  )
}
