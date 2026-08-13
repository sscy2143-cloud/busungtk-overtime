# 급여명세서(payslip) 생성기 — 작업 인계 문서

> 이 문서 하나만 읽고도 새 세션에서 바로 이어서 작업할 수 있도록 정리한 인계서입니다.
> **작업 대상 프로젝트: `busungtk-overtime` (근태관리 앱)** — 여기에 "급여명세서 생성기"를 새로 만든다.
> 작성일: 2026-08-11

---

## 0. 지금 해야 할 일 한 줄 요약
근태앱(busungtk-overtime)에 **급여명세서를 "만드는" 도구(생성기)** 를 추가한다.
지금은 외부 유료 툴로 PDF를 만들어 업로드만 하는데, 그 **생성 기능 자체를 앱 안에 구현**한다.
관리자가 급여 항목을 입력(야근·잔업 수당은 앱 데이터에서 자동) → 한국식 명세서 레이아웃으로 출력(화면·인쇄·PDF) → 직원이 조회.

**다음 액션(우선순위):**
1. 사용자에게 **기존 명세서 샘플(캡처/PDF)** 을 받아 지급·공제 항목 기본값/레이아웃을 맞춘다. (없으면 표준 한국식 + 항목 자유편집으로 시작)
2. **DB 마이그레이션 SQL을 사용자에게 주고 직접 실행**하게 한다. (아래 §5 참고, 근태앱은 스키마 변경 = 승인/분리 필수)
3. 코드 구현: 관리자 생성기 UI → 야근수당 자동연동 → 명세서 레이아웃/인쇄 → 직원 조회 렌더.

---

## 1. 프로젝트 개요 (busungtk-overtime)
- **무엇**: 부성티케이 야근/잔업/휴가/경비 통합 근태관리 시스템 (PWA). 직원 출퇴근·야근/잔업 신청·휴가·경비, 관리자 승인·연차·급여·급여명세서.
- **위치**: `C:\Users\user\busungtk-overtime`
- **스택**: React 19 + TypeScript + Vite 7 + Tailwind CSS v4 + Supabase(PostgreSQL) + PWA(vite-plugin-pwa) + Vercel Functions(`api/`).
- **인증**: Google 로그인(Supabase Auth). `src/contexts/AuthContext.tsx`에서 로그인+직원정보(employee) 관리. 권한: `employee`(일반) / `manager`(인사담당, 야근승인 제외) / `admin`(대표, 전체).
- **Git**: remote `https://github.com/sscy2143-cloud/busungtk-overtime.git`, 브랜치 **`master`**.
- **배포**: Vercel. 사용자가 말한 주소는 **https://busungtk-overtime-beta.vercel.app** (CLAUDE.md엔 busungtk-overtime.vercel.app로도 적혀 있음 — 실제 확인 필요).
- **명령어**: `npm run dev` / `npm run build` / `npm run lint`.
- **Supabase 인스턴스**: **`fgnkrhgbvohmxaetejyx` (busungtk-main = 공유 DB!)**. ⚠️ 스키마 변경 시 다른 프로젝트에 영향 → 반드시 신중/승인. 데모 모드: 환경변수 없으면 Proxy로 빈 데이터.

### 작업 규칙(중요 — 프로젝트 CLAUDE.md 발췌)
- 기존 기능/데이터 깨질 가능성 있으면 즉시 중단하고 보고.
- **보안/권한/RLS/시크릿, DB 스키마 변경(테이블/컬럼/인덱스/트리거), 마이그레이션은 승인 없이 진행 금지.**
- **DB/RLS 작업은 코드 작업과 분리** (SQL은 사용자가 직접 실행).
- 한 작업 = 하나의 목적, 수정 파일 최대 3개 지향. "겸사겸사 개선" 금지.
- 배포/commit/push는 사용자가 "끝났다"라고 할 때. 커밋 접두사: feat/fix/refactor/docs/chore.

---

## 2. 지금 급여명세서 기능의 현재 상태 (= 파일 업로드 방식)
현재는 **외부에서 만든 PDF를 업로드 → 직원이 조회**하는 구조. 급여 항목(기본급/수당/공제) 데이터는 저장하지 않음.

