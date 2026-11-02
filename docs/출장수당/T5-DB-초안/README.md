# 출장수당 DB 설계 초안 (T5)

> ## ⚠ 실행 금지
> 이 폴더의 SQL 은 **초안**입니다. 어떤 DB 에도 실행하지 않습니다.
> - 근태관리 Supabase(`wvwbaqyxztgcrkiacvql`)는 사용자가 의도적으로 일시정지했습니다. 재개와 적용은 **사용자 승인 후**입니다.
> - `supabase/migrations/` 에 넣지 않았습니다. CLI 가 자동으로 실행할 수 있는 위치이기 때문입니다.
> - 스테이징 DB 가 없으므로, 적용할 때는 한 트랜잭션으로 묶고 롤백 SQL 을 먼저 검증합니다.

- 작성 2026-11-02 · 브랜치 `feature/trip-allowance` (작업 트리 `busungtk-overtime-trip`)
- 근거: `docs/출장수당/HANDOFF.md` 4·6·7·9·10·11절, `src/features/trip/data/{types,repository,service}.ts`, `src/features/trip/engine/{rules,regions}.ts`
- 범위: 신규 테이블·RLS·RPC. **기존 테이블은 무변경**, 급여(payslips·급여대장) 연결 없음.

## 파일과 적용 순서

| 순서 | 파일 | 내용 |
|---|---|---|
| 1 | `010_trip_tables.sql` | 신규 테이블 10개 + 최신 계산 뷰. 규칙 버전·지역 seed. 계산 결과 수정 금지 트리거 |
| 2 | `020_trip_feature_flags.sql` | 기능 스위치 테이블·이력, `trip_feature_enabled`, `trip_set_feature`(admin 전용) |
| 3 | `030_trip_rls.sql` | RLS. 직원 본인 SELECT, 관리자 전체 SELECT, 직접 쓰기 정책 없음 |
| 4 | `040_trip_rpc.sql` | 쓰기 RPC 7개 + 내부 보조 함수 |
| 되돌림 | `900_rollback.sql` | 위 전부를 역순 삭제. 기존 객체 무영향 확인 쿼리 포함 |
| 사전 | `대조-체크리스트.md` | Supabase 재개 뒤 읽기 전용으로 확인할 항목 (C-1 ~ C-9) |

적용할 때의 형태 (승인 뒤, SQL Editor 에서):

```sql
begin;
-- 010 → 020 → 030 → 040 순서로 붙여 넣기
-- 확인 쿼리 (아래 "적용 직후 확인")
commit;   -- 이상하면 rollback;
```

## 적용 전 선행 조건 체크리스트

1. [ ] **사용자 결정:** 근태관리 Supabase 프로젝트 재개 (무료 플랜 2개 제한 때문에 다른 프로젝트 정리 필요할 수 있음)
2. [ ] **읽기 전용 대조** (`대조-체크리스트.md`)
   - [ ] C-1 Postgres 15 이상 (`security_invoker` 뷰)
   - [ ] C-2 미커밋 마이그레이션 `20260907*` · `20260916*` · `20260921*` 적용 여부 → 관리자 판정 함수 결정
   - [ ] C-3 기존 RLS 정책 기준선 기록
   - [ ] C-4 `approval_history` 구조·FK (마이그레이션 파일에 정의 없음)
   - [ ] C-5 이름 충돌 (`holidays`, `trip_*`)
   - [ ] C-6 `employees.role` 값, `employees.id → auth.users` 연결
   - [ ] C-7 기존 함수 정의·권한
   - [ ] C-8 기본 GRANT 설정
   - [ ] C-9 직원 삭제 흐름 (`on delete restrict` 영향)
3. [ ] 대조 결과로 초안 수정 (특히 `trip_can_view_all()`, `holidays` 이름)
4. [ ] `900_rollback.sql` 을 같은 트랜잭션 안에서 "적용 → 롤백 → rollback;" 으로 한 번 검증 (데이터 없는 상태)
5. [ ] HANDOFF 10절 보안 정리 순서와 충돌하지 않는지 확인 (secpatch·master 미커밋분 병합 이후 적용 권장)
6. [ ] **사용자 승인**
7. [ ] 적용 뒤 기능 스위치는 모두 꺼진 상태로 둠. 켜는 것은 화면 준비 후 별도 승인

## 설계 요약

### 저장 구조 (types.ts 1:1)

