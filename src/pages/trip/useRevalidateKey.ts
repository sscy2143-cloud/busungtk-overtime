import { useEffect, useState } from 'react'

/**
 * 화면 복귀(탭 활성·창 포커스)와 주기마다 올라가는 번호 — 출장 모듈(TripRemoteProvider.revalidateKey)이 서버 값으로 다시 채우는 신호.
 * 권한 회수·로그아웃·역할 변경이 이미 열려 있는 화면에 남지 않게 한다. 차단 자체는 서버(RLS)가 하고, 여기서는 다시 묻기만 한다.
 */
export function useRevalidateKey(intervalMs = 60_000): number {
  const [key, setKey] = useState(0)
  useEffect(() => {
    const tick = () => setKey((n) => n + 1)
    const onVisible = () => { if (document.visibilityState === 'visible') tick() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', tick)
    const timer = window.setInterval(tick, intervalMs)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', tick)
      window.clearInterval(timer)
    }
  }, [intervalMs])
  return key
}
