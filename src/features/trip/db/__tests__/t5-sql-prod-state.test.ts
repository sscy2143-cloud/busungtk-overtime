// 운영 상태 전제 재시험 — 006·007·011·012·013 이 이미 적용된 DB 에 005 → 010 → 020 → 030 → 040 을 적용한 뒤
// t5-sql.test.ts 의 전체 시나리오(직원·관리자 흐름, RLS, 권한, 롤백)를 그대로 다시 실행한다.
// 환경 변수는 t5-sql.test.ts 의 beforeAll 이 읽는다. 운영 DB 와 무관(로컬 PGlite).
process.env.TRIP_PROD_STATE = '1'
await import('./t5-sql.test')

export {}