### 테이블: `payslips` (파일 기반)
컬럼(마이그레이션 종합):
- `id` UUID PK
- `employee_id` UUID → employees(id) ON DELETE CASCADE
- `period` TEXT ('YYYY-MM')
- `file_path` TEXT **NOT NULL** (storage 경로 `{employee_id}/{period}.{ext}`)
- `file_name` TEXT
- `uploaded_by` UUID → employees(id)
- `created_at` TIMESTAMPTZ
- `message` TEXT (전달 문구), `admin_note` TEXT (관리자 메모)
- `work_start` DATE, `work_end` DATE (실근로일 기간)
- **UNIQUE(employee_id, period)** — 직원·월당 1건
- RLS: `employees_see_own_payslips`(SELECT: employee_id = auth.uid()), `admin_manage_payslips`(ALL: role in admin/manager)
- Storage 버킷 **`payslips`** (Private, 수동 생성돼 있음)

관련 마이그레이션 파일: `supabase/migrations/`
- `20260306000006_create_payslips.sql`
- `20260311000000_add_payslip_message_fields.sql` (message, admin_note)
- `20260311000002_add_payslip_work_period.sql` (work_start, work_end)

### 페이지/라우트 (`src/App.tsx`)
- **`src/pages/AdminPayslipPage.tsx`** (약 417줄) — 관리자: 기간 선택, 직원별로 **PDF 파일 업로드**(storage `payslips` 버킷) + payslips row insert/삭제. 라우트: `/admin/payslips` (`<AdminRoute><PayPasswordGate>...`).
- **`src/pages/PayslipListPage.tsx`** (약 222줄) — 직원: 본인 명세서 조회. **본인확인(이메일 재입력)** 후 signed URL로 파일 보기/다운로드. 라우트: `/payslips`. 인터페이스: `{id, period, file_path, file_name, message, work_start, work_end}`.
- `src/pages/AdminPayrollPage.tsx` (약 335줄) — 급여(payroll) 별도 화면.
- 사이드바(`src/components/layout/Sidebar.tsx`): "급여 계산"(~line 301), "급여명세서"(~line 329) 링크.

### 야근/잔업 수당 데이터 출처 (자동연동에 사용)
- 테이블 **`overtime_requests`** (승인된 야근/잔업 신청).
- `src/pages/AdminOvertimePayPage.tsx` = "연장근무수당" 화면. `overtime_requests` 조회 + 시급 입력 → 수당 자동계산. 대체휴가 처리 건은 제외.
- 계산 유틸 **`src/utils/overtime-calc.ts`**: `calculateOvertimeBreakdown()`, `calculateEstimatedPay()`, `getPayMultiplier()`, `formatMinutes()`, 공휴일 상수/판정 등.
- → **급여명세서 자동연동**: 해당 직원·기간의 승인 야근/잔업을 조회해 수당 합계를 계산(위 유틸/페이지 로직 재사용)해서 "지급 항목"에 자동으로 채운다. (AdminOvertimePayPage의 계산 방식을 그대로 참고)

---

## 3. 확정된 요구사항 (사용자와 합의됨)
- **야근·잔업 수당**: **앱 데이터에서 자동으로 불러오기** (수정 가능).
- **4대보험·세금(공제 항목)**: **금액 직접 입력** (앱 자동계산 아님 — 요율/간이세액표 관리 안 함).
- **결과물**: **화면보기 + 인쇄/PDF 저장** (직원이 앱에서 본인 명세서 조회·다운로드). 카카오/이메일 발송은 추후.
- 항목은 **추가/삭제 자유**(지급·공제 라인 편집)로 만들어 회사 양식에 유연하게 맞춘다.

**아직 못 받은 것**: 기존 유료 툴의 명세서 **샘플(캡처/PDF)**. → 받으면 지급/공제 기본 항목·레이아웃을 그 양식에 맞춘다. (Desktop\claude-work 폴더에 넣어달라고 안내해둠. Desktop엔 명세서로 보이는 파일 없었음.)

---

## 4. 만들 계획 (설계)
### (a) DB 확장 — payslips에 구조화 급여 데이터 추가 (§5 SQL)
- `지급내역` JSONB (예: `[{"항목":"기본급","금액":2500000}, ...]`)
- `공제내역` JSONB (예: `[{"항목":"국민연금","금액":112500}, ...]`)
- `지급합계` INT, `공제합계` INT, `실지급액` INT
- `file_path`를 **NULL 허용**으로 변경 (생성형 명세서는 파일이 없음)
- (선택) `유형` TEXT DEFAULT 'file' — 'generated' | 'file' 구분(또는 file_path NULL 여부로 판별)
- RLS/UNIQUE/버킷은 그대로 유지.

