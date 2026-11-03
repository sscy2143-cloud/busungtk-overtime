// ⚠ 초안. 의존성(@electric-sql/pglite)이 설치돼 있지 않아 지금은 돌지 않는다. 설치는 사용자 승인 후.
//   승인 뒤:  npm i -D @electric-sql/pglite   →   node docs/출장수당/T5-DB-초안/로컬시험/run-pglite.mjs
// 하는 일: 빈 PostgreSQL(WASM, 메모리) 에 000_local_shim → 010 → 020 → 030 → 040 적용 → 간단한 시나리오 → 900 롤백 → 재적용.
// 운영 DB 에는 절대 연결하지 않는다 (연결 문자열 자체가 없다).
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const draft = join(here, '..')
const EMP = '00000000-0000-0000-0000-000000000001'
const BOSS = '00000000-0000-0000-0000-000000000009'

async function main() {
  const { PGlite } = await import('@electric-sql/pglite')
  const db = new PGlite()   // 메모리. 디스크에 아무것도 남기지 않는다
  const run = async (label, sql) => {
    try { await db.exec(sql); console.log('OK   ', label) }
    catch (e) { console.log('FAIL ', label, '\n      ', String(e.message).split('\n')[0]); throw e }
  }
  const asUser = (uid, role = 'authenticated') => db.exec(`select set_config('request.jwt.claim.sub', '${uid}', false); select set_config('request.jwt.claims', '{"role":"${role}","sub":"${uid}"}', false);`)
  const expectCode = async (label, code, fn) => {
    try { await fn(); console.log('FAIL ', label, '— 예외가 나야 하는데 성공했다'); process.exitCode = 1 }
    catch (e) { const m = String(e.message); console.log(m.includes(code) ? 'OK   ' : 'FAIL ', label, `(${code})`, m.includes(code) ? '' : m.split('\n')[0]); if (!m.includes(code)) process.exitCode = 1 }
  }

  await run('000 shim', readFileSync(join(here, '000_local_shim.sql'), 'utf8'))
  for (const f of ['010_trip_tables.sql', '020_trip_feature_flags.sql', '030_trip_rls.sql', '040_trip_rpc.sql']) {
    await run(f, readFileSync(join(draft, f), 'utf8'))
  }

  // 스위치 OFF 상태에서 직원 호출 → FEATURE_DISABLED
  await asUser(EMP)
  await expectCode('OFF: trip_create_claim', 'FEATURE_DISABLED', () =>
    db.query(`select public.trip_create_claim($1::jsonb, $2::jsonb)`, [
      JSON.stringify({ regions: ['대전'], schedule: { kind: 'day', date: '2026-11-10' } }),
      JSON.stringify([{ date: '2026-11-10', site: { start: '08:00', end: '17:00' } }]),
    ]))

  // 스위치 ON (admin 만 가능) → 직원 작성 → 제출은 서버 계산이 없어 CALC_STALE_OR_UNTRUSTED
  await asUser(BOSS)
  await run('ON employee_form', `select public.trip_set_feature('employee_form', true, '로컬 시험')`)
  await asUser(EMP)
  const created = await db.query(`select public.trip_create_claim($1::jsonb, $2::jsonb) as r`, [
    JSON.stringify({ regions: ['대전'], schedule: { kind: 'day', date: '2026-11-10' } }),
    JSON.stringify([{ date: '2026-11-10', site: { start: '08:00', end: '17:00' } }]),
  ])
  const { id, version } = created.rows[0].r
  console.log('OK    trip_create_claim →', id, 'v' + version)
  await expectCode('제출(계산 없음)', 'CALC_STALE_OR_UNTRUSTED', () => db.query(`select public.trip_submit($1, $2)`, [id, version]))
  await expectCode('옛 version 수정', 'VERSION_CONFLICT', () => db.query(`select public.trip_update_draft($1, $2, null, null)`, [id, version + 5]))

  // 롤백 → 재적용
  await run('900 rollback', readFileSync(join(draft, '900_rollback.sql'), 'utf8'))
  for (const f of ['010_trip_tables.sql', '020_trip_feature_flags.sql', '030_trip_rls.sql', '040_trip_rpc.sql']) {
    await run(f + ' (재적용)', readFileSync(join(draft, f), 'utf8'))
  }
  await db.close()
  console.log(process.exitCode ? '\n실패 있음' : '\n전부 통과')
}

main().catch(() => { process.exitCode = 1 })
