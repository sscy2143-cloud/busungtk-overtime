/**
 * 급여대장에 올릴 직원: 재직자 전원 + 그 달 급여명세서가 있는 퇴직자.
 *
 * 퇴직 처리해도 지난 급여 기록은 연말정산 등에 필요하므로 목록·합계·엑셀에서 빠지면 안 된다.
 * 명세서가 없는 달에는 퇴직자를 올리지 않는다.
 */
export function ledgerEmployees<T extends { id: string; is_active: boolean }>(
  employees: T[],
  slipByEmployeeId: Record<string, unknown>,
): T[] {
  return employees.filter(e => e.is_active || !!slipByEmployeeId[e.id])
}
