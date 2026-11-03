# T5 SQL v2 로컬 시험 — 환경 조사와 준비 (2026-11-03)

> 조사 결과와 준비 파일만 있다. **아무것도 설치·실행하지 않았다.** 설치·실행은 사용자 승인 후.

## 1. 이 PC 에 지금 있는 것 (읽기 전용 확인)

| 항목 | 상태 |
|---|---|
| PostgreSQL 설치 (`psql`, `pg_ctl`, `C:\Program Files\PostgreSQL`) | 없음 |
| Windows 서비스 `postgres*` | 없음 |
| Docker Desktop / Podman | 없음 |
| WSL | 실행 파일은 있으나 배포판 없음 (`wsl -l` 빈 목록) |
| Supabase CLI | 없음 |
| Node 22.22 / npm 10.9 | 있음 |
| 다른 프로젝트의 `node_modules` 에 WASM Postgres(pglite) | 없음 |
| 디스크 여유 | 약 161 GB |

결론: **재사용할 수 있는 로컬 PostgreSQL 은 없다.** 어떤 선택지도 설치가 한 번은 필요하다.

## 2. 선택지 비교

| 선택지 | 설치 내용 | PC 영향 | 비용 | SQL 호환 | 비고 |
|---|---|---|---|---|---|
| **A. `@electric-sql/pglite`** (PostgreSQL 17 WASM, npm devDependency) | `npm i -D @electric-sql/pglite` 약 26 MB, **Windows 서비스·관리자 권한 없음**, 프로젝트 폴더 안에만 | 가장 작음. 삭제 = `npm uninstall` | 무료 | plpgsql·트리거·RLS·`gen_random_uuid` 지원. `pgcrypto` 확장 포함. **역할(`anon`/`authenticated`/`service_role`)은 직접 만든다** (0절 shim) | **권장**. vitest 에서 바로 돌릴 수 있어 010→040→900 을 자동 시험으로 남길 수 있다 |
| B. PostgreSQL 공식 설치 프로그램 (Windows) | 약 300 MB, **Windows 서비스 추가**, 관리자 권한 | 서비스 상주(중지 가능) | 무료 | 완전 | 설치·제거가 PC 상태를 바꾼다. 사용자 승인 필수 |
| C. 휴대용 PostgreSQL zip (EDB binaries) + `pg_ctl` 수동 기동 | 약 300 MB 압축 해제, 서비스 없음 | 폴더 하나, 실행 중에만 프로세스 | 무료 | 완전 | B 보다 가볍지만 수동 관리. 승인 필요 |
| D. Docker + `supabase start` | Docker Desktop(수 GB) + WSL 배포판 + 이미지 | 가장 큼 | 무료(개인) | **Supabase 와 동일**(auth 스키마·역할·PostgREST 포함) | 가장 정확하지만 설치 부담이 가장 크다 |
| E. 임시 Supabase 무료 프로젝트 | 설치 없음 | 없음 | 무료 플랜 활성 2개 제한 → 비용관리 Staging 이 Paused 인 지금은 1자리 있음 | 동일 | **프로젝트 생성 금지 지시**가 있으므로 제외. 필요하면 별도 승인 |

### 추천
**A(pglite)** 로 문법·순서·트리거·RPC 동작을 자동 시험하고, 운영 적용 직전에 **E 또는 D 로 한 번** Supabase 고유 부분(RLS 를 통한 PostgREST 호출, `request.jwt.claims` 의 service_role 판정 — 대조 체크리스트 C-11)을 확인한다. A 만으로 잡히지 않는 것은 아래 4절.

## 3. A 로 할 수 있는 것 (승인 뒤 바로)

1. `000_local_shim.sql` — Supabase 가 기본으로 주는 것을 흉내: 역할 3개, `auth.uid()`(세션 설정값에서 읽음), `update_updated_at_column()`, 최소 `employees`·`overtime_requests` 표, 시험용 직원 3명.
2. `010 → 020 → 030 → 040` 순서 적용 → 문법·의존 순서·CHECK·트리거 오류를 처음으로 잡는다.
3. 시나리오: `set request.jwt.claim.sub = '<직원 id>'` 로 직원·관리자를 바꿔 가며 RPC 호출 → `trip_create_claim` → (`trip_store_server_calcs` 는 `request.jwt.claims` 의 role 을 service_role 로 설정해 호출) → `trip_submit` → `trip_review`. 기대 코드(`FEATURE_DISABLED`, `VERSION_CONFLICT`, `CALC_STALE_OR_UNTRUSTED`, `STALE_CALC`, `SELF_REVIEW` …)가 `raise exception` 메시지로 오는지 확인.
4. `900_rollback.sql` 적용 → 다시 010 부터 → 되돌리기가 깨끗한지.
5. 위 전부를 vitest 한 파일(`src/features/trip/db/__tests__/t5-sql.test.ts`, 미작성)로 두면 SQL 을 고칠 때마다 다시 돈다.

실행 스크립트 초안: `run-pglite.mjs` (의존성이 없어 지금은 돌지 않는다. 승인 뒤 `npm i -D @electric-sql/pglite` 한 번).

## 4. A 로도 못 보는 것 (운영 적용 전에 따로 확인)

- RLS 가 **PostgREST 경유**로 적용되는 모습(행 0건 응답, 401/403 매핑) — pglite 에는 PostgREST 가 없다. 로컬 시험에서는 `set role authenticated` + `set request.jwt.claim.sub` 로 정책을 직접 평가한다.
- `trip_store_server_calcs` 의 service_role 판정(`current_setting('request.jwt.claims')`) — Supabase 의 키 체계와 같은 값이 오는지는 실제 프로젝트에서 C-11 로 확인.
- 기존 운영 함수 `update_updated_at_column()` 의 실제 정의, `employees` 의 실제 칼럼·정책, `approval_history` 구조 — 대조 체크리스트 C-2·C-4·C-6·C-7.
- `holidays` 표 이름 충돌 — 11-03 anon 조회로 **없음** 확인됨(C-5 일부 해소).
