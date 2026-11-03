import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  createMemoryRepository, createTripService, type Actor, type HolidayCalendar, type ServiceDeps, type TripRepository,
} from '../../data'
import { MON, TEST_CALENDAR, TUE, alice, bob, boss, dayHeader, siteEntry, stayHeader, unwrap } from '../../data/__tests__/fixtures'
import { AdminTripReview, ClaimReviewDetail, EmployeeTripScreen, MyTripClaims, TripClaimForm, TripRemoteProvider, TripScreenProvider, TripViewGrantsAdmin, TripViewerScreen, WorkRequestEntry } from '..'

const EMPLOYEES = [
  { id: alice.id, name: '김직원', role: 'employee' as const },
  { id: bob.id, name: '이동행', role: 'employee' as const },
  { id: boss.id, name: '박관리', role: 'admin' as const },
]

/** 화면이 쓸 저장소에 미리 데이터를 넣는다 (서비스 규칙을 그대로 거쳐서) */
function seeded(calendar: HolidayCalendar = TEST_CALENDAR) {
  const repo = createMemoryRepository()
  let seq = 0
  const deps: ServiceDeps = { repo, calendar, now: () => '2026-11-10T09:00:00Z', newId: (p) => `${p}-${++seq}` }
  const service = createTripService(deps)
  const draft = unwrap(service.createClaim(alice, { header: stayHeader(['대전'], MON, '2026-11-04'), entries: [siteEntry(MON, '08:00', '17:00'), siteEntry(TUE, '08:00', '19:00')] }))
  const submitted = unwrap(service.submit(alice, draft.id, draft.version))
  const other = unwrap(service.createClaim(bob, { header: dayHeader(['부산'], '2026-11-06'), entries: [siteEntry('2026-11-06', '10:00', '16:00')] }))
  return { repo, submitted, other }
}

function render(ui: React.ReactNode, opts: { actor: Actor; repo?: TripRepository; flags?: Record<string, boolean>; calendar?: HolidayCalendar }) {
  return renderToStaticMarkup(
    <TripScreenProvider actor={opts.actor} employees={EMPLOYEES} today={MON} repo={opts.repo} flags={opts.flags} calendar={opts.calendar}>
      {ui}
    </TripScreenProvider>,
  )
}

describe('직원 화면', () => {
  it('기능이 꺼져 있으면 입구 대신 안내만 보인다', () => {
    const html = render(<EmployeeTripScreen />, { actor: alice })
    expect(html).toContain('아직 열리지 않았습니다')
    expect(html).not.toContain('근무 신청')
  })

  it('통합 입구: 야근과 출장 두 종류, 야근 연결은 보류 문구', () => {
    const html = renderToStaticMarkup(<WorkRequestEntry onPickTrip={() => {}} />)
    expect(html).toContain('사무실 야근·잔업')
    expect(html).toContain('출장 (근거리 현장 포함)')
    expect(html).toContain('연결은 보류 중')
  })

  it('새 신청 양식: 기본 입력은 지역·일정·현장 시각·점심뿐이고, 예외 입력은 접혀 있다', () => {
    const html = render(<TripClaimForm />, { actor: alice, flags: { employeeForm: true } })
    expect(html).toContain('지역을 고르세요')
    expect(html).toContain('당일 출장')
    expect(html).toContain('현장 시작')
    expect(html).toContain('점심시간(1시간)을 썼습니다')
    expect(html).toContain('추가 상황 (해당할 때만)')
    // 사무실 근무는 예외 입력 — 접힌 "추가 상황" 안에만 있다
    expect(html.indexOf('사무실 시작')).toBeGreaterThan(html.indexOf('추가 상황 (해당할 때만)'))
    expect(html).toContain('저장하고 계속')
  })

  it('달력 출처가 없으면 양식에 경고가 뜬다', () => {
    const html = render(<TripClaimForm />, { actor: alice, flags: { employeeForm: true } }) // calendar 기본값 NO_CALENDAR
    expect(html).toContain('공휴일 달력이 검증되지 않아')
    const verified = render(<TripClaimForm />, { actor: alice, flags: { employeeForm: true }, calendar: TEST_CALENDAR })
    expect(verified).not.toContain('공휴일 달력이 검증되지 않아')
  })

  it('기존 신청을 열면 입력과 미리보기(기준 사례 2시간 확정, 중간일 제안값)가 보인다', () => {
    const { repo, submitted } = seeded()
    const html = render(<TripClaimForm claimId={submitted.id} />, { actor: alice, repo, flags: { employeeForm: true }, calendar: TEST_CALENDAR })
    expect(html).toContain('숙박 출장 가는 날 · 평일')
    expect(html).toContain('숙박 출장 중간일 · 평일')
    expect(html).toContain('관리자 확인 필요')
    expect(html).toContain('계산에 쓴 표준 이동 구간: 06:00~08:00')
    expect(html).not.toContain('>제출<') // 제출된 건은 수정·제출 버튼 없음
    expect(html).toContain('신청 취소')
  })

  it('남의 신청은 열 수 없다', () => {
    const { repo, other } = seeded()
    const html = render(<TripClaimForm claimId={other.id} />, { actor: alice, repo, flags: { employeeForm: true } })
    expect(html).toContain('권한이 없습니다')
  })

  it('내 신청 목록: 상태·시간 합계·동행 초안 안내', () => {
    const { repo, submitted } = seeded()
    const svc = createTripService({ repo, calendar: TEST_CALENDAR, now: () => 'x', newId: (p) => `${p}-z${Math.floor(Math.random() * 1e6)}` })
    unwrap(svc.inviteCompanions(alice, submitted.id, [bob.id]))
    const mine = render(<MyTripClaims onOpen={() => {}} onNew={() => {}} />, { actor: alice, repo, flags: { employeeForm: true }, calendar: TEST_CALENDAR })
    expect(mine).toContain('제출됨')
    expect(mine).toContain('출장 2시간 · 연장 2시간')
    expect(mine).toContain('관리자 확인 필요 항목 있음')
    const bobs = render(<MyTripClaims onOpen={() => {}} onNew={() => {}} />, { actor: bob, repo, flags: { employeeForm: true }, calendar: TEST_CALENDAR })
    expect(bobs).toContain('동행자가 보낸 초안')
    expect(bobs).toContain('열어서 고치기')
  })
})

