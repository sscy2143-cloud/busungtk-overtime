# 작업 기록: busungtk-overtime Supabase 전면 연동

## 기본 정보
- **누가**: 사장(CEO) 지시 → Claude (최 대리/executor) 실행, 유 서기 기록
- **언제**: 2026-02-26
- **프로젝트**: busungtk-overtime (근태관리 시스템)
- **배포**: https://busungtk-overtime.vercel.app

---

## 무엇을: 작업 내용

### Phase 1 — P0/P1: 핵심 페이지 Supabase 연동 (4개)
| 페이지 | 작업 내용 |
|--------|----------|
| `AdminPayrollPage` | 급여 계산 — 승인된 야근 데이터 조회, 수당 배율 적용, 시급 수정 기능 |
| `LeaveRequestPage` | 휴가 신청 — DB INSERT + 잔여 연차 조회 |
| `LeavePage` | 휴가 현황 — leave_balances + leave_requests 조회 |
| `TimesheetPage` | 근무 기록 — 승인된 야근 + time_records 연동 |

### Phase 2 — P2/P3: 대시보드 + 경비 (3개)
| 페이지 | 작업 내용 |
|--------|----------|
| `AdminDashboardPage` | 팀 주간 근무시간 계산 (이번주/지난주 비교) |
| `DashboardPage` | 개인 주간 근무시간 실데이터 연동 |
| `ExpensePage` | 경비 CRUD + expenses 테이블 신규 생성 |

### Phase 3 — 잔여 TODO 수정 (1개)
| 페이지 | 작업 내용 |
|--------|----------|
| `RequestPage` | 야근 제출 시 주간 누적시간 실데이터 연동 (48h 경고 활성화) |

### Phase 4 — RLS 권한 변경
- `employees` UPDATE 정책: `is_admin()` → `is_manager_or_admin()`
- 인사담당(manager)도 시급(hourly_wage) 수정 가능하도록 변경

### Phase 5 — 개발자 모드 실제 인증
- 기존: 로컬 상태만 설정 (프로덕션에서 데이터 접근 불가)
- 변경: `dev@busungtk.com` 실제 Supabase Auth 계정 생성
- `signInAsDemo` → async `signInWithPassword` 전환
- 프로덕션에서 비밀번호 `6325`로 admin 권한 전체 접근 가능

### Phase 6 — 휴가 종류 관리
- `leave_types` 테이블 신규 생성 (8종 초기 데이터 시드)
- `AdminLeaveTypesPage` CRUD 관리 페이지 신규 생성
- 라우터 + 사이드바 연결 (`/admin/leave-types`)

---

## 왜: 목적/배경
- 기존 시스템: 11개 페이지 중 5개만 Supabase 연동, 나머지는 TODO/더미 데이터
- 이번 작업으로 **전체 페이지 100% DB 연동 완료**
- 인사담당자에게 시급 관리 권한 위임 필요
- 개발자 모드가 프로덕션에서 실제 데이터 접근 필요
- 휴가 종류별 연차소비/부재일 기준을 관리자가 직접 설정할 수 있어야 함

---

## 어떻게: 수행 방법
- **울트라워크 모드**: 병렬 에이전트 4~5개 동시 실행으로 고속 구현
- P0/P1 → P2/P3 → 잔여 TODO 순서로 우선순위 기반 진행
- 각 단계마다 `npm run build` 통과 확인 후 커밋
- DB 마이그레이션은 `supabase db push --linked`로 즉시 적용
- 개발자 계정은 Supabase Auth REST API로 정상 생성 (직접 SQL INSERT는 GoTrue 호환 문제 발생하여 수정)

---

## 결과: 산출물

### 커밋 이력 (7건)
| 커밋 | 메시지 |
|------|--------|
| `d7ade4f` | feat: 급여계산/휴가신청/휴가현황/근태기록 Supabase 연동 |
| `c4fbbf2` | feat: 주간 근무시간 계산 + 경비 DB 연동 |
| `67872b4` | fix: 야근 제출 페이지 주간 근무시간 실데이터 연동 |
| `75c2410` | feat: 인사담당(manager) 시급 관리 권한 부여 |
| `0798a38` | feat: 개발자 모드(6325) 실제 Supabase 인증으로 전환 |
| `9391633` | feat: 휴가 종류 관리 페이지 추가 (leave_types CRUD) |
| `035c3b2` | fix: 개발자 모드 인증 수정 (Auth API로 재생성) |

### DB 마이그레이션 (4건, 모두 적용 완료)
| 파일 | 내용 |
|------|------|
| `20260226000000_expenses_table.sql` | expenses 테이블 + RLS |
| `20260226100000_allow_manager_update_wage.sql` | employees UPDATE 정책 변경 |
| `20260226110000_create_dev_admin_user.sql` | (직접 INSERT — 이후 수정됨) |
| `20260226120000_leave_types_table.sql` | leave_types 테이블 + 시드 데이터 |
| `20260226130000_fix_dev_user.sql` | 깨진 dev 계정 정리 |
| `20260226140000_confirm_dev_user.sql` | dev 계정 이메일 인증 + employee 등록 |

### 수정된 파일 목록 (13개)
- `src/pages/AdminPayrollPage.tsx` — 급여 계산 DB 연동
- `src/pages/LeaveRequestPage.tsx` — 휴가 신청 DB INSERT
- `src/pages/LeavePage.tsx` — 휴가 현황 조회
- `src/pages/TimesheetPage.tsx` — 근무 기록 DB 연동
- `src/pages/AdminDashboardPage.tsx` — 팀 주간시간 계산
- `src/pages/DashboardPage.tsx` — 개인 주간시간 계산
- `src/pages/ExpensePage.tsx` — 경비 DB 연동
- `src/pages/RequestPage.tsx` — 주간시간 TODO 수정
- `src/contexts/AuthContext.tsx` — 개발자 모드 실제 인증
- `src/pages/LoginPage.tsx` — async 핸들러
- `src/pages/AdminLeaveTypesPage.tsx` — **신규** 휴가 종류 관리
- `src/App.tsx` — 라우트 추가
- `src/components/layout/Sidebar.tsx` — 메뉴 추가

### 현재 상태
- **전체 페이지 Supabase 연동**: 11/11 (100%)
- **TODO 잔여**: 0건
- **빌드 상태**: 통과
- **배포 상태**: Vercel Production Ready
- **개발자 모드**: 프로덕션에서 정상 작동 확인

---

## 후속 조치
1. 인사담당자 온보딩 (직원 등록, 시급 설정, 연차 부여)
2. 전 직원 Google 로그인 가입 안내
3. 휴가 종류 기준 회사 정책에 맞게 최종 확인