### (b) 관리자 — 급여명세서 만들기 (AdminPayslipPage 확장 또는 새 탭)
- 직원 + 기간(YYYY-MM) 선택.
- **야근·잔업 수당 자동 채움**: overtime_requests 조회 + overtime-calc로 그달 수당 합계 → 지급 항목에 자동 추가(수정 가능).
- 지급 항목(기본급·식대 등) / 공제 항목(국민연금·건강보험·장기요양·고용보험·소득세·지방소득세 등) **행 추가/삭제** 입력.
- **지급합계·공제합계·실지급액 자동 계산**.
- 저장 → payslips upsert(employee_id+period UNIQUE, 구조화 컬럼 채움, file_path NULL).

### (c) 명세서 레이아웃 + 인쇄/PDF
- 공용 컴포넌트(예: `PayslipView`)로 한국식 명세서 렌더: 회사정보(주식회사 부성티케이 등), 직원정보(이름/부서), 근무기간(work_start~end), 지급 내역 표 / 공제 내역 표 / 실지급액, 하단 문구(message).
- **인쇄 버튼** → `window.print()` + 인쇄 전용 CSS(@media print)로 A4 한 장. (브라우저 인쇄=PDF 저장) — 별도 PDF 라이브러리 불필요. (원하면 나중에 html2canvas/jsPDF로 파일 저장·버킷 업로드 추가 가능)

### (d) 직원 조회 (PayslipListPage 확장)
- payslips row가 **생성형**(file_path NULL & 구조화 데이터 있음)이면 `PayslipView`로 렌더(인쇄/PDF).
- **업로드형**(file_path 있음)이면 기존대로 파일 signed URL. → 두 방식 공존.
- 본인확인(이메일 재입력) 흐름 유지.

---

## 5. DB 마이그레이션 SQL (사용자가 직접 실행 — 승인 후)
새 파일: `supabase/migrations/2026XXXXXXXXXX_payslip_generated_fields.sql`
```sql
-- 급여명세서 생성기: 구조화 급여 데이터 컬럼 추가 + 파일 없는 생성형 허용
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS 지급내역 JSONB;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS 공제내역 JSONB;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS 지급합계 INTEGER;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS 공제합계 INTEGER;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS 실지급액 INTEGER;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS 유형 TEXT DEFAULT 'file';
ALTER TABLE payslips ALTER COLUMN file_path DROP NOT NULL;
-- file_name도 생성형에선 없을 수 있음
ALTER TABLE payslips ALTER COLUMN file_name DROP NOT NULL;
```
⚠️ **공유 DB(`fgnkrhgbvohmxaetejyx`)이므로**, 다른 프로젝트가 payslips를 쓰는지 확인하고, 반드시 사용자 승인 후 실행. RLS는 기존 정책 그대로(직원 본인 SELECT / admin·manager ALL).

---