| types.ts | 테이블 | 비고 |
|---|---|---|
| `TripClaimRecord` | `trip_claims` | `header` jsonb 원본 + 조회용 `regions`·`start_date`·`end_date` |
| `TripDayRecord` | `trip_claim_days` | `entry`(DayEntry) jsonb 원본 + 시각 칼럼(근무일 0시 기준 분, 다음 날은 1440 이상) |
| `DayEntry.actual` | `trip_actual_times` | 기록 전용 사본. 표준값 저장 안 함. revision 마다 1행 |
| `TripCalcRecord` | `trip_day_calcs` | INSERT 만. 4그룹 수치·값별 확정/제안 상태를 칼럼으로 뽑음 |
| `TripAdjustmentRecord` | `trip_adjustments` | 수정 전후 입력·사유. 수정·삭제 금지 |
| `TripReviewRecord` | `trip_reviews` | 승인 당시 `calc_ids` 배열 보존. 수정·삭제 금지 |
| `FlagDecision` | `trip_review_flags` + `trip_reviews.flag_decisions` | 확인 표시마다 1행, open → acknowledged 한 번만 |
| `RULE_VERSION`·`RULES` | `trip_rule_versions` | 미확정 규칙(E3~E7, N1, N2)은 `undecided` 상태로만 둠 |
| `REGIONS` | `trip_regions` | 47행 seed, 적용 기간 칼럼 |
| (공휴일) | `holidays` | `source`·`verified_at`·`verified_by` 없으면 검증 안 된 달력. seed 없음 |

### service.ts 규칙 → 서버 강제 위치

| 규칙 | 강제 위치 | 오류 코드 |
|---|---|---|
| 기능이 꺼져 있으면 거부 | 모든 쓰기 RPC 첫 줄 `trip_require_feature` | `FEATURE_DISABLED` |
| 역할은 서버에서 조회 | `_trip_actor_id()` + `employees.role` (auth.uid) | `UNAUTHENTICATED`, `FORBIDDEN` |
| 본인 건만 작성·수정·제출·취소 | 각 RPC | `FORBIDDEN` |
| 동시 수정 감지 | `trip_update_draft`·`trip_submit`·`trip_cancel` (version), `trip_admin_adjust_day` (revision) | `VERSION_CONFLICT` |
| 같은 직원·날짜 중복 금지 (진행 중 건끼리) | 부분 UNIQUE 인덱스 + RPC 사전 검사 | `DUPLICATE_DAY` |
| 입력 누락·계산 실패 시 제출 불가 | `trip_submit` | `INCOMPLETE` |
| 관리자 수정 사유 필수, 원본 보존 | `trip_admin_adjust_day` + CHECK 제약 | `REASON_REQUIRED` |
| 본인 건 승인 금지 | `trip_review` | `SELF_REVIEW` |
| 화면의 계산 결과에 승인 고정 | `trip_review` (최신 calc id 집합 비교) | `STALE_CALC` |
| 확인 표시 미처리 시 승인 불가 | `trip_review` | `UNRESOLVED_FLAGS` |
| 계산 결과 수정 불가 | `trip_day_calcs` 트리거 (UPDATE·DELETE·TRUNCATE) | `IMMUTABLE` |
| 제안값은 정산 보류 | 계산 행의 `*_status` 칼럼이 승인 후에도 그대로 | — (정산 단계에서 사용) |
| 급여 반영 금지 | `payroll_apply` 스위치 CHECK 제약으로 true 불가, 급여 테이블 연결 없음 | `PAYROLL_LOCKED` |

### 승인 권한

- 초안은 `employees.role = 'admin'`(대표)만 수정·검토할 수 있습니다. service.ts 의 `actor.role === 'admin'` 과 같습니다.
- 관리자 전체 조회는 `trip_can_view_all()` 한 곳에 모았습니다. 지금은 기존 `is_manager_or_admin()` 을 씁니다.
- 20260916 권한 체계가 운영에 적용됐다면 이 함수 본문만 `has_admin_permission('trip_view')` 로 바꿉니다.

## ⚠ 위험: 서버 재계산 없이 저장

계산 엔진은 TypeScript 입니다. 그래서 RPC 는 **클라이언트가 보낸 계산 결과를 서버에서 다시 계산하지 않고 저장**합니다.

- **위험:** 조작된 클라이언트가 입력과 맞지 않는 출장·연장 시간을 보낼 수 있습니다. RPC 는 형식, 규칙 버전 존재, 소속 근무일만 검사합니다.
- **이미 넣은 완화**
  - 계산 행의 입력 사본(`entry_snapshot`)은 클라이언트 값이 아니라 서버가 저장한 근무일 입력에서 복사합니다. 사후에 다시 계산해 대조할 수 있습니다.
  - 동행 초안의 복사 규칙은 서버 함수(`_trip_companion_copy`)로 강제합니다.
  - 관리자 승인이 반드시 필요하고, 승인 전 상태에서는 급여에 반영되지 않습니다.
