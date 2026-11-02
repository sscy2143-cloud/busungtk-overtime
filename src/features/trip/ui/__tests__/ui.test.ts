import { describe, expect, it } from 'vitest'
import { classifyDay } from '../../data'
import { HOLIDAY, MON, TUE, alice, boss, dayHeader, setup, siteEntry, stayHeader, unwrap } from '../../data/__tests__/fixtures'
import { TRIP_FEATURE, approvalBlockers, buildDayPreview, formSections, formatClock, formatHours, toReviewRow, visibleSections } from '..'

const opts = { holidays: new Set([HOLIDAY]) }

describe('표시 형식', () => {
  it('시각·시간 표기', () => {
    expect(formatClock(7.5)).toBe('07:30')
    expect(formatClock(26)).toBe('다음 날 02:00')
    expect(formatClock(-1)).toBe('전날 23:00')
    expect(formatHours(2.5)).toBe('2시간 30분')
    expect(formatHours(0)).toBe('0시간')
  })

  it('기능 스위치는 꺼져 있다', () => {
    expect(TRIP_FEATURE).toEqual({ employeeForm: false, adminReview: false })
  })
})

describe('직원 신청 화면 — 보여 줄 입력', () => {
  const keys = (h: Parameters<typeof formSections>[0], e: Parameters<typeof formSections>[1]) =>
    visibleSections(formSections(h, e, classifyDay(h, e, opts))).map((s) => `${s.key}:${s.mode}`)

  it('기본 당일 출장은 지역·일정·현장 시각·점심만 보인다', () => {
    expect(keys(dayHeader(['대전']), siteEntry(MON, '08:00', '17:00'))).toEqual(['regions:base', 'schedule:base', 'site:base', 'lunch:base'])
  })

  it('작업 없이 이동만 한 날은 출발 시각과 사유를 필수로 펼친다', () => {
    expect(keys(dayHeader(['부산']), { date: MON, noSiteWork: { reason: '' } }))
      .toEqual(['regions:base', 'schedule:base', 'site:base', 'lunch:base', 'noSiteWork:required', 'travelStarts:required'])
  })

  it('사무실 근무 후 출발은 사무실 시각만 추가 (출발 시각은 묻지 않음 — E4)', () => {
    expect(keys(dayHeader(['대전']), siteEntry(MON, '21:00', '02:00', { office: { start: '09:00', end: '18:00' } })))
      .toEqual(['regions:base', 'schedule:base', 'site:base', 'lunch:base', 'office:required'])
  })

  it('도착 후 작업까지 1시간 이상 비면 회사 지시 대기였는지 묻는다 (출발 시각을 비우면 묻지 않음)', () => {
    const office = { start: '09:00', end: '18:00' }
    expect(keys(dayHeader(['대전']), siteEntry(MON, '22:00', '02:00', { office, travelStarts: { out: '18:30' } })))
      .toContain('directedWaits:suggested') // 도착 20:30, 작업 22:00
    expect(keys(dayHeader(['대전']), siteEntry(MON, '22:00', '02:00', { office }))).not.toContain('directedWaits:suggested')
  })

  it('다음 날까지 이어진 작업은 휴게를 필수로, 긴 작업은 휴게를 권한다', () => {
    expect(keys(dayHeader(['대전']), siteEntry(MON, '21:00', '11:00', { site: { start: '21:00', end: '11:00', endNextDay: true } }))).toContain('breaks:required')
    expect(keys(dayHeader(['대전']), siteEntry(MON, '07:00', '20:00'))).toContain('breaks:suggested')
  })

  it('제주는 실제 시각·증빙을 필수로 펼친다', () => {
    expect(keys(dayHeader(['제주']), siteEntry(MON, '14:00', '20:00'))).toContain('jeju:required')
  })
})

describe('미리보기', () => {
  it('팀장님 기준 사례: 출장 4시간 확정, 계산에 쓴 표준 이동 구간 표시', () => {
    const { service } = setup()
    const c = unwrap(service.createClaim(alice, { header: dayHeader(['대전']), entries: [siteEntry(MON, '08:00', '17:00')] }))
    const p = buildDayPreview(service.latestCalcs(c.id)[0])
    expect(p.heading).toBe('당일 출장 · 평일')
    expect(p.rows.map((r) => [r.label, r.text, r.status])).toEqual([
      ['출장', '4시간', 'confirmed'], ['그중 야간 이동', '0시간', 'confirmed'], ['연장', '0시간', 'confirmed'], ['그중 야간', '0시간', 'confirmed'],
    ])
    expect(p.standardTravel).toEqual(['06:00~08:00', '17:00~19:00'])
    expect(p.proposedNote).toBeUndefined()
  })

  it('제안값이 있으면 안내하고, 입력이 모자라면 질문을 보여 준다', () => {
    const { service } = setup()
    const c = unwrap(service.createClaim(alice, { header: stayHeader(['대전'], MON, TUE), entries: [siteEntry(MON, '08:00', '17:00'), { date: TUE }] }))
    const [mon, tue] = service.latestCalcs(c.id).map(buildDayPreview)
    expect(mon.heading).toBe('숙박 출장 가는 날 · 평일')
    expect(tue.prompts).toEqual(['현장 작업 시작·종료 시각을 입력하세요'])
    const mid = unwrap(service.createClaim(alice, { header: stayHeader(['대전'], '2026-11-09', '2026-11-11'), entries: [siteEntry('2026-11-10', '08:00', '19:00')] }))
    const p = buildDayPreview(service.latestCalcs(mid.id)[0])
    expect(p.proposedNote).toBeDefined()
    expect(p.flags[0].title).toBe('숙박 중간일 (E5)')
  })
})

describe('관리자 목록·승인 가능 여부', () => {
  it('확정값과 제안값 합계를 따로 보여 주고, 확인 항목이 남으면 승인 버튼을 막는다', () => {
    const { service, repo } = setup()
    const d = unwrap(service.createClaim(alice, {
      header: stayHeader(['대전'], MON, '2026-11-04'),
      entries: [siteEntry(MON, '08:00', '17:00'), siteEntry(TUE, '08:00', '19:00')],
    }))
    const s = unwrap(service.submit(alice, d.id, d.version))
    const calcs = service.latestCalcs(s.id)
    const row = toReviewRow(s, calcs, repo.listDays(s.id).map((x) => x.date))
    expect(row.confirmed).toEqual({ trip: 2, overtime: 0, holiday: 0 })
    expect(row.proposed).toEqual({ trip: 0, overtime: 2, holiday: 0 })
    expect(row.reviewCount).toBe(1)
    expect(approvalBlockers(s, calcs, [])).toEqual(['확인하지 않은 표시 1건'])
    const decisions = calcs.flatMap((c) => (c.result?.ok ? c.result.flags : []).map((f) => ({ calcId: c.id, code: f.code, decision: 'acknowledged' as const })))
    expect(approvalBlockers(s, calcs, decisions)).toEqual([])
    expect(service.review(boss, s.id, { action: 'approve', expectedCalcIds: calcs.map((c) => c.id), flagDecisions: decisions }).ok).toBe(true)
  })
})
