/**
 * 출장수당 글루 — 기존 앱(인증 컨텍스트·DB 클라이언트)과 출장 모듈(src/features/trip) 사이의 얇은 층.
 * 출장 모듈은 기존 앱을 import 하지 않는다(독립성 테스트). 양쪽을 아는 코드는 이 폴더뿐이다.
 *
 * 두 겹의 스위치
 *  1) 코드 스위치 TRIP_FEATURE (features/trip/ui) — false 면 메뉴를 그리지 않고, 라우트는 안내만 보여 주며 서버를 부르지 않는다.
 *  2) 서버 스위치 trip_feature_flags — 코드 스위치가 켜져도 서버가 꺼져 있으면 조회·쓰기·계산 전부 거부된다.
 *  둘 다 켜야 열린다. 급여 반영(payrollApply)은 어느 쪽에서도 켜지지 않는다.
 */

import type { Employee } from '../../types'
import type { Actor } from '../../features/trip/data'
import { TRIP_FEATURE } from '../../features/trip/ui'

export const TRIP_ROUTES = Object.freeze({ employee: '/trip', admin: '/admin/trip' })

/** 출장 기능의 역할: employees.role 의 admin 만 관리자, manager 는 직원 (api/trip-compute · client 와 같은 규칙) */
export function tripActorOf(employee: Pick<Employee, 'id' | 'role'>): Actor {
  return { id: employee.id, role: employee.role === 'admin' ? 'admin' : 'employee' }
}

export function tripScreenOpen(key: keyof typeof TRIP_FEATURE): boolean {
  // 상수가 literal false 라 직접 비교하면 TS 가 '겹치지 않는 비교' 로 본다 — 런타임 값으로 읽는다
  return Boolean((TRIP_FEATURE as Readonly<Record<string, boolean>>)[key])
}

/** 로컬 날짜(YYYY-MM-DD). 출장 화면은 현재 시각을 직접 읽지 않으므로 글루가 넘겨 준다 */
export function todayIso(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
