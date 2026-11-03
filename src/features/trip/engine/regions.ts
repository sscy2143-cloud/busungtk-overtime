/**
 * 지역별 표준 편도시간 (최종본 2절, 수원 영통 기준) — 확정값, 변경 금지
 *
 * 경기도는 시·군까지 구분한다. 경기 광주시(제외 지역)와 광주광역시(3시간)는 다른 코드다.
 */

export type RegionClass =
  | { kind: 'excluded' }
  | { kind: 'standard'; oneWayHours: 1 | 2 | 3 | 4 }
  | { kind: 'jeju' }

const GYEONGGI_SOUTH = [
  '수원', '성남', '용인', '안양', '안산', '화성', '평택', '오산', '시흥', '군포', '의왕',
  '과천', '광명', '부천', '하남', '광주', '이천', '여주', '양평', '안성', '김포',
] as const

const GYEONGGI_NORTH = [
  '고양', '파주', '의정부', '양주', '동두천', '포천', '연천', '남양주', '구리', '가평',
] as const

export const REGIONS: Readonly<Record<string, RegionClass>> = Object.freeze({
  서울: { kind: 'excluded' },
  인천: { kind: 'excluded' },
  ...Object.fromEntries(GYEONGGI_SOUTH.map((c) => [`경기:${c}`, { kind: 'excluded' }])),
  ...Object.fromEntries(GYEONGGI_NORTH.map((c) => [`경기:${c}`, { kind: 'standard', oneWayHours: 1 }])),
  충북: { kind: 'standard', oneWayHours: 1 },
  충남: { kind: 'standard', oneWayHours: 2 },
  세종: { kind: 'standard', oneWayHours: 2 },
  대전: { kind: 'standard', oneWayHours: 2 },
  강원: { kind: 'standard', oneWayHours: 2 },
  전북: { kind: 'standard', oneWayHours: 2 },
  경북: { kind: 'standard', oneWayHours: 3 },
  대구: { kind: 'standard', oneWayHours: 3 },
  광주광역시: { kind: 'standard', oneWayHours: 3 },
  전남: { kind: 'standard', oneWayHours: 3 },
  경남: { kind: 'standard', oneWayHours: 4 },
  울산: { kind: 'standard', oneWayHours: 4 },
  부산: { kind: 'standard', oneWayHours: 4 },
  제주: { kind: 'jeju' },
})

/** 표준 편도시간(분). 제외 지역은 0. 제주는 표준시간이 없으므로 호출하지 않는다 */
export function oneWayMinutes(region: RegionClass): number {
  return region.kind === 'standard' ? region.oneWayHours * 60 : 0
}