## 6. 아직 안 끝난 것 / 다음에 할 일 (체크리스트)
- [x] 명세서 샘플 받음 (2026-08-11): `C:\Users\user\Desktop\신채영\...\김형진_26년_ 6월분 급여명세서.pdf`. 실제 회사 양식 확인 완료 — 아래 §4 레이아웃이 이 샘플 기준.
- [x] 마이그레이션 파일 생성 완료: `supabase/migrations/20260811000000_payslip_generated_fields.sql` (§5 SQL 그대로)
- [x] **마이그레이션 실행 완료** (2026-08-11, 사용자가 Supabase SQL Editor에서 직접 실행). anon key로 새 컬럼(지급내역/공제내역/지급합계/공제합계/실지급액/유형) 조회 성공으로 재확인함.
- [x] `PayslipView` 공용 컴포넌트(레이아웃) + 인쇄 CSS(@media print) — `src/components/payslip/PayslipView.tsx`. 헤드리스 Edge 스크린샷으로 샘플과 레이아웃 대조 확인 완료(2026-08-11). props: companyName/period/payDate/employeeName/department/position/hireDate/workStart/workEnd/payments/deductions/workStats/calcMethods/message. `DEFAULT_CALC_FORMULAS`로 연장·야간·휴일수당 산출식 문구 export.
- [x] AdminPayslipPage: **생성기 UI** 추가 완료 (기존 파일 업로드/등록현황 탭 그대로 유지 + "명세서 생성" 탭 신설). `src/components/payslip/PayslipGeneratorPanel.tsx`.
  - 직원+기간 선택 → `overtime_requests`(승인분, 대체휴가 제외) 집계해 연장/야간/휴일수당 자동 채움(AdminOvertimePayPage와 동일 배율 로직) → 지급/공제 항목 자유 편집(추가/삭제) → 하단에 `PayslipView`로 실시간 미리보기.
  - 이미 파일 업로드형 명세서가 있는 직원·기간에 저장 시 경고 문구 표시 + 저장하면 기존 파일 삭제 후 생성형으로 대체(payslips는 직원+기간당 1건 UNIQUE 제약).
  - 저장 전 `payslips` 테이블에 `유형` 컬럼 존재 여부를 체크해서, **마이그레이션 미실행 시 저장 버튼 대신 경고 배너**를 보여줌(안전장치).
  - 근로시간 통계 중 연장/야간/휴일은 자동, **총근무일수/총근로시간/기본근로시간/휴가/기타는 수동 입력**(이 앱에 근태 집계 데이터가 없어서 자동화 범위 밖).
  - 급여지급일은 "익월 15일" 관례로 자동 계산(수정 가능, DB에 별도 저장 컬럼 없음 — 매번 계산).
  - `npx tsc --noEmit`, `npm run build` 통과 확인. `npm run lint`은 새 코드 기준 새로 추가된 에러 없음(레포 전역에 이미 있던 `react-hooks/set-state-in-effect` 룰 위반 패턴 1건만 기존 관행과 동일하게 남음).
  - **⚠️ 실제 로그인 후 브라우저로 끝까지 테스트는 못 함** — Google 로그인 + PayPasswordGate 비밀번호가 필요해서 이 세션에서는 헤드리스로 인증을 통과할 수 없었음. 사용자가 직접 `/admin/payslips` → "명세서 생성" 탭에서 확인 필요.
- [x] **PayslipListPage(직원용 조회) 작업 범위 제외 확정** (사용자 결정, 2026-08-11): 직원에게는 신채영이 생성한 명세서를 PDF로 직접 추출해서 카톡/메일 등으로 전달할 예정 — 앱 내 직원 조회 화면에 생성형 명세서를 노출할 필요 없음. **신채영(관리자) 계정에서 "명세서 생성" 탭 확인·인쇄만 되면 충분.**
  - 안전장치로 `PayslipListPage.tsx`의 직원용 쿼리에 `.not('file_path', 'is', null)` 추가함 — 생성형(file_path NULL) 명세서가 직원 목록에 뜨다가 "보기" 눌렀을 때 아무 반응 없는 깨진 상태로 보이는 걸 방지. 기존 파일 업로드형 직원 조회 동작은 그대로 유지됨.

### ✅ 해결됨: Supabase 프로젝트 확인 완료 (2026-08-11)
`vercel env pull --environment=production`으로 실제 Vercel 프로덕션 환경변수를 직접 확인한 결과, `VITE_SUPABASE_URL`은 로컬 `.env`와 동일한 **`https://wvwbaqyxztgcrkiacvql.supabase.co`**. 즉 실제 운영 DB는 **`wvwbaqyxztgcrkiacvql`**이 맞고, 이 문서 §1과 프로젝트 `CLAUDE.md`에 적힌 `fgnkrhgbvohmxaetejyx` (busungtk-main)는 **오래된/잘못된 정보**였음. → 마이그레이션은 `wvwbaqyxztgcrkiacvql` 프로젝트의 Supabase 대시보드에서 실행하면 됨. (CLAUDE.md의 잘못된 ref는 아직 안 고침 — 필요시 별도 수정)
- [ ] 회사 기본정보(상호/사업자번호/대표 등) 표기 소스 결정(하드코딩 or 설정). cost-manager엔 부성티케이 정보 있음: 등록번호 134-86-55063, 상호 주식회사 부성티케이, 대표 신동억, 주소 경기도 수원시 영통구 신원로211번길 24 (매탄동) 1층, 도매·제조·서비스/주방기구·시설물관리, 031-293-0471.
- [ ] (추후) 카카오/이메일 발송, PDF 파일 저장·버킷 업로드.

