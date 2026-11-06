import { describe, expect, it } from 'vitest'
import { createGuardedTripService, createStaticGate } from '../../data/gate'
import { createMemoryRepository } from '../../data/repository'
import { reviewItems, type ServiceDeps } from '../../data/service'
import type { TripCalcRecord } from '../../data/types'
import { MON, TEST_CALENDAR, alice, boss, dayHeader, siteEntry, unwrap } from '../../data/__tests__/fixtures'
import { comparePilot, parseManualCsv, toPilotCsv, type SystemRow } from '..'

const sys = (ref: string, date: string, confirmed: SystemRow['confirmed'], held: SystemRow['held'] = {}): SystemRow => ({ ref, date, confirmed, held })

describe('comparePilot — 시스템 결과와 수기 계산 대조', () => {
  it('같으면 match, 다르면 diff(차이와 방향), 한쪽에만 있으면 system_only / manual_only', () => {
    const r = comparePilot(
      [sys('E1', '2026-11-09', { trip: 4 }), sys('E1', '2026-11-10', { trip: 4, overtime: 1 }), sys('E2', '2026-11-09', { trip: 2 })],
      [
        { ref: 'E1', date: '2026-11-09', hours: { trip: 4 } },
        { ref: 'E1', date: '2026-11-10', hours: { trip: 4, overtime: 2 } },
        { ref: 'E3', date: '2026-11-09', hours: { trip: 1 } },
      ],
    )
    expect(r.rows.map((x) => [x.ref, x.date, x.status])).toEqual([
      ['E1', '2026-11-09', 'match'], ['E1', '2026-11-10', 'diff'], ['E2', '2026-11-09', 'system_only'], ['E3', '2026-11-09', 'manual_only'],
    ])
    expect(r.rows[1].diffs).toEqual([{ key: 'overtime', system: 1, manual: 2, diff: -1, fromHeld: false }])
    expect(r.summary).toMatchObject({ total: 4, match: 1, diff: 1, systemOnly: 1, manualOnly: 1, matchRate: 25 })
  })

  it('제안값(held)은 값으로 비교하되 일치해도 heldKeys 로 표시하고 요약에 센다', () => {
    const r = comparePilot([sys('E1', '2026-11-09', { trip: 2 }, { nightOvertime: 1 })], [{ ref: 'E1', date: '2026-11-09', hours: { trip: 2, nightOvertime: 1 } }])
    expect(r.rows[0]).toMatchObject({ status: 'match', heldKeys: ['nightOvertime'] })
    expect(r.summary.matchedWithHeld).toBe(1)
    const d = comparePilot([sys('E1', '2026-11-09', { trip: 2 }, { nightOvertime: 1 })], [{ ref: 'E1', date: '2026-11-09', hours: { trip: 2 } }])
    expect(d.rows[0].diffs[0]).toMatchObject({ key: 'nightOvertime', fromHeld: true, diff: 1 })
  })

  it('허용 오차 기본 0, 지정하면 그 범위 안은 일치', () => {
    const a = [sys('E1', '2026-11-09', { trip: 4 })]
    const m = [{ ref: 'E1', date: '2026-11-09', hours: { trip: 3.5 } }]
    expect(comparePilot(a, m).rows[0].status).toBe('diff')
    expect(comparePilot(a, m, { toleranceHours: 0.5 }).rows[0].status).toBe('match')
  })

  it('같은 직원·날짜의 여러 줄은 합산하고 merged 로 표시, 부동소수점 오차는 반올림', () => {
    const r = comparePilot([sys('E1', '2026-11-09', { trip: 0.1 }), sys('E1', '2026-11-09', { trip: 0.2 })], [{ ref: 'E1', date: '2026-11-09', hours: { trip: 0.3 } }])
    expect(r.rows[0]).toMatchObject({ status: 'match', merged: true })
  })

  it('입력이 비어 있으면 일치율은 null', () => {
    expect(comparePilot([], []).summary).toMatchObject({ total: 0, matchRate: null })
  })

  it('급여 반영 여부를 판단하지 않는다 (요약에 payroll 관련 필드가 없다)', () => {
    const keys = Object.keys(comparePilot([], []).summary)
    expect(keys.some((k) => /payroll|apply|ready/i.test(k))).toBe(false)
  })
})

