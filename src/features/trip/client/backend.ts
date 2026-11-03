/**
 * 원격 저장소 접근 — 클라이언트가 서버에 대해 하는 일 전부.
 *
 * 이 인터페이스는 DB SDK 를 모른다. 실제 구현(fetch-backend.ts)은 PostgREST + Vercel 함수를 fetch 로 부르고,
 * 테스트는 가짜 구현으로 RPC 의 규칙(기능 스위치·역할·본인 건·version/revision)을 흉내 낸다.
 *
 * 원칙 (계약-서버계산.md 0절)
 *  - 보내는 것은 입력 원본(header, entries, 사유, 확인 표시)뿐. 계산 결과·규칙 버전·역할은 보내지 않는다.
 *  - 모든 호출은 세션 사용자의 JWT 로 간다. anon 키만으로는 어떤 표도 읽을 수 없다(RLS).
 */

import type { Result } from '../data'

export interface SelectQuery {
  /** 비우면 * */
  columns?: string[]
  /** 동등 조건. 배열이면 in */
  filter?: Record<string, string | boolean | string[]>
  /** 예: 'seq.asc' */
  order?: string
}

export interface TripBackend {
  /** 세션 사용자 id (auth.uid). 로그인돼 있지 않으면 null */
  sessionUserId(): Promise<string | null>
  /** RLS 가 적용된 표 조회 */
  select<T>(table: string, query?: SelectQuery): Promise<Result<T[]>>
  /** 공개 RPC (authenticated). 예외 코드는 Result.code 로 온다 */
  rpc<T>(fn: string, args?: Record<string, unknown>): Promise<Result<T>>
  /** POST /api/trip-compute { claimId } */
  compute(claimId: string): Promise<Result<{ claimId: string; ruleVersion: string; calcIds: Record<string, string>; reviewCodes: Record<string, string[]> }>>
}

export const fail = <T,>(code: string, message: string): Result<T> => ({ ok: false, code, message })
export const ok = <T,>(value: T): Result<T> => ({ ok: true, value })
