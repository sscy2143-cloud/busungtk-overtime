# T5 SQL v2 로컬 시험 — PGlite (2026-11-03 실행 결과)

> 운영 Supabase 에는 아무것도 실행하지 않았다. 시험은 메모리 PostgreSQL(PGlite 0.5.14 = PostgreSQL 18.6 WASM) 에서만 돈다.
> 실행: `npx vitest run src/features/trip/db` (전체 테스트에 포함됨). 의존성: `@electric-sql/pglite`(devDependency, 사용자 승인 11-03).

## 1. 환경 조사 (읽기 전용, 11-03)

| 항목 | 상태 |
|---|---|
| PostgreSQL 설치·서비스, Docker, WSL 배포판, Supabase CLI | 없음 |
| Node 22.22 / npm 10.9 | 있음 |
| 채택 | **PGlite** — npm 개발 의존성 약 26 MB, Windows 서비스·관리자 권한 없음, 프로젝트 폴더 안에만 |
| 대안(미채택) | 공식 설치 프로그램(서비스 추가), 휴대용 zip, Docker+`supabase start`(가장 정확, 수 GB), 임시 Supabase 프로젝트(생성 금지) |

## 2. 구성

- `000_local_shim.sql` — Supabase 가 기본으로 주는 것을 흉내: 역할 `anon`/`authenticated`/`service_role`, `auth.uid()`(세션 설정값 `request.jwt.claim.sub`), `is_manager_or_admin()`, `update_updated_at_column()`, 최소 `employees`·`overtime_requests`, 시험용 직원. **운영에서 실행 금지.**
- `src/features/trip/db/__tests__/t5-sql.test.ts` — shim → 010 → 020 → 030 → 040 적용 → 시나리오 → 900 롤백 → 재적용. 서버 계산은 `api/trip-compute` 와 같은 함수(`computeClaimDays`)로 만들어 `trip_store_server_calcs` 에 넣는다.
- 역할 흉내: `set role authenticated` + 세션 설정으로 RLS·EXECUTE 권한을 직접 평가. service_role 은 `request.jwt.claims` 의 `role` 값으로.

## 3. 결과 — 33건 통과 (11-03)

| 구분 | 확인한 것 | 결과 |
|---|---|---|
| 적용 | 010·020·030·040 순서 적용, 표 12개 RLS 켜짐, 공개 RPC·저장 RPC·스위치 함수 존재, 정책 19개(전부 SELECT, 쓰기 정책 0), 트리거(계산 불변·검토 calc 소속) | 통과 |
| 시드 | `trip_active_rule_version()` = 서버 번들 `RULE_VERSION`, 지역 코드 유효성, 스위치 3개 모두 false | 통과 |
| 스위치 OFF | 직원 쓰기 `FEATURE_DISABLED`, 미로그인 `UNAUTHENTICATED`, 스위치 변경은 admin 만(`FORBIDDEN`), `payroll_apply` 는 RPC(`PAYROLL_LOCKED`)·직접 UPDATE(CHECK) 모두 불가, 이력 기록 | 통과 |
| 직원 흐름 | 작성(조회용 사본 칼럼), `DUPLICATE_DAY`·`DATE_OUT_OF_SCHEDULE`·`REGION_REQUIRED`, 타인 수정·취소·제출 `FORBIDDEN`, 옛 version `VERSION_CONFLICT`, 수정 시 version·revision 증가, 계산 없이 제출 `CALC_STALE_OR_UNTRUSTED`, 동행 초안(본인 제외·중복 skipped), 취소 후 같은 날짜 재작성 | 통과 |
| 서버 계산 저장 | `authenticated` 역할 EXECUTE 거부(permission denied), 내부 역할 검사 `FORBIDDEN`, `RULE_VERSION_MISMATCH`, 신청 version·근무일 revision `VERSION_CONFLICT`, 빈 집합·남의 근무일 `CALC_INCOMPLETE_SET`, `UNKNOWN_REGION`, 직원 아닌 computed_by `UNKNOWN_USER`, 조작 수치(출장 9h) 거부, 정상 저장(`engine_source=server`, revision 고정, `HOLIDAY_SOURCE_UNVERIFIED` 확인 표시 생성), 같은 계산 재저장은 새 행 없음 | 통과 |
| 제출·관리자 | 제출 후 `NOT_EDITABLE`, manager·직원 수정 `FORBIDDEN`, 사유 필수, revision·날짜 변경 검사, 수정 이력, 수정 뒤 옛 계산 승인 `CALC_STALE_OR_UNTRUSTED`, 재계산 뒤 옛 id 집합 `STALE_CALC`, 확인 표시 없이 `UNRESOLVED_FLAGS`, 사유 없는 반려 `REASON_REQUIRED`, `INVALID_ARGUMENT`, 승인 기록(calc id 묶음·claim_version)·표시 acknowledged, `SELF_REVIEW` | 통과 |
| 승인 뒤 잠금 | 근무일 UPDATE `LOCKED`, 계산 UPDATE/DELETE `IMMUTABLE`, 재저장 `NOT_EDITABLE`, 직원 취소 `NOT_CANCELLABLE`, 재검토 `NOT_SUBMITTED`, 남의 calc id 끼워 넣기 `REVIEW_CALC_MISMATCH` | 통과 |
| RLS | 직원 본인 건만, manager·admin 전부, anon 거부, 스위치 OFF 면 전원 0행 + 쓰기·저장 거부 | 통과 |
| 롤백·재적용 | 900 뒤 `trip*` 표·함수·정책·타입과 `holidays` 전부 없음, shim 객체는 유지, 010→040 재적용 성공 | 통과 |

