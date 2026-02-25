# busungtk-overtime - 근태관리 시스템

부성티케이 야근/잔업/휴가/경비 통합 근태관리 시스템 (PWA)

## 기술 스택
- **Frontend**: React 19 + TypeScript + Vite 7
- **Styling**: Tailwind CSS v4
- **Backend**: Supabase (PostgreSQL)
- **Auth**: Google 로그인 (Supabase Auth)
- **Charts**: Recharts
- **SMS**: Solapi (휴가 신청 시 사장님 알림)
- **PWA**: vite-plugin-pwa
- **Serverless**: Vercel Functions (`api/`)

## 프로젝트 구조
```
src/
├── components/
│   ├── admin/       # 승인카드, 팀 게이지
│   ├── common/      # 상태 뱃지
│   ├── layout/      # AppLayout, Header, Sidebar, BottomNav
│   └── overtime/    # 그룹선택, 주간게이지
├── contexts/        # AuthContext (Google 로그인 + 직원 정보)
├── lib/             # Supabase 클라이언트
├── pages/           # 15개 페이지
├── types/           # TypeScript 타입
└── utils/           # 날짜, 야근 계산
api/
└── notify-leave.ts  # 휴가 신청 SMS 알림 (Vercel Function)
supabase/
└── migrations/      # DB 스키마, RLS, RPC 함수
```

## 주요 기능

### 일반 직원
- 출퇴근 기록 (Timesheet)
- 야근/잔업 신청 및 목록 조회
- 휴가 신청 (연차, 반차, 특별휴가, 병가) + SMS 알림
- 경비 관리
- 대시보드, 알림

### 관리자 (인사담당/대표)
- 야근 승인/반려 (대표만 가능)
- 연차 부여/조정
- 급여 관리
- 사용자 관리 (admin 전용)
- 관리자 대시보드

### 권한 체계
- `employee`: 일반 직원
- `manager`: 인사담당 (야근 승인 제외)
- `admin`: 대표 (전체 권한, 야근 승인/반려/시간수정)

## 명령어
- `npm run dev` - 개발 서버
- `npm run build` - 프로덕션 빌드
- `npm run lint` - ESLint

## 배포
- **Vercel**: https://busungtk-overtime.vercel.app (Vite SPA + PWA + Serverless)

## Supabase
- **인스턴스**: `fgnkrhgbvohmxaetejyx` (busungtk-main 공유 DB)
- **Migration**: 6개 (초기 스키마, RLS 수정, RPC 함수, 연차 관리)
- **데모 모드**: 환경변수 없으면 Proxy로 빈 데이터 동작

## 환경변수
- `VITE_SUPABASE_URL` - Supabase URL
- `VITE_SUPABASE_ANON_KEY` - Supabase anon key
- `SOLAPI_API_KEY` - SMS API 키 (Vercel 환경변수)
- `SOLAPI_API_SECRET` - SMS API 시크릿 (Vercel 환경변수)
- `SOLAPI_SENDER` - SMS 발신번호 (Vercel 환경변수)
- `BOSS_PHONE` - 사장님 전화번호 (Vercel 환경변수)

---

## 부성티케이 프로젝트 생태계

| 레포 | 역할 | 스택 | 배포 |
|------|------|------|------|
| busungtk-equipment | 장비관리 포털 | React 19 + Vite + Supabase | Vercel |
| busungtk-asms | A/S 관리 시스템 | React 19 + Vite + Supabase | Vercel |
| busungtk-as-diagnosis | 설비 A/S 진단 도구 | Next.js 16 + Prisma + LibSQL | Vercel |
| busungtk-hub | 통합 운영 플랫폼 | Next.js 16 + Supabase SSR | Vercel |
| busungtk-control-tower | 통합 관제탑 | Next.js 16 + Supabase SSR + Recharts | Vercel |
| busungtk-portal | 업무 포털 | Static HTML | Vercel |
| busungtk-landing | B2B 랜딩페이지 | Static HTML | Vercel |
| busungtk-work-history | 작업 히스토리 | Static HTML + Chart.js | GitHub Pages |
| busungtk-daily-report | 일일 보고 | Next.js 16 + Supabase | Vercel |
| busungtk-order-tracker | 주문 추적 | React 19 + Vite + Google APIs | Vercel |
| busungtk-overtime | 근태관리 | React 19 + Vite + Supabase + PWA | Vercel |
| busungtk-marketing | 마케팅 | Next.js 16 + Recharts | Vercel |
| busungtk-sales-crm | CRM | React 19 + Vite + Supabase | Vercel |
| busungtk-sales-pipeline | 영업 파이프라인 | React 19 + Vite + Vitest | Vercel |
| busungtk-field-check | 현장 점검 | React 19 + Vite + Kakao Maps + PWA | Vercel |
| busungtk-kitchen-planner | 주방 설계 | React 19 + Vite + Konva | Vercel |
| busungtk-kitchen-simulator | 주방 시뮬레이터 | Python + Typer + Shapely | CLI |
| busungtk-purchase-data | 매입 데이터 | Python 스크립트 | 로컬 |
| busungtk-hvac-mentor | HVAC 멘토 | React 19 + Vite + Gemini AI | Vercel |
| busungtk-ai-ideation | AI 아이디에이션 | Documentation | GitHub |
| busungtk-supabase-types | 공유 타입 | TypeScript | npm |
| busungtk-ui | 공유 UI 라이브러리 | React + Tailwind | npm |

## 공통 운영 규칙

### 최우선 원칙
1. 기존 기능/데이터를 깨뜨릴 가능성이 있으면 **즉시 중단하고 보고**
2. 보안/권한/RLS/시크릿 관련 작업은 **승인 없이 진행하지 않음**
3. 한 번에 크게 바꾸지 않음 (**작게, 자주, 검증하며**)
4. 결정 권한은 항상 사용자에게 있으며 Claude는 실행 담당

### 수정 금지 영역 (승인 필수)
- `.env`, `.env.*` (API 키, DB 키)
- Supabase RLS 정책
- DB 스키마 변경 (테이블/컬럼/인덱스/트리거)
- 마이그레이션 파일
- auth 관련 핵심 흐름

### 작업 규칙
- 한 작업 = 하나의 목적, 수정 파일 최대 3개
- DB/RLS 작업은 코드 작업과 분리
- "겸사겸사 개선" 금지
- 작업 후 변경 사항을 자연어로 설명

### Supabase 안전 규칙
- **`fgnkrhgbvohmxaetejyx` (busungtk-main): 공유 DB — 스키마 변경 시 다른 프로젝트 영향도 반드시 확인**
- SQL 실행 시 왜 필요한지 쉽게 설명

### Git 규칙
- 커밋 메시지 접두사: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`
- 배포/push/commit은 사용자가 "작업 끝났다"라고 말할 때 진행
