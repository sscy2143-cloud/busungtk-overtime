/**
 * T6 — 실제 연결 계층. 화면은 TripClientService 만 안다.
 *  - createTripClient(backend, opts): 서버 RPC·RLS 조회·서버 계산 호출 (거울 저장소)
 *  - createFetchBackend(opts): PostgREST + /api/trip-compute 를 fetch 로 부르는 TripBackend
 *  - fromMemoryService(guarded): 메모리 서비스를 같은 모양으로 (테스트·샌드박스)
 */
export type { ComputeSummary, SyncInfo, TripClientService, TripReadKey, TripWriteKey } from './types'
export type { SelectQuery, TripBackend } from './backend'
export { createTripClient, type TripClientOptions } from './trip-client'
export { fromMemoryService } from './memory-client'
export { buildSelectUrl, createFetchBackend, mapPostgrestError, type FetchBackendOptions } from './fetch-backend'
