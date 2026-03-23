import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { X, ChevronRight, ChevronLeft, PartyPopper } from 'lucide-react'

interface TourStep {
  target: string        // CSS selector or 'center' for center modal
  title: string
  description: string
  position: 'top' | 'bottom' | 'left' | 'right' | 'center'
  route?: string        // navigate to this route before showing
  bullets?: string[]    // optional bullet points for center modals
}

const TOUR_STEPS: TourStep[] = [
  // ── 1. 대시보드 전체 개요 (센터 모달) ──
  {
    target: 'center',
    title: '환영합니다! 👋',
    description: '부성티케이 근태관리 시스템입니다.\n대시보드에서는 다음 정보를 한눈에 확인할 수 있어요.',
    position: 'center',
    route: '/',
    bullets: [
      '금주 연장근무시간 (한도 12시간)',
      '잔여 연차 현황',
      '빠른 액션 (연장근무/휴가 신청, 근무 기록)',
      '최근 제출 내역 및 승인 상태',
      '공지사항 / 급여명세서',
    ],
  },
  // ── 2. 근무 현황 페이지 ──
  {
    target: '[data-tour="work-summary"]',
    title: '근무 현황',
    description: '금주/이번달 연장근무 시간과 승인 대기 건수를 확인할 수 있어요. 캘린더로 월별 근무 내역도 볼 수 있습니다.',
    position: 'bottom',
    route: '/requests',
  },
  // ── 3. 연장근무 신청 페이지 ──
  {
    target: '[data-tour="overtime-gauge"]',
    title: '연장근무 신청',
    description: '주간 연장근무 게이지로 현재 시간을 확인하고, 날짜/시간/현장명/사유를 입력하여 연장근무를 신청합니다. 단체 신청도 가능해요.',
    position: 'bottom',
    route: '/request',
  },
  // ── 4. 휴가 현황 - 연차 현황 카드 ──
  {
    target: '[data-tour="leave-balance-card"]',
    title: '연차 현황',
    description: '올해 총 연차, 사용 연차, 잔여 연차를 한눈에 확인할 수 있어요. 소진율 게이지와 근속연수도 표시됩니다.',
    position: 'bottom',
    route: '/leave',
  },
  // ── 5. 휴가 현황 - 신청 내역 ──
  {
    target: '[data-tour="leave-requests"]',
    title: '휴가 신청 내역',
    description: '내가 신청한 휴가 목록이에요. 상태별로 필터링하고, 대기중인 신청은 수정/취소도 가능합니다. 연차내역 버튼으로 월별 사용 기록도 볼 수 있어요.',
    position: 'top',
    route: '/leave',
  },
  // ── 6. 휴가 신청 - 유형 선택 ──
  {
    target: '[data-tour="leave-type-select"]',
    title: '휴가 유형 선택',
    description: '연차, 오전반차, 오후반차, 병가, 특별휴가 중 선택하세요. 대체휴가가 남아있으면 연차보다 먼저 차감됩니다.',
    position: 'bottom',
    route: '/leave/request',
  },
  // ── 7. 휴가 신청 - 날짜 선택 ──
  {
    target: '[data-tour="leave-date-select"]',
    title: '날짜 선택 & 제출',
    description: '시작일~종료일을 선택하면 주말을 제외한 일수가 자동 계산됩니다. 사유를 입력하고 제출하면 관리자 승인을 기다리면 됩니다.',
    position: 'bottom',
    route: '/leave/request',
  },
  // ── 8. 경비 제출 ──
  {
    target: '[data-tour="expense-summary"]',
    title: '경비 제출',
    description: '업무 중 사비로 지출한 경비를 제출하세요. 승인 대기/완료 금액을 한눈에 볼 수 있고, 지급 완료 시 수령확인도 여기서 합니다.',
    position: 'bottom',
    route: '/expenses',
  },
  // ── 9. 완료 (대시보드로 복귀) ──
  {
    target: 'center',
    title: '가이드 투어 완료! 🎉',
    description: '주요 기능을 모두 둘러봤어요.\n궁금한 점은 이용 가이드에서 더 자세히 확인할 수 있습니다.',
    position: 'center',
    route: '/',
  },
]

const STORAGE_KEY = 'busungtk_onboarding_done'

