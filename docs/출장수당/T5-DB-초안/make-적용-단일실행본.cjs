// 적용-머리.sql + 005·010·020·030·040 원본 + 적용-꼬리.sql 을 그대로 이어 붙여 단일 실행본을 만든다.
// 사용: node docs/출장수당/T5-DB-초안/make-적용-단일실행본.cjs   (원본이 바뀌면 다시 만들고, 테스트가 일치 여부를 확인한다)
const fs = require('fs')
const path = require('path')
const dir = __dirname
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n')
const parts = ['005_employees_position.sql', '010_trip_tables.sql', '020_trip_feature_flags.sql', '030_trip_rls.sql', '040_trip_rpc.sql']
let out = read('적용-머리.sql')
for (const f of parts) {
  out += `\n-- ############################################################\n-- ## ${f} (원본 그대로)\n-- ############################################################\n`
  out += read(f).replace(/\s*$/, '\n')
}
out += read('적용-꼬리.sql')
fs.writeFileSync(path.join(dir, '적용-단일실행본-출장수당.sql'), out)
console.log('written', out.length, 'chars,', out.split('\n').length, 'lines')