### 로컬 시험에서 고친 것 (운영 적용 전 검토 대상)

| 파일 | 변경 | 이유 |
|---|---|---|
| `040_trip_rpc.sql` `trip_store_server_calcs` 2곳 | `if case when … then … else true end then` → `if (case … end) then` | plpgsql 의 `IF` 는 괄호 밖 첫 `THEN` 에서 조건식을 끝내므로 CASE 의 THEN 에서 잘려 "syntax error at end of input". **운영에서도 같은 오류로 040 전체가 실패했을 것** |
| `000_local_shim.sql` | `is_manager_or_admin()` 추가(표 뒤에 배치), pgcrypto 제거 | 030 `trip_can_view_all()` 이 부른다; `gen_random_uuid` 는 내장 |

010·020·030·900 은 수정 없이 통과했다.

## 4. 미검증 (PGlite 로는 볼 수 없음 — 운영 적용 전 별도 확인)

- **PostgREST 경유** 동작: RLS 0행 응답, 예외 → `message`=코드·`details`=안내 매핑, 401/403 코드. 로컬은 SQL 레벨에서만 봤다.
- **JWT 검증**과 Supabase 가 실제로 넣는 `request.jwt.claims` 내용(`role: service_role` 이 서비스 키 호출에 들어오는지) — 대조 체크리스트 **C-11**.
- 기존 운영 함수의 실제 정의: `is_manager_or_admin()`(C-7), `update_updated_at_column()`, `employees` 실제 칼럼·정책(C-6), `overtime_requests` 칼럼(C-10, anon 조회로 존재는 확인).
- Supabase 기본 권한(default privileges)으로 새 함수에 anon·authenticated EXECUTE 가 자동 부여되는지 — 040 이 명시적으로 revoke 하므로 결과는 같아야 하지만 C-8 에서 확인.
- 20260916 권한 체계(미적용)가 적용된 뒤의 `trip_can_view_all()` 대안 경로(C-2).

## 5. 운영 검토 사항 (기능상 문제 아님)

- 대체된 옛 계산의 확인 표시(`trip_review_flags`)는 `open` 으로 남는다. 승인 판정은 현재 계산만 보므로 영향 없지만, "미처리 표시 수" 집계를 만들 때는 최신 계산으로 한정해야 한다. 필요하면 후속 초안에서 옛 계산 표시를 자동 정리.
- `p_computed_by` 가 직원이 아니면 `UNKNOWN_USER` 로 거부된다(계약 2-2 검사 4 의 코드로 확정).
