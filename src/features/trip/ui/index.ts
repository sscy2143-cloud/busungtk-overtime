/** 출장 기능 화면 스위치. 환경변수가 아니라 코드 상수. 2026-11-25 사용자 지시로 켬 — 실제 동작은 서버 스위치(trip_feature_flags)도 켜져야 한다. 급여 반영은 이 스위치와 무관하게 항상 꺼짐 */
export const TRIP_FEATURE = Object.freeze({ employeeForm: false, adminReview: true })

export * from './format'
export * from './labels'
export { formSections, visibleSections, type FormSection, type SectionKey } from './form-model'
export { buildDayPreview, type DayPreview, type PreviewRow } from './preview'
export { approvalBlockers, toReviewRow, type ReviewRow, type ReviewTotals } from './review-model'
export { buildClaimDetail, type ClaimDetailView, type DayDetailView, type ReviewItemView } from './review-detail'
export {
  formReducer, initialFormState, previewDays, scheduleDates, scheduleProblem, submitBlockers,
  type DayDraftComputation, type FormAction, type SavedRef, type TripFormState,
} from './form-state'
export { ERROR_ACTION_LABEL, describeError, type ErrorAction, type ErrorNotice } from './messages'
export { collectPilotSystemRows, PILOT_KEY_LABEL, PILOT_STATUS_LABEL, type PilotCollect } from './pilot-model'
export { preCloseCheck, type PreCloseClaim, type PreCloseCode, type PreCloseItem, type PreCloseResult } from './preclose'
