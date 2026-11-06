/** 출장 기능 화면 스위치. 환경변수가 아니라 코드 상수로 두고, 켜는 것은 운영 반영 단계에서 결정한다 */
export const TRIP_FEATURE = Object.freeze({ employeeForm: false, adminReview: false })

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