### 검증/배포 방법(근태앱)
- 로컬: `npm run dev`. 빌드: `npm run build`(성공 확인). 린트: `npm run lint`.
- 배포는 사용자 승인 후 `git push origin master` → Vercel 자동배포.
- 커밋 메시지 접두사: feat/fix/refactor 등. (cost-manager에선 `Co-Authored-By: Claude Opus 4.8` 붙였음 — 근태앱도 동일 가능)

---

## 7. (참고) 직전 세션에서 한 작업 — **다른 프로젝트: cost-manager (세금계산서 앱)**
> 급여명세서와는 별개 프로젝트지만 "지금까지 우리가 한 작업"이라 참고로 남김. 새 세션의 급여명세서 작업엔 직접 관련 없음.
- 프로젝트: `C:\Users\user\Documents\cost-manager` (Next.js 16 App Router + Supabase). repo `sscy2143-cloud/busungtk-expense`, 브랜치 `main`, 배포 **busungtk-expense.vercel.app**. Supabase host `hofamerjcpufzvxlxvil`.
- ⚠️ AGENTS.md: "This is NOT the Next.js you know" — Next 16, 필요시 `node_modules/next/dist/docs/` 참고.
- 이번 세션 주요 변경(요지):
  - 직원 세금계산서 확인화면(`src/app/employee/page.tsx`): 첫사용 튜토리얼 모달, 카드 상단 비율 개선, 필터 파란 채우기+테두리, 목적 드롭다운 전용, 납품건 추가/삭제, 증빙 직접 업로드+무료 OCR(tesseract.js+pdfjs-dist), 납품처 관리자식 드롭다운(거래횟수), 상위분류 담당자 미지정/지정 1×2 버튼(확인 전까지 freeze), 입력 교차/유실 버그 수정(deliveryEditsRef ref 기반), 납품처 드롭다운 stale 오버레이 오클릭 수정(스크롤 닫기), "명세표에서 가져오기"(attachFromStatement), 증빙 납품건별 idx + 삭제(✕), 확인자명 표시.
  - 공용 `src/app/_components/DeliveryStatementRegisterModal.tsx`: 증빙 추가=거래명세표 등록 팝업(품목 입력), AI 자동채우기(관리자만)+무료 OCR, 연동 계산서에도 증빙 첨부, 공급자상호 세금계산서 기준 드롭다운(supplierNames=getAllSupplierNames), **납품처 다중선택(+금액 합산, 납품처별내역)**.
  - `src/app/_components/InvoiceDetailModal.tsx` 신설: 목록 행 클릭→정보|증빙 1×2 팝업. 적용: purchases, vendor-history(보기버튼), payment-confirm, statement-status(전용 DS 팝업).
  - 월매입(`src/app/admin/monthly-purchase/page.tsx`): 행클릭 상세팝업, 엑셀 파일명 `_YYMMDD`+같은날 `_v2/_v3`, 계좌 예금주+상호불일치(⚠) 표기(`src/lib/accounts.ts` matchAccount, 대동샤링 계좌 추가).
  - 입금 매칭(`src/app/admin/payment-confirm/page.tsx`): 이미처리 분리, 은행파일 파서 확장(이체/처리 등)+HTML위장 .xls DOMParser 파싱+0건 진단 표시.
  - 거래처 히스토리(`src/app/admin/vendor-history/page.tsx`): 인라인 편집(updateDeliveryLine 신설).
  - 매입 현황(`src/app/admin/status/page.tsx`): 증빙 첨부 "이 건/전체 공통" 상황별 자동 정리.
  - 신규 서버액션: `createDeliveryStatementByEmployee`, `linkStatementsToInvoiceByEmployee`, `updateDeliveryLine`, `getAllSupplierNames`(vendors.ts).
- cost-manager는 이번 요청들 전부 배포 완료(Ready) 상태. 추가 대기 작업 없음(급여명세서로 넘어옴).

---

## 8. 새 세션 시작 시 추천 첫 발화
"근태앱(busungtk-overtime)에 급여명세서 생성기 만들 거야. `PAYSLIP_HANDOFF.md` 읽고, 먼저 AdminPayslipPage.tsx / PayslipListPage.tsx / AdminOvertimePayPage.tsx / overtime-calc.ts 를 확인한 다음, DB 마이그레이션 SQL부터 정리해줘. 명세서 샘플은 (있으면) 줄게 / 없으면 표준 양식으로."