export function OnboardingTour() {
  const navigate = useNavigate()
  const location = useLocation()
  const [active, setActive] = useState(false)
  const [showComplete, setShowComplete] = useState(false)
  const [step, setStep] = useState(0)
  const [navigating, setNavigating] = useState(false)
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({})
  const [arrowStyle, setArrowStyle] = useState<React.CSSProperties>({})
  const [arrowDir, setArrowDir] = useState<'top' | 'bottom' | 'left' | 'right'>('top')

  useEffect(() => {
    const done = localStorage.getItem(STORAGE_KEY)
    if (!done) {
      const timer = setTimeout(() => setActive(true), 1200)
      return () => clearTimeout(timer)
    }
  }, [])

  // 페이지 이동 후 안정화 대기
  useEffect(() => {
    if (!active || !navigating) return
    const timer = setTimeout(() => setNavigating(false), 600)
    return () => clearTimeout(timer)
  }, [location.pathname, active, navigating])

  // 스텝 변경 시 필요하면 페이지 이동
  useEffect(() => {
    if (!active || navigating) return
    const currentStep = TOUR_STEPS[step]
    if (currentStep.route && location.pathname !== currentStep.route) {
      setNavigating(true)
      navigate(currentStep.route)
    }
  }, [step, active, navigating, location.pathname, navigate])

  const positionTooltip = useCallback(() => {
    if (!active || navigating) return
    const currentStep = TOUR_STEPS[step]

    // 센터 모달은 위치 계산 불필요
    if (currentStep.position === 'center') return

    const el = document.querySelector(currentStep.target)
    if (!el) return

    const rect = el.getBoundingClientRect()
    const scrollY = window.scrollY
    const scrollX = window.scrollX
    const gap = 12
    const tooltipW = 340
    const tooltipH = 180

    el.scrollIntoView({ behavior: 'smooth', block: 'center' })

    let style: React.CSSProperties = {}
    let aStyle: React.CSSProperties = {}
    let aDir: 'top' | 'bottom' | 'left' | 'right' = 'top'

    const pos = currentStep.position
    if (pos === 'bottom') {
      style = {
        top: rect.bottom + scrollY + gap,
        left: Math.max(8, Math.min(rect.left + scrollX + rect.width / 2 - tooltipW / 2, window.innerWidth - tooltipW - 8)),
      }
      aDir = 'top'
      aStyle = { top: -6, left: '50%', transform: 'translateX(-50%)' }
    } else if (pos === 'top') {
      style = {
        top: rect.top + scrollY - tooltipH - gap,
        left: Math.max(8, Math.min(rect.left + scrollX + rect.width / 2 - tooltipW / 2, window.innerWidth - tooltipW - 8)),
      }
      aDir = 'bottom'
      aStyle = { bottom: -6, left: '50%', transform: 'translateX(-50%)' }
    } else if (pos === 'right') {
      style = {
        top: rect.top + scrollY + rect.height / 2 - tooltipH / 2,
        left: rect.right + scrollX + gap,
      }
      aDir = 'left'
      aStyle = { left: -6, top: '50%', transform: 'translateY(-50%)' }
    } else {
      style = {
        top: rect.top + scrollY + rect.height / 2 - tooltipH / 2,
        left: rect.left + scrollX - tooltipW - gap,
      }
      aDir = 'right'
      aStyle = { right: -6, top: '50%', transform: 'translateY(-50%)' }
    }

    setTooltipStyle({ ...style, width: tooltipW, position: 'absolute' })
    setArrowStyle(aStyle)
    setArrowDir(aDir)
  }, [active, step, navigating])

  useEffect(() => {
    if (!active || navigating) return
    const timer = setTimeout(positionTooltip, 400)
    window.addEventListener('resize', positionTooltip)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('resize', positionTooltip)
    }
  }, [active, step, navigating, positionTooltip])

  function finish() {
    setActive(false)
    localStorage.setItem(STORAGE_KEY, 'true')
    // 대시보드로 복귀
    if (location.pathname !== '/') navigate('/')
  }

  function next() {
    if (step < TOUR_STEPS.length - 1) {
      setStep(s => s + 1)
    } else {
      setActive(false)
      setShowComplete(true)
      localStorage.setItem(STORAGE_KEY, 'true')
      if (location.pathname !== '/') navigate('/')
    }
  }

  function prev() {
    if (step > 0) setStep(s => s - 1)
  }

  if (!active && !showComplete) return null

  if (showComplete) {
    return (
      <div className="fixed inset-0 z-[998] flex items-center justify-center px-4">
        <div className="absolute inset-0 bg-black/50" onClick={() => setShowComplete(false)} />
        <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-8 text-center">
          <div className="text-4xl mb-4">🎉</div>
          <h3 className="text-lg font-bold text-gray-900 mb-2">가이드 투어 완료!</h3>
          <p className="text-sm text-gray-600 mb-6">
            더 자세한 사용법은 이용 가이드에서<br />확인하실 수 있습니다.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setShowComplete(false)}
              className="flex-1 py-2.5 text-sm font-medium text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50"
            >
              닫기
            </button>
            <button
              onClick={() => { setShowComplete(false); navigate('/guide') }}
              className="flex-1 py-2.5 text-sm font-semibold text-white bg-primary-600 rounded-xl hover:bg-primary-700 transition-colors"
            >
              이용 가이드 보기
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (navigating) {
    return (
      <div className="fixed inset-0 bg-black/40 z-[998] flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-xl px-6 py-4 flex items-center gap-3">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary-600" />
          <span className="text-sm text-gray-600">페이지 이동 중...</span>
        </div>
      </div>
    )
  }

  const currentStep = TOUR_STEPS[step]
  const isLast = step === TOUR_STEPS.length - 1
  const isCenter = currentStep.position === 'center'

  const arrowClasses = {
    top: 'border-l-[6px] border-r-[6px] border-b-[6px] border-l-transparent border-r-transparent border-b-white',
    bottom: 'border-l-[6px] border-r-[6px] border-t-[6px] border-l-transparent border-r-transparent border-t-white',
    left: 'border-t-[6px] border-b-[6px] border-r-[6px] border-t-transparent border-b-transparent border-r-white',
    right: 'border-t-[6px] border-b-[6px] border-l-[6px] border-t-transparent border-b-transparent border-l-white',
  }

  // 센터 모달
  if (isCenter) {
    return (
      <div className="fixed inset-0 z-[998] flex items-center justify-center px-4">
        <div className="absolute inset-0 bg-black/50" onClick={finish} />
        <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
          {/* 닫기 */}
          <button onClick={finish} className="absolute top-3 right-3 p-1 hover:bg-gray-100 rounded-lg">
            <X size={14} className="text-gray-400" />
          </button>

          {/* 스텝 표시 */}
          <p className="text-xs text-primary-600 font-semibold mb-2">{step + 1} / {TOUR_STEPS.length}</p>
          <h4 className="text-base font-bold text-gray-900 mb-2">{currentStep.title}</h4>
          <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-line">{currentStep.description}</p>

          {/* 불릿 리스트 */}
          {currentStep.bullets && (
            <ul className="mt-3 space-y-1.5">
              {currentStep.bullets.map((b, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                  <span className="mt-1 w-1.5 h-1.5 rounded-full bg-primary-500 shrink-0" />
                  {b}
                </li>
              ))}
            </ul>
          )}

          {/* 버튼 */}
          <div className="flex items-center justify-between mt-5">
            <button onClick={finish} className="text-xs text-gray-400 hover:text-gray-600">
              건너뛰기
            </button>
            <div className="flex gap-2">
              {step > 0 && (
                <button
                  onClick={prev}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
                >
                  <ChevronLeft size={12} />
                  이전
                </button>
              )}
              <button
                onClick={next}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors"
              >
                {isLast ? (
                  <>
                    <PartyPopper size={12} />
                    시작하기
                  </>
                ) : (
                  <>
                    다음
                    <ChevronRight size={12} />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // 타겟 하이라이트 + 툴팁
  return (
    <>
      {/* 오버레이 */}
      <div className="fixed inset-0 bg-black/40 z-[998]" onClick={finish} />

      {/* 타겟 하이라이트 */}
      <HighlightBox target={currentStep.target} />

      {/* 툴팁 */}
      <div
        style={tooltipStyle}
        className="z-[1000] bg-white rounded-2xl shadow-2xl border border-gray-100 p-5 animate-in fade-in duration-200"
      >
        {/* 화살표 */}
        <div style={arrowStyle} className={`absolute w-0 h-0 ${arrowClasses[arrowDir]}`} />

        {/* 닫기 */}
        <button onClick={finish} className="absolute top-3 right-3 p-1 hover:bg-gray-100 rounded-lg">
          <X size={14} className="text-gray-400" />
        </button>

        {/* 내용 */}
        <p className="text-xs text-primary-600 font-semibold mb-1">{step + 1} / {TOUR_STEPS.length}</p>
        <h4 className="text-sm font-bold text-gray-900 mb-1.5">{currentStep.title}</h4>
        <p className="text-xs text-gray-600 leading-relaxed mb-4">{currentStep.description}</p>

        {/* 버튼 */}
        <div className="flex items-center justify-between">
          <button onClick={finish} className="text-xs text-gray-400 hover:text-gray-600">
            건너뛰기
          </button>
          <div className="flex gap-2">
            {step > 0 && (
              <button
                onClick={prev}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                <ChevronLeft size={12} />
                이전
              </button>
            )}
            <button
              onClick={next}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors"
            >
              {isLast ? (
                <>
                  <PartyPopper size={12} />
                  시작하기
                </>
              ) : (
                <>
                  다음
                  <ChevronRight size={12} />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

function HighlightBox({ target }: { target: string }) {
  const [rect, setRect] = useState<DOMRect | null>(null)

  useEffect(() => {
    function update() {
      const el = document.querySelector(target)
      if (el) setRect(el.getBoundingClientRect())
    }
    update()
    const timer = setTimeout(update, 300)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update)
    }
  }, [target])

  if (!rect) return null

  const pad = 8
  return (
    <div
      className="fixed z-[999] rounded-2xl ring-4 ring-primary-400/50 pointer-events-none"
      style={{
        top: rect.top - pad,
        left: rect.left - pad,
        width: rect.width + pad * 2,
        height: rect.height + pad * 2,
        boxShadow: '0 0 0 9999px rgba(0,0,0,0.4)',
      }}
    />
  )
}