describe('관리자 화면', () => {
  it('기능이 꺼져 있으면 목록 대신 안내', () => {
    expect(render(<AdminTripReview />, { actor: boss, flags: { employeeForm: true } })).toContain('아직 열리지 않았습니다')
  })

  it('직원 계정으로 관리자 화면을 열면 권한 오류', () => {
    const { repo } = seeded()
    const html = render(<AdminTripReview />, { actor: alice, repo, flags: { employeeForm: true, adminReview: true } })
    expect(html).toContain('권한이 없습니다')
  })

  it('목록: 제출된 건만, 확정값과 제안값을 따로, 확인 항목 수', () => {
    const { repo } = seeded()
    const html = render(<AdminTripReview />, { actor: boss, repo, flags: { adminReview: true }, calendar: TEST_CALENDAR })
    expect(html).toContain('김직원')
    expect(html).not.toContain('이동행') // bob 건은 작성 중 → 기본 필터(제출됨)에 없음
    expect(html).toContain('출장 2시간 · 연장 0시간') // 확정
    expect(html).toContain('출장 0시간 · 연장 2시간') // 제안값(E5)
    expect(html).toContain('확인 항목 1건')
  })

  it('상세: 확인 항목·승인 차단 사유·입력 원본·이력 탭', () => {
    const { repo, submitted } = seeded()
    const html = render(<ClaimReviewDetail claimId={submitted.id} onBack={() => {}} />, { actor: boss, repo, flags: { adminReview: true }, calendar: TEST_CALENDAR })
    expect(html).toContain('승인 전 확인 항목')
    expect(html).toContain('숙박 중간일 (E5)')
    expect(html).toContain('미확정 규칙 · 제안값')
    expect(html).toContain('승인 불가: 확인하지 않은 표시 1건')
    expect(html).toContain('입력값 수정')
    expect(html).toContain('제안값(미확정 규칙)이 있습니다')
  })

  it('달력 미검증이면 상세에 확인 항목으로 올라온다', () => {
    const { repo, submitted } = seeded({ holidays: new Set(), verified: false, source: 'none' })
    const html = render(<ClaimReviewDetail claimId={submitted.id} onBack={() => {}} />, { actor: boss, repo, flags: { adminReview: true } })
    expect(html).toContain('공휴일 달력 미검증')
  })
})

