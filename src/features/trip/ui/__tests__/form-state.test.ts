import { describe, expect, it } from 'vitest'
import { MON, TEST_CALENDAR, TUE, WED, alice, setup, unwrap } from '../../data/__tests__/fixtures'
import { NO_CALENDAR } from '../../data'
import { describeError } from '../messages'
import { formReducer, initialFormState, previewDays, scheduleDates, submitBlockers, type TripFormState } from '../form-state'

const base = () => formReducer(initialFormState(MON), { type: 'setRegions', regions: ['대전'] })
const withSite = (s: TripFormState, date = MON, start = '08:00', end = '17:00') =>
  formReducer(s, { type: 'patchEntry', date, patch: { site: { start, end } } })

describe('신청 화면 상태', () => {
  it('처음에는 당일 일정 하루, 지역 없음 → 미리보기는 "지역을 고르세요"', () => {
    const s = initialFormState(MON)
    expect(s.entries).toEqual([{ date: MON }])
    expect(previewDays(s, TEST_CALENDAR)[0].classification.notices[0].code).toBe('REGION_REQUIRED')
    expect(submitBlockers(s, previewDays(s, TEST_CALENDAR))).toContain('지역을 고르세요')
  })

  it('숙박으로 바꾸면 날짜가 늘고, 입력한 날의 값은 지켜지며, 당일로 돌리면 나머지는 버린다', () => {
    let s = withSite(base())
    s = formReducer(s, { type: 'setSchedule', schedule: { kind: 'stay', startDate: MON, endDate: WED } })
    expect(s.entries.map((e) => e.date)).toEqual([MON, TUE, WED])
    expect(s.entries[0].site).toEqual({ start: '08:00', end: '17:00' })
    s = formReducer(s, { type: 'setSchedule', schedule: { kind: 'day', date: MON } })
    expect(s.entries).toHaveLength(1)
    expect(scheduleDates({ kind: 'stay', startDate: WED, endDate: MON })).toEqual([WED]) // 끝이 앞이면 하루만
  })

  it('patch 에 undefined 를 주면 예외 입력이 지워진다', () => {
    let s = formReducer(withSite(base()), { type: 'patchEntry', date: MON, patch: { office: { start: '09:00', end: '18:00' } } })
    expect(previewDays(s, TEST_CALENDAR)[0].classification.workType).toBe('office_then_depart')
    s = formReducer(s, { type: 'patchEntry', date: MON, patch: { office: undefined } })
    expect(s.entries[0]).toEqual({ date: MON, site: { start: '08:00', end: '17:00' } })
    expect(previewDays(s, TEST_CALENDAR)[0].classification.workType).toBe('day_trip')
  })

  it('미리보기는 저장과 같은 계산: 기준 사례 4시간 확정, 제출 가능 여부는 저장 후', () => {
    const s = withSite(base())
    const [p] = previewDays(s, TEST_CALENDAR)
    expect(p.result?.ok && p.result.trip.hours).toBe(4)
    expect(submitBlockers(s, [p])).toEqual(['먼저 저장하세요'])
    const { service } = setup()
    const claim = unwrap(service.createClaim(alice, { header: s.header, entries: s.entries }))
    const saved = formReducer(s, { type: 'saved', claim })
    expect(saved.saved).toMatchObject({ id: claim.id, version: 1, status: 'draft' })
    expect(submitBlockers(saved, [p])).toEqual([])
    const edited = withSite(saved, MON, '07:00', '17:00')
    expect(submitBlockers(edited, [p])).toEqual(['고친 내용을 저장한 뒤 제출하세요'])
  })

  it('입력이 모자라면 제출이 막히고 어느 날인지 알려 준다', () => {
    const s = formReducer(base(), { type: 'setSchedule', schedule: { kind: 'stay', startDate: MON, endDate: TUE } })
    const withMon = withSite(s)
    const computed = previewDays(withMon, TEST_CALENDAR)
    expect(computed[1].classification.missing).toEqual(['site'])
    expect(submitBlockers(withMon, computed)).toContain(`입력이 더 필요한 날: ${TUE}`)
  })

  it('달력 출처가 없으면 미리보기에도 안내가 뜬다', () => {
    const [p] = previewDays(withSite(base()), NO_CALENDAR)
    expect(p.classification.notices.map((n) => n.code)).toContain('HOLIDAY_SOURCE_UNVERIFIED')
  })

  it('오류는 상태에 남고 다음 입력에 지워진다', () => {
    let s = formReducer(base(), { type: 'failed', code: 'VERSION_CONFLICT', message: 'x' })
    expect(s.error?.code).toBe('VERSION_CONFLICT')
    s = withSite(s)
    expect(s.error).toBeUndefined()
  })
})

describe('오류 안내 문구', () => {
  it('버전 충돌은 새로 불러오기를 권하고, 모르는 코드는 원문을 보여 준다', () => {
    expect(describeError('VERSION_CONFLICT', 'raw')).toMatchObject({ action: 'reload', title: '다른 곳에서 먼저 저장되었습니다' })
    expect(describeError('FEATURE_DISABLED', 'raw').action).toBe('none')
    expect(describeError('WHATEVER', '원문 메시지')).toEqual({ title: '처리하지 못했습니다', detail: '원문 메시지', action: 'none' })
  })
})
