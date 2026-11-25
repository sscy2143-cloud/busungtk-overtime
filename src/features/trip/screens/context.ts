/**
 * 화면이 쓰는 서비스·사용자·달력. 기존 앱의 인증 컨텍스트·DB 클라이언트를 쓰지 않고 바깥에서 주입받는다.
 * 실제 연결(T6)에서는 client/createTripClient 로 만든 TripClientService 를 넣는다.
 */

import { createContext, useContext } from 'react'
import type { Actor, HolidayCalendar, IsoDate } from '../data'
import type { TripClientService } from '../client'

export interface EmployeeOption {
  id: string
  name: string
}

export interface TripScreenContext {
  /** 읽기는 동기(거울 저장소), 쓰기는 비동기(서버 RPC). 메모리·원격 구현이 같은 모양 */
  service: TripClientService
  /** 세션 사용자. 역할은 서버가 다시 확인한다 */
  actor: Actor
  employees: EmployeeOption[]
  calendar: HolidayCalendar
  /** 오늘 (화면은 현재 시각을 직접 읽지 않는다) */
  today: IsoDate
  /** 화면 상태가 바뀌어 다시 그려야 할 때 — 메모리 저장소는 변경 알림이 없으므로 호출자가 올린다 */
  revision: number
  bump: () => void
  /** 계산 근거(표준 이동 구간·자정 넘김 판단)를 신청 화면에서도 보여 줄지 — 대표·인사담당만 true (화면 표시용, 권한 아님) */
  showCalcDetails: boolean
}

export const TripContext = createContext<TripScreenContext | null>(null)

export function useTrip(): TripScreenContext {
  const ctx = useContext(TripContext)
  if (!ctx) throw new Error('TripScreenProvider 안에서만 쓸 수 있습니다')
  return ctx
}

export const employeeName = (employees: EmployeeOption[], id: string): string => employees.find((e) => e.id === id)?.name ?? id