- **권장 추가 완화 (T6·T7):** 관리자 검토 화면이 `entry_snapshot` 으로 엔진을 다시 돌려, 저장된 값과 다르면 승인을 막고 표시합니다.
- **근본 대안:** Supabase Edge Function(Deno)에서 같은 `engine/` 코드를 실행해 계산하고, 서비스 키로 저장합니다(`engine_source = 'edge'`). 엔진이 순수 함수라 이식은 쉽지만 배포 경로가 하나 늘어납니다. 급여 적용(6단계) 전에는 이 방식으로 바꾸는 것을 권장합니다.

## 기존 스키마와 충돌 가능성

| 항목 | 내용 | 대응 |
|---|---|---|
| `holidays` 이름 | 운영 DB 에 같은 이름이 있으면 010 이 실패함 (의도적으로 `if not exists` 안 씀) | C-5 확인 뒤 `trip_holidays` 로 변경 가능 |
| 직원 삭제 | 출장 테이블의 `employees` FK 는 `on delete restrict` (3년 보관). 직원을 물리 삭제하는 흐름이 있으면 막힘 | C-9 확인. 퇴직은 `is_active` 로 처리하는 것이 전제 |
| 권한 체계 이중화 | 20260916 적용 여부에 따라 관리자 판정 방식이 다름 | `trip_can_view_all()` 한 곳만 수정 |
| `approval_history` | 코드는 쓰지만 마이그레이션 파일에 정의가 없음. FK 미확인 | 출장은 `trip_reviews` 만 사용. C-4 뒤 결정 |
| 대리 입력 칼럼 이름 | 기존 `overtime_requests.entry_route`(20260907) vs 출장 `trip_claims.input_route` | 통합 승인함 설계 때 이름 맞추기 검토 |
| 마감일 | 기존 `overtime_requests.deadline_date`(20260907)와 같은 이름의 칼럼을 둠. 계산 규칙은 미연결 | K11 재사용 방식 결정 뒤 채움 |
| Supabase 기본 GRANT | 새 테이블에 anon·authenticated 권한이 자동 부여될 수 있음 | 030 에서 회수 후 SELECT 만 다시 부여 |
| CLAUDE.md 의 DB ID | `fgnkrhgbvohmxaetejyx` 로 잘못 적혀 있음 (HANDOFF 9절) | 적용 대상은 `wvwbaqyxztgcrkiacvql`. 문서 정정은 사용자 승인 후 |

## [미확인]·[미결정]으로 남긴 것

- 규칙 버전 시행일 (`effective_from = null`), 지역 seed 적용 시작일(임시 2026-10-26)
- 지역 적용 기간 겹침 방지 제약 (btree_gist 확장 필요)
- `DayEntry.actual` 의 "다음 날" 표현 없음 → 자정 넘긴 실제 도착 저장 불가. 타입 보강 필요
- 숙박 기간 상한 31일 (service.ts 에 없는 임시 방어)
- 승인 경로 2단계(인사담당 1차 → 대표 최종, K7)
- 관리자가 본인 건을 수정하는 것을 막을지
- 동행자끼리 서로의 건 조회 허용 여부
- 증빙·마감(K11) 검사, 동행자 알림(ot_notifications)
- 승인 취소(K5) RPC, 정산·월 마감(`payroll_periods`, `allowance_settlements`)은 후속 단계
- 규칙 버전이 근무일에 적용되는 버전인지 검사 (시행일 미정이라 존재만 검사)

## 적용 직후 확인 (읽기 전용)

```sql
-- 테이블 13개(뷰 포함)와 seed
select table_name from information_schema.tables
 where table_schema = 'public' and (table_name like 'trip\_%' or table_name = 'holidays') order by 1;
select count(*) from public.trip_regions;          -- 47
select key, enabled from public.trip_feature_flags; -- 모두 false

-- 직접 쓰기가 막혔는지: authenticated 권한 확인
select table_name, privilege_type from information_schema.role_table_grants
 where grantee = 'authenticated' and table_name like 'trip\_%' order by 1, 2;  -- SELECT 만 나와야 함

-- 기존 정책 수가 C-3 기준선과 같은지
select tablename, count(*) from pg_policies where schemaname = 'public'
 and tablename not like 'trip\_%' and tablename <> 'holidays' group by tablename order by 1;
```
