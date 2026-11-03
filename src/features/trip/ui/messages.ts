/**
 * 서비스 오류 코드 → 화면 안내. 코드 값은 바꾸지 않고 문구와 "다음에 할 일"만 정한다.
 */

export type ErrorAction = 'reload' | 'fix_input' | 'login' | 'none'

export interface ErrorNotice {
  title: string
  detail: string
  action: ErrorAction
}

const KNOWN: Record<string, { title: string; action: ErrorAction; hint?: string }> = {
  VERSION_CONFLICT: { title: '다른 곳에서 먼저 저장되었습니다', action: 'reload', hint: '다른 기기나 관리자가 이 신청을 먼저 고쳤습니다. 새로 불러온 뒤 다시 입력하세요. 지금 화면의 입력은 저장되지 않았습니다' },
  STALE_CALC: { title: '화면을 연 뒤 계산 결과가 바뀌었습니다', action: 'reload', hint: '새로 불러온 뒤 바뀐 값을 확인하고 다시 검토하세요' },
  DUPLICATE_DAY: { title: '같은 날짜에 이미 신청이 있습니다', action: 'fix_input', hint: '기존 신청을 고치거나 취소한 뒤 다시 시도하세요' },
  DUPLICATE_DATE: { title: '같은 날짜를 두 번 입력했습니다', action: 'fix_input' },
  DATE_OUT_OF_SCHEDULE: { title: '출장 일정 밖의 날짜입니다', action: 'fix_input' },
  INVALID_DATE: { title: '날짜가 올바르지 않습니다', action: 'fix_input' },
  REGION_REQUIRED: { title: '지역을 고르세요', action: 'fix_input' },
  NO_DAYS: { title: '근무일을 하나 이상 입력하세요', action: 'fix_input' },
  INCOMPLETE: { title: '입력이 더 필요한 날이 있습니다', action: 'fix_input', hint: '각 날짜 카드의 질문에 답하면 제출할 수 있습니다' },
  NOT_EDITABLE: { title: '지금은 고칠 수 없는 상태입니다', action: 'none' },
  NOT_CANCELLABLE: { title: '취소할 수 없는 상태입니다', action: 'none', hint: '승인된 신청의 정정은 관리자에게 요청하세요' },
  NOT_SUBMITTED: { title: '제출된 신청만 검토할 수 있습니다', action: 'none' },
  NOT_APPROVED: { title: '승인된 신청만 정산 대상입니다', action: 'none' },
  NOT_FOUND: { title: '신청을 찾을 수 없습니다', action: 'reload' },
  FORBIDDEN: { title: '권한이 없습니다', action: 'none' },
  SELF_REVIEW: { title: '본인 신청은 직접 검토할 수 없습니다', action: 'none', hint: '다른 관리자에게 검토를 요청하세요' },
  REASON_REQUIRED: { title: '사유를 입력하세요', action: 'fix_input' },
  UNRESOLVED_FLAGS: { title: '확인하지 않은 표시가 있습니다', action: 'fix_input', hint: '각 항목을 읽고 "확인"에 표시한 뒤 승인하세요' },
  CALC_ERROR: { title: '계산되지 않은 근무일이 있어 승인할 수 없습니다', action: 'fix_input', hint: '되돌려서 직원에게 입력을 요청하거나 관리자 수정으로 보완하세요' },
  DATE_CHANGE_NOT_ALLOWED: { title: '근무일 날짜는 바꿀 수 없습니다', action: 'fix_input' },
  FEATURE_DISABLED: { title: '출장수당 기능이 아직 열리지 않았습니다', action: 'none', hint: '도입 공지 후 사용할 수 있습니다' },
  // 서버 재계산 (계약-서버계산.md 4절)
  CALC_STALE_OR_UNTRUSTED: { title: '서버 계산이 아직 없거나 입력이 바뀌었습니다', action: 'reload', hint: '다시 계산한 뒤 제출·검토하세요' },
  RULE_VERSION_MISMATCH: { title: '규칙 버전이 맞지 않습니다', action: 'none', hint: '앱이 갱신되는 중입니다. 잠시 후 다시 시도하세요' },
  CALC_INCOMPLETE_SET: { title: '모든 근무일의 계산이 필요합니다', action: 'reload' },
  UNKNOWN_REGION: { title: '등록되지 않은 지역 코드입니다', action: 'fix_input' },
  CALC_INVARIANT: { title: '계산 결과가 검증을 통과하지 못했습니다', action: 'none', hint: '관리자에게 알려 주세요. 입력은 보존되어 있습니다' },
  CALC_DAY_MISMATCH: { title: '계산 결과가 이 신청의 것이 아닙니다', action: 'reload' },
  LOCKED: { title: '승인·반려·취소된 신청은 바꿀 수 없습니다', action: 'none' },
  REVIEW_CALC_MISMATCH: { title: '승인 대상 계산 결과가 이 신청의 것이 아닙니다', action: 'reload' },
  STORE_FAILED: { title: '서버에 저장하지 못했습니다', action: 'none', hint: '잠시 후 다시 시도하세요. 입력은 보존되어 있습니다' },
  BAD_REQUEST: { title: '요청 형식이 올바르지 않습니다', action: 'none' },
  UNKNOWN_USER: { title: '사용자를 확인할 수 없습니다', action: 'login' },
  UNAUTHENTICATED: { title: '로그인이 필요합니다', action: 'login' },
  ROLE_MISMATCH: { title: '권한 정보가 서버와 다릅니다', action: 'login' },
  VIEW_NOT_GRANTED: { title: '전체 출장 내역 조회 권한이 없습니다', action: 'none', hint: '필요하면 대표(admin)에게 조회 권한을 요청하세요' },
  INVALID_ARGUMENT: { title: '요청 값이 올바르지 않습니다', action: 'none' },
  NOT_ELIGIBLE: { title: '조회 권한 부여 대상이 아닙니다', action: 'none', hint: '역할이 manager 인 활성 직원만 전체 출장 내역 조회 권한을 받을 수 있습니다' },
}

export function describeError(code: string, message: string): ErrorNotice {
  const k = KNOWN[code]
  if (!k) return { title: '처리하지 못했습니다', detail: message, action: 'none' }
  return { title: k.title, detail: k.hint ?? message, action: k.action }
}

export const ERROR_ACTION_LABEL: Record<ErrorAction, string | null> = {
  reload: '새로 불러오기',
  fix_input: null,
  login: '다시 로그인',
  none: null,
}
