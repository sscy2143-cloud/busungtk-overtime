import { useMemo, useState, type ReactNode } from 'react'
import {
  createGuardedTripService, createMemoryRepository, createStaticGate, NO_CALENDAR,
  type Actor, type FeatureKey, type HolidayCalendar, type IsoDate, type ServiceDeps, type TripRepository,
} from '../data'
import { fromMemoryService, type TripClientService } from '../client'
import { TripContext, type EmployeeOption } from './context'

export interface TripScreenProviderProps {
  actor: Actor
  employees: (EmployeeOption & { role: Actor['role'] })[]
  today: IsoDate
  /** 검증된 달력을 주입한다. 없으면 모든 날이 관리자 확인 대상(NO_CALENDAR) */
  calendar?: HolidayCalendar
  /** 메모리 시험용 스위치. 실제 연결에서는 서버 값(trip_feature_flags)을 쓴다 */
  flags?: Partial<Record<FeatureKey, boolean>>
  /** 테스트·시연에서 같은 저장소를 여러 화면이 공유할 때 */
  repo?: TripRepository
  /** 실제 연결용(T6): createTripClient 로 만든 서비스를 넣으면 메모리 저장소를 만들지 않는다. 먼저 refresh() 를 끝내 둘 것 */
  service?: TripClientService
  children: ReactNode
}

/** 기본 인자는 모듈 상수로 둔다 — 렌더마다 새 객체가 생기면 useMemo 가 풀려 메모리 저장소가 새로 만들어진다 */
const NO_FLAGS: Partial<Record<FeatureKey, boolean>> = Object.freeze({})

/** 순번 → 같은 날 안의 단조 증가 시각 (정렬·이력용. 실제 시각이 아님) */
function sequentialClock(today: IsoDate, n: number): string {
  const s = n % 86400
  const hh = String(Math.floor(s / 3600)).padStart(2, '0')
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `${today}T${hh}:${mm}:${ss}Z`
}

/**
 * 메모리 저장소 기반 제공자. 기존 앱과 무관하게 화면을 띄워 볼 수 있다.
 * 시간·ID 생성은 결정적(순번)이라 같은 조작이면 같은 결과가 난다.
 */
export function TripScreenProvider(props: TripScreenProviderProps) {
  const { actor, employees, today, calendar = NO_CALENDAR, flags = NO_FLAGS, repo, service, children } = props
  const [revision, setRevision] = useState(0)

  const svc = useMemo<TripClientService>(() => {
    if (service) return service
    let seq = 0
    let tick = 0
    const deps: ServiceDeps = {
      repo: repo ?? createMemoryRepository(),
      calendar,
      now: () => sequentialClock(today, tick++),
      newId: (prefix) => `${prefix}-${++seq}`,
    }
    const directory = Object.fromEntries(employees.map((e) => [e.id, e.role]))
    return fromMemoryService(createGuardedTripService(deps, createStaticGate(flags, directory)), { now: deps.now })
  }, [service, repo, calendar, today, flags, employees])

  const value = useMemo(() => ({
    service: svc,
    actor,
    employees: employees.map(({ id, name }) => ({ id, name })),
    calendar,
    today,
    revision,
    bump: () => setRevision((r) => r + 1),
  }), [svc, actor, employees, calendar, today, revision])

  return <TripContext value={value}>{children}</TripContext>
}
