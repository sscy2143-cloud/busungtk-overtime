/**
 * 출장 기능 화면. 기존 앱(App.tsx, Sidebar, RequestPage, AdminApprovalsPage)과 연결하지 않는다 — 연결은 보류.
 * 띄우려면 TripScreenProvider 로 감싸고 EmployeeTripScreen / AdminTripReview 를 넣는다.
 */
export { TripScreenProvider, type TripScreenProviderProps } from './TripScreenProvider'
export { TripRemoteProvider, type TripRemoteProviderProps } from './TripRemoteProvider'
export { useTrip, type EmployeeOption, type TripScreenContext } from './context'
export { EmployeeTripScreen, WorkRequestEntry } from './EmployeeTripScreen'
export { TripClaimForm } from './TripClaimForm'
export { MyTripClaims } from './MyTripClaims'
export { AdminTripReview } from './admin/AdminTripReview'
export { ClaimReviewDetail } from './admin/ClaimReviewDetail'