describe('CSV 내보내기·가져오기', () => {
  it('내보내기: 머리글, 확정+제안 합산, heldKeys, 정렬, 개인정보 열 없음', () => {
    const csv = toPilotCsv([sys('E2', '2026-11-10', { trip: 4 }, { nightOvertime: 1 }), sys('E1', '2026-11-09', { trip: 2.5 })])
    expect(csv.split('\r\n')).toEqual([
      'ref,date,trip,nightTravel,overtime,nightOvertime,holidayWithin8,holidayOver8,heldKeys',
      'E1,2026-11-09,2.5,,,,,,',
      'E2,2026-11-10,4,,,1,,,nightOvertime',
      '',
    ])
    expect(csv).not.toMatch(/wage|hourly|name|email|시급/i)
  })

  it('내보내기: 수식으로 실행될 수 있는 ref 는 무력화하고 쉼표·따옴표는 감싼다', () => {
    const csv = toPilotCsv([sys('=HYPERLINK("x")', '2026-11-09', { trip: 1 }), sys('A,B', '2026-11-09', { trip: 1 })])
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`)
    expect(csv).toContain('"A,B"')
  })

  it('가져오기: 내보낸 CSV 를 그대로 읽는다 (왕복) — BOM·CRLF·따옴표 처리', () => {
    const rows = [sys('E1', '2026-11-09', { trip: 2.5, overtime: 1 }), sys('A,B', '2026-11-10', { trip: 4 })]
    const parsed = parseManualCsv('﻿' + toPilotCsv(rows))
    expect(parsed.issues).toEqual([])
    expect(parsed.rows).toEqual([
      { ref: 'A,B', date: '2026-11-10', hours: { trip: 4 } },
      { ref: 'E1', date: '2026-11-09', hours: { trip: 2.5, overtime: 1 } },
    ])
  })

  it('가져오기: 잘못된 줄은 줄 번호와 이유를 남기고 건너뛴다 — 조용히 고치지 않는다', () => {
    const text = ['ref,date,trip,overtime', 'E1,2026-11-09,4,', ',2026-11-09,1,', 'E2,2026-02-30,1,', 'E3,2026-11-09,abc,', 'E4,2026-11-09,-1,', 'E5,2026-11-09,99,', 'E6,2026-11-09,2,1'].join('\n')
    const { rows, issues } = parseManualCsv(text)
    expect(rows.map((r) => r.ref)).toEqual(['E1', 'E6'])
    expect(issues.map((i) => i.line)).toEqual([3, 4, 5, 6, 7])
  })

  it('가져오기: ref·date 열이 없거나 비어 있으면 거부', () => {
    expect(parseManualCsv('trip\n1').issues[0].message).toMatch(/ref, date/)
    expect(parseManualCsv('').issues[0].message).toMatch(/내용/)
  })
})

describe('실제 서비스 흐름과의 연결 — 승인된 신청의 정산 미리보기를 수기 계산표와 대조', () => {
  function approvedPreview() {
    let seq = 0
    let tick = 0
    const deps: ServiceDeps = {
      repo: createMemoryRepository(), calendar: TEST_CALENDAR,
      now: () => `2026-11-10T09:00:${String(tick++).padStart(2, '0')}Z`, newId: (p) => `${p}-${++seq}`,
    }
    const svc = createGuardedTripService(deps, createStaticGate({ employeeForm: true, adminReview: true }, { [alice.id]: 'employee', [boss.id]: 'admin' }))
    const c = unwrap(svc.createClaim(alice, { header: dayHeader(['대전']), entries: [siteEntry(MON, '08:00', '17:00')] }))
    const sent = unwrap(svc.submit(alice, c.id, c.version))
    const calcs = unwrap(svc.latestCalcs(boss, sent.id)) as TripCalcRecord[]
    const flagDecisions = calcs.flatMap((x) => reviewItems(x).map((code) => ({ calcId: x.id, code, decision: 'acknowledged' as const })))
    unwrap(svc.review(boss, sent.id, { action: 'approve', expectedCalcIds: calcs.map((x) => x.id), flagDecisions }))
    return unwrap(svc.settlementPreview(boss, sent.id))
  }

  it('기준 사례(대전 08~17, 점심 1시간 → 출장 4시간)가 수기 4시간과 일치하고, 3시간이면 차이 1시간으로 잡힌다', () => {
    const preview = approvedPreview()
    expect(preview.payrollApplicable).toBe(false)
    const system: SystemRow[] = preview.days.map((d) => ({ ref: 'E1', date: d.date, confirmed: d.confirmed, held: d.held }))
    expect(system[0].confirmed.trip).toBe(4)
    const ok = comparePilot(system, [{ ref: 'E1', date: system[0].date, hours: { trip: 4 } }])
    expect(ok.summary).toMatchObject({ match: 1, diff: 0 })
    const bad = comparePilot(system, [{ ref: 'E1', date: system[0].date, hours: { trip: 3 } }])
    expect(bad.rows[0].diffs).toEqual([{ key: 'trip', system: 4, manual: 3, diff: 1, fromHeld: false }])
  })
})
