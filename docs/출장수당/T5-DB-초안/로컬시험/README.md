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

## 3. 결과 — 49건 통과 (11-03, 6차: D10 직급 변경 admin 전용 트리거 + list_all_employees 호환 확인)

**11-03 6차 — D10.** shim 에 운영 employees 정책·`is_admin()`·`list_all_employees()` 사본(레포 마이그레이션 기준, 운영 정의는 C-7 미검증)을 추가해 PostgREST 직접 UPDATE 를 `set role authenticated` 로 흉내 냈다. 005 에 `employees_position_guard()` BEFORE UPDATE OF position 트리거: 세션 사용자가 활성 admin 이 아니면 `POSITION_ADMIN_ONLY`(42501). 직원은 RLS 로 0행, 인사담당은 트리거로 거부, 같은 값 저장·다른 칼럼 수정은 통과, admin 정상. `list_all_employees()` 는 `returns setof employees` + `select *` 라 005 전후 모두 동작(칼럼 자동 포함). 905 가 트리거·함수도 지운다.

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

**11-03 2차(운영 대조 뒤) 변경**

| 파일 | 변경 | 이유 |
|---|---|---|
| `030_trip_rls.sql` | `trip_can_view_all()` = `employees.role='admin'` 활성 사용자 (기존 `is_manager_or_admin()` 미사용), 정책 `*_select_manager` → `*_select_admin` | manager 는 본인 건만 (사용자 기준). REST 직접 조회로 다른 직원 기록이 manager 에게 보이던 문제 제거 |
| `010_trip_tables.sql` | updated_at 트리거 함수 `trip_touch_updated_at()` 신설(파일 앞부분), 기존 `update_updated_at_column()` 미사용 | 운영 함수 정의·존재에 의존하지 않기 위해 |
| `900_rollback.sql` | 자료 존재 시 `ROLLBACK_BLOCKED_DATA_EXISTS`; `trip_touch_updated_at()` 제거 추가 | 신청 자료 손실 방지 |
| 테스트 | 정책 이름, manager 0행(claims·calcs·reviews·adjustments·flag_history), 트리거 함수가 전부 `trip_*`, `trip_can_view_all` 본문에 `is_manager_or_admin` 없음, 롤백 가드 | — |

020·040(1차 수정 뒤) 은 추가 수정 없이 통과했다.

**11-03 3차 — 전체 조회 권한 지정 (사용자 요구사항)**

| 파일 | 변경 |
|---|---|
| `020` | `trip_view_grants`(employee_id PK, granted_by, granted_at, note), `trip_view_grant_history`(append-only), `trip_view_grant_eligible(uuid)`(활성·position='팀장'·admin 제외 — 유일한 판정 지점), `trip_view_grant_candidates()`(admin 만, 같은 판정으로 후보 id), `trip_has_view_grant()`(행 + 유효성), `trip_set_view_grant(uuid, boolean, text)`(admin 만·사유 필수·본인 불가·후보 아니면 NOT_ELIGIBLE·변경 시 이력) |
| `030` | `trip_is_admin()` 분리, `trip_can_view_all() = trip_is_admin() or trip_has_view_grant()`, 새 표 RLS·정책 3개(본인 행·admin·이력 admin), 스위치 이력은 admin 만 |
| `900` | 새 표·함수 제거(이력 표는 트리거 함수보다 먼저) |
| 테스트 7건 | 부여 전 0행·대상 판정, admin 만·사유·본인·비활성 거부·직접 INSERT 거부, 부여 후 전체 조회·전파 없음·이력, 권한자의 쓰기 FORBIDDEN, 스위치 OFF 0행, 비활성화 즉시 차단, 회수 즉시 0행·이력 2건·이력 수정 불가 |

**11-03 5차 — 부여 대상 = 회사 직급 '팀장' (사용자 최종 지정).** 새 파일 `005_employees_position.sql`(employees.position text NULL + 공백 금지 제약, 기존 행 미변경) · `905_rollback_position.sql`(900 뒤에만, 값 있으면 멈춤). 020 `trip_view_grant_eligible = is_active and position='팀장' and role<>'admin'`, employees 트리거 `trip_view_grant_guard`(직급·활성·역할 변경 시 권한 행 삭제 + 이력 auto_revoke, 복원 없음), 이력 `changed_by` nullable. 테스트: 직급×역할 6조합, 자동 회수·재부여, 세션 없는 변경, 905 순서·자료 가드. 4차 기록은 아래(참고).
**11-03 4차 — 부여 대상을 role='manager' 로 제한 (당시 지시, 5차에서 대체).** 운영 `employees` 에 직급 칼럼은 없고(role·employee_type 뿐, manager_id 는 전부 null), 기존 앱에서 manager 는 '인사담당' 라벨이다. 사용자 결정에 따라 후보 = 활성 manager 만이고, role='employee' 는 `NOT_ELIGIBLE`. 030 `trip_view_grants_select_self` 도 유효할 때만 본인 행을 준다. 추가 테스트 2건(후보 목록 admin 만·역할 변경 시 즉시 차단). 직급 칼럼이 생기면 `trip_view_grant_eligible()` 만 좁힌다.

## 4. 미검증 (PGlite 로는 볼 수 없음 — 운영 적용 전 별도 확인)

- **PostgREST 경유** 동작: RLS 0행 응답, 예외 → `message`=코드·`details`=안내 매핑, 401/403 코드. 로컬은 SQL 레벨에서만 봤다.
- **JWT 검증**과 Supabase 가 실제로 넣는 `request.jwt.claims` 내용(`role: service_role` 이 서비스 키 호출에 들어오는지) — 대조 체크리스트 **C-11**.
- 기존 운영 함수의 실제 정의: `is_manager_or_admin()`(C-7), `update_updated_at_column()`, `employees` 실제 칼럼·정책(C-6), `overtime_requests` 칼럼(C-10, anon 조회로 존재는 확인).
- Supabase 기본 권한(default privileges)으로 새 함수에 anon·authenticated EXECUTE 가 자동 부여되는지 — 040 이 명시적으로 revoke 하므로 결과는 같아야 하지만 C-8 에서 확인.
- 20260916 권한 체계(미적용)가 적용된 뒤의 `trip_can_view_all()` 대안 경로(C-2).

## 5. 운영 검토 사항 (기능상 문제 아님)

- 대체된 옛 계산의 확인 표시(`trip_review_flags`)는 `open` 으로 남는다. 승인 판정은 현재 계산만 보므로 영향 없지만, "미처리 표시 수" 집계를 만들 때는 최신 계산으로 한정해야 한다. 필요하면 후속 초안에서 옛 계산 표시를 자동 정리.
- `p_computed_by` 가 직원이 아니면 `UNKNOWN_USER` 로 거부된다(계약 2-2 검사 4 의 코드로 확정).
