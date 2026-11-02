/** 출장 기능 화면 스위치. 환경변수가 아니라 코드 상수로 두고, 켜는 것은 운영 반영 단계에서 결정한다 */
export const TRIP_FEATURE = Object.freeze({ employeeForm: false, adminReview: false })

export * from './format'
export * from './labels'
export { formSections, visibleSections, type FormSection, type SectionKey } from './form-model'
export { buildDayPreview, type DayPreview, type PreviewRow } from './preview'
export { approvalBlockers, toReviewRow, type ReviewRow, type ReviewTotals } from './review-model'
