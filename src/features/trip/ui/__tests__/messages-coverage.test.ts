/** 서비스·저장소가 돌려주는 오류 코드는 전부 화면 안내(제목)가 있어야 한다 — 없으면 내부 값(예: "claim-1")이 그대로 사용자에게 보인다 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { describeError } from '../messages'

const dataDir = path.resolve(__dirname, '../../data')
const codesIn = (file: string, re: RegExp) => [...new Set([...fs.readFileSync(path.join(dataDir, file), 'utf8').matchAll(re)].map((m) => m[1]))]

describe('오류 코드 → 안내 문구', () => {
  const repo = codesIn('repository.ts', /new RepoError\('([A-Z_]+)'/g)
  const service = codesIn('service.ts', /fail\('([A-Z_]+)'/g)
  it('코드를 하나 이상 찾았다 (정규식이 깨지지 않았는지)', () => { expect(repo.length).toBeGreaterThan(5); expect(service.length).toBeGreaterThanOrEqual(15) })
  it.each([...repo, ...service])('%s 는 일반 문구("처리하지 못했습니다")로 떨어지지 않는다', (code) => {
    expect(describeError(code, 'raw').title).not.toBe('처리하지 못했습니다')
  })
})
