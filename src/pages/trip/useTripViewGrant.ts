import { useEffect, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { isDemoMode, supabase } from '../../lib/supabase'
import { tripScreenOpen } from './trip-glue'

/**
 * 세션 사용자에게 "전체 출장 내역 조회" 권한(trip_view_grants, admin 지정)이 있는지 — 메뉴 표시용.
 * RLS 가 본인 행만 돌려주므로 결과는 서버 값이다. 차단은 서버(RLS·RPC)가 하고, 여기서는 메뉴를 그릴지만 정한다.
 * 코드 스위치가 꺼져 있거나 admin 이면 조회하지 않는다 (admin 은 권한 없이도 전체를 본다).
 */
export function useTripViewGrant(): boolean {
  const { employee } = useAuth()
  const [granted, setGranted] = useState(false)
  const id = employee?.id
  const role = employee?.role

  useEffect(() => {
    if (isDemoMode || !id || role === 'admin' || !tripScreenOpen('adminReview')) return
    let alive = true
    supabase.from('trip_view_grants').select('employee_id').eq('employee_id', id).maybeSingle()
      .then(({ data }) => { if (alive) setGranted(!!data) })
    return () => { alive = false }
  }, [id, role])

  return granted
}