describe('원격 제공자 (T7 글루)', () => {
  it('첫 동기화가 끝나기 전에는 안내만 보여 주고 서버를 부르지 않는다 (정적 렌더에서는 효과가 돌지 않는다)', () => {
    let fetched = 0
    const html = renderToStaticMarkup(
      <TripRemoteProvider
        baseUrl="https://example.invalid" anonKey="anon"
        getAccessToken={async () => { fetched++; return null }}
        actor={alice} employees={EMPLOYEES} today={MON} calendar={TEST_CALENDAR}
      >
        <EmployeeTripScreen />
      </TripRemoteProvider>,
    )
    expect(html).toContain('불러오는 중')
    expect(html).not.toContain('근무 신청')
    expect(fetched).toBe(0)
  })
})

describe('전체 출장 내역 조회 (admin 지정 권한)', () => {
  const LEAD = 'emp-lead'
  const lead = { id: LEAD, role: 'employee' as const }
  const WITH_LEAD = [...EMPLOYEES, { id: LEAD, name: '최팀장', role: 'employee' as const }]
  const renderLead = (ui: React.ReactNode, grants: string[], flags: Record<string, boolean> = { employeeForm: true, adminReview: true }) => {
    const { repo } = seeded()
    return renderToStaticMarkup(
      <TripScreenProvider actor={lead} employees={WITH_LEAD} today={MON} repo={repo} flags={flags} viewGrants={grants}>{ui}</TripScreenProvider>,
    )
  }

  it('권한 없는 팀장: 안내만, 목록 없음', () => {
    const html = renderLead(<TripViewerScreen />, [])
    expect(html).toContain('조회 권한이 없습니다')
    expect(html).not.toContain('김직원')
  })

  it('권한 받은 팀장: 읽기 전용 목록 — 모든 직원 건이 보이고 "보기" 버튼, 승인·수정 조작 없음', () => {
    const html = renderLead(<TripViewerScreen />, [LEAD])
    expect(html).toContain('출장 내역 조회')
    expect(html).toContain('김직원')          // 기본 필터 '제출됨' — 김직원 건만 제출 상태
    expect(html).toContain('보기')
    expect(html).not.toContain('>검토<')
    expect(html).not.toContain('계산 갱신')
  })

  it('권한 받은 팀장의 상세: 조회 전용 문구, 승인·되돌림·반려·입력값 수정 없음', () => {
    const { repo, submitted } = seeded()
    const html = renderToStaticMarkup(
      <TripScreenProvider actor={lead} employees={WITH_LEAD} today={MON} repo={repo} flags={{ employeeForm: true, adminReview: true }} viewGrants={[LEAD]}>
        <ClaimReviewDetail claimId={submitted.id} onBack={() => {}} readOnly />
      </TripScreenProvider>,
    )
    expect(html).toContain('조회 전용')
    expect(html).not.toContain('>승인<')
    expect(html).not.toContain('>되돌림<')
    expect(html).not.toContain('>반려<')
    expect(html).not.toContain('입력값 수정')
    expect(html).toContain('disabled=""')      // 확인 표시 체크박스는 읽기 전용
  })

  it('스위치가 꺼지면 권한이 있어도 안내만', () => {
    const html = renderLead(<TripViewerScreen />, [LEAD], { employeeForm: true, adminReview: false })
    expect(html).toContain('아직 열리지 않았습니다')
    expect(html).not.toContain('김직원')
  })

  it('권한 관리 화면: admin 에게는 직원 목록과 부여/회수 버튼, 직원에게는 안내만', () => {
    const { repo } = seeded()
    const adminHtml = renderToStaticMarkup(
      <TripScreenProvider actor={boss} employees={WITH_LEAD} today={MON} repo={repo} flags={{ adminReview: true }} viewGrants={[LEAD]}>
        <TripViewGrantsAdmin />
      </TripScreenProvider>,
    )
    expect(adminHtml).toContain('최팀장')
    expect(adminHtml).toContain('조회 권한 있음')
    expect(adminHtml).toContain('회수')
    expect(adminHtml).toContain('김직원')
    expect(adminHtml).toContain('부여')
    expect(adminHtml).not.toContain('박관리</p>')   // 본인은 목록에 없음
    const empHtml = renderLead(<TripViewGrantsAdmin />, [])
    expect(empHtml).toContain('대표(admin)만')
  })
})
