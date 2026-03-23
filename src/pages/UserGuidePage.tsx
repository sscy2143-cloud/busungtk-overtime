import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Printer } from 'lucide-react'

export function UserGuidePage() {
  const navigate = useNavigate()

  return (
    <div className="space-y-4">
      {/* 헤더 (프린트 시 숨김) */}
      <div className="flex items-center justify-between print:hidden">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
            <ChevronLeft size={20} className="text-gray-500" />
          </button>
          <h1 className="text-xl font-bold text-gray-900">이용 가이드</h1>
        </div>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors"
        >
          <Printer size={16} />
          PDF 저장 / 인쇄
        </button>
      </div>

      {/* 가이드 본문 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 print:shadow-none print:border-0 print:p-0 max-w-4xl mx-auto">
        {/* 표지 */}
        <div className="text-center mb-12 print:mb-8 pb-8 border-b-2 border-primary-200">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-primary-50 rounded-2xl mb-4 print:hidden">
            <span className="text-3xl">📋</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">부성TK 근태관리 시스템</h1>
          <h2 className="text-lg font-semibold text-primary-600 mb-4">이용 가이드</h2>
          <p className="text-sm text-gray-500">
            Version 1.0 | {new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>

        {/* 목차 */}
        <section className="mb-10">
          <h2 className="text-lg font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">목차</h2>
          <ol className="space-y-1.5 text-sm text-gray-700 list-decimal list-inside">
            <li><a href="#sec1" className="hover:text-primary-600">시스템 접속 및 로그인</a></li>
            <li><a href="#sec2" className="hover:text-primary-600">대시보드 안내</a></li>
            <li><a href="#sec3" className="hover:text-primary-600">연장근무 신청</a></li>
            <li><a href="#sec4" className="hover:text-primary-600">근무 기록 확인</a></li>
            <li><a href="#sec5" className="hover:text-primary-600">휴가 신청</a></li>
            <li><a href="#sec6" className="hover:text-primary-600">경비 제출 및 수령확인</a></li>
            <li><a href="#sec7" className="hover:text-primary-600">급여명세서 확인</a></li>
            <li><a href="#sec8" className="hover:text-primary-600">공지사항 확인</a></li>
            <li><a href="#sec9" className="hover:text-primary-600">알림</a></li>
            <li><a href="#sec11" className="hover:text-primary-600">자주 묻는 질문 (FAQ)</a></li>
          </ol>
        </section>

        {/* 1. 시스템 접속 및 로그인 */}
        <section id="sec1" className="mb-10">
          <h2 className="text-lg font-bold text-gray-900 mb-3 pb-2 border-b border-gray-200">1. 시스템 접속 및 로그인</h2>
          <div className="space-y-3 text-sm text-gray-700 leading-relaxed">
            <h3 className="font-semibold text-gray-800 mt-4">1-1. 접속 방법</h3>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>웹 브라우저에서 <strong>busungtk-overtime.vercel.app</strong> 접속</li>
              <li>모바일(스마트폰)에서도 동일한 주소로 접속 가능 (PWA 지원)</li>
              <li>홈 화면에 추가하면 앱처럼 사용 가능 (Chrome: 메뉴 → "홈 화면에 추가")</li>
            </ul>

            <h3 className="font-semibold text-gray-800 mt-4">1-2. 로그인</h3>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>발급받은 <strong>사번</strong>과 <strong>비밀번호</strong>를 입력하여 로그인합니다</li>
              <li>최초 로그인 시 임시 비밀번호를 변경하는 화면이 표시됩니다</li>
              <li>새 비밀번호를 설정하면 정상적으로 사용 가능합니다</li>
            </ul>

            <h3 className="font-semibold text-gray-800 mt-4">1-3. 로그아웃</h3>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>좌측 사이드바 하단 또는 모바일 메뉴에서 "로그아웃" 클릭</li>
            </ul>
          </div>
        </section>

        {/* 2. 대시보드 */}
        <section id="sec2" className="mb-10">
          <h2 className="text-lg font-bold text-gray-900 mb-3 pb-2 border-b border-gray-200">2. 대시보드 안내</h2>
          <div className="space-y-3 text-sm text-gray-700 leading-relaxed">
            <p>로그인 후 가장 먼저 보이는 화면입니다. 주요 정보를 한눈에 확인할 수 있습니다.</p>

            <h3 className="font-semibold text-gray-800 mt-4">2-1. 금주 연장근무시간</h3>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>이번 주(월~일) 승인된 연장근무 시간을 게이지로 표시</li>
              <li>색상별 의미: 초록 → 노랑(8시간 이상) → 빨강(10시간 이상)</li>
            </ul>

            <h3 className="font-semibold text-gray-800 mt-4">2-2. 잔여 연차</h3>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>올해 총 연차 일수와 사용/잔여 일수를 확인</li>
              <li>게이지 바로 잔여 비율을 시각적으로 확인 가능</li>
            </ul>

            <h3 className="font-semibold text-gray-800 mt-4">2-3. 빠른 액션</h3>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li><strong>연장근무 신청</strong>: 야근/잔업 신청 페이지로 이동</li>
              <li><strong>휴가 신청</strong>: 연차/반차/특별휴가 등 신청 페이지로 이동</li>
              <li><strong>근무 기록</strong>: 출퇴근 기록 페이지로 이동</li>
            </ul>

            <h3 className="font-semibold text-gray-800 mt-4">2-4. 최근 제출</h3>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>최근에 제출한 연장근무/휴가 신청 내역 5건 표시</li>
              <li>승인 상태(대기/승인/반려)를 뱃지로 확인</li>
              <li>"전체 보기"를 클릭하면 전체 신청 내역 페이지로 이동</li>
            </ul>

            <h3 className="font-semibold text-gray-800 mt-4">2-5. 공지사항 / 급여명세서</h3>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>최근 공지사항 2건, 급여명세서 2건 미리보기</li>
              <li>"전체보기"를 클릭하면 전체 목록 페이지로 이동</li>
            </ul>

            <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 mt-3">
              <p className="text-xs text-blue-700">
                <strong>💡 팁:</strong> 수령 확인이 필요한 경비가 있으면 대시보드 상단에 알림 배너가 표시됩니다.
              </p>
            </div>
          </div>
        </section>

        {/* 3. 연장근무 신청 */}
        <section id="sec3" className="mb-10">
          <h2 className="text-lg font-bold text-gray-900 mb-3 pb-2 border-b border-gray-200">3. 연장근무 신청</h2>
          <div className="space-y-3 text-sm text-gray-700 leading-relaxed">
            <h3 className="font-semibold text-gray-800 mt-4">3-1. 신청 방법</h3>
            <ol className="list-decimal list-inside space-y-1 ml-2">
              <li>대시보드에서 <strong>"연장근무 신청"</strong> 버튼 클릭 또는 좌측 메뉴에서 "야근 신청" 선택</li>
              <li>근무 유형 선택: <strong>연장근무</strong>, <strong>야간근무</strong>, <strong>휴일근무</strong></li>
              <li>근무 날짜 선택 (캘린더에서 클릭)</li>
              <li>예정 시작/종료 시간 입력</li>
              <li>사유 입력 (필수)</li>
              <li>"신청" 버튼 클릭</li>
            </ol>

            <h3 className="font-semibold text-gray-800 mt-4">3-2. 근무 유형별 설명</h3>
            <table className="w-full text-xs border-collapse mt-2">
              <thead>
                <tr className="bg-gray-50">
                  <th className="border border-gray-200 px-3 py-2 text-left font-semibold">유형</th>
                  <th className="border border-gray-200 px-3 py-2 text-left font-semibold">설명</th>
                </tr>
              </thead>
              <tbody>
                <tr><td className="border border-gray-200 px-3 py-2">연장근무</td><td className="border border-gray-200 px-3 py-2">정규 근무시간 이후 추가 근무</td></tr>
                <tr><td className="border border-gray-200 px-3 py-2">야간근무</td><td className="border border-gray-200 px-3 py-2">22:00 ~ 06:00 사이 근무</td></tr>
                <tr><td className="border border-gray-200 px-3 py-2">휴일근무</td><td className="border border-gray-200 px-3 py-2">주말 또는 공휴일 근무</td></tr>
              </tbody>
            </table>

            <h3 className="font-semibold text-gray-800 mt-4">3-3. 승인 과정</h3>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>신청 즉시 <strong>"대기"</strong> 상태로 등록됩니다</li>
              <li>대표님이 승인/반려 처리합니다</li>
              <li>승인 결과는 알림으로 확인 가능합니다</li>
              <li>"대기" 상태일 때만 신청 취소가 가능합니다</li>
            </ul>

            <h3 className="font-semibold text-gray-800 mt-4">3-4. 신청 내역 확인</h3>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>좌측 메뉴 "신청 내역" 또는 대시보드 "전체 보기"에서 확인</li>
              <li>상태별 필터링 가능 (전체/대기/승인/반려)</li>
            </ul>
          </div>
        </section>

        {/* 4. 근무 기록 */}
        <section id="sec4" className="mb-10">
          <h2 className="text-lg font-bold text-gray-900 mb-3 pb-2 border-b border-gray-200">4. 근무 기록 확인</h2>
          <div className="space-y-3 text-sm text-gray-700 leading-relaxed">
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>좌측 메뉴 <strong>"근무 기록"</strong> 클릭</li>
              <li>월별 근무 기록을 표로 확인</li>
              <li>출근/퇴근 시간, 근무 시간, 연장근무 시간 확인</li>
              <li>월 선택으로 과거 기록 조회 가능</li>
            </ul>
          </div>
        </section>

        {/* 5. 휴가 신청 */}
        <section id="sec5" className="mb-10">
          <h2 className="text-lg font-bold text-gray-900 mb-3 pb-2 border-b border-gray-200">5. 휴가 신청</h2>
          <div className="space-y-3 text-sm text-gray-700 leading-relaxed">
            <h3 className="font-semibold text-gray-800 mt-4">5-1. 신청 방법</h3>
            <ol className="list-decimal list-inside space-y-1 ml-2">
              <li>대시보드 <strong>"휴가 신청"</strong> 버튼 또는 좌측 메뉴 "휴가" → "휴가 신청"</li>
              <li>휴가 유형 선택</li>
              <li>시작일/종료일 선택 (반차는 해당일만 선택)</li>
              <li>사유 입력</li>
              <li>"신청" 버튼 클릭</li>
            </ol>

            <h3 className="font-semibold text-gray-800 mt-4">5-2. 휴가 유형</h3>
            <table className="w-full text-xs border-collapse mt-2">
              <thead>
                <tr className="bg-gray-50">
                  <th className="border border-gray-200 px-3 py-2 text-left font-semibold">유형</th>
                  <th className="border border-gray-200 px-3 py-2 text-left font-semibold">차감</th>
                  <th className="border border-gray-200 px-3 py-2 text-left font-semibold">설명</th>
                </tr>
              </thead>
              <tbody>
                <tr><td className="border border-gray-200 px-3 py-2">연차</td><td className="border border-gray-200 px-3 py-2">1일</td><td className="border border-gray-200 px-3 py-2">종일 휴가</td></tr>
                <tr><td className="border border-gray-200 px-3 py-2">오전반차</td><td className="border border-gray-200 px-3 py-2">0.5일</td><td className="border border-gray-200 px-3 py-2">오전 중 휴가 (오후 출근)</td></tr>
                <tr><td className="border border-gray-200 px-3 py-2">오후반차</td><td className="border border-gray-200 px-3 py-2">0.5일</td><td className="border border-gray-200 px-3 py-2">오후 휴가 (오전만 근무)</td></tr>
                <tr><td className="border border-gray-200 px-3 py-2">기타</td><td className="border border-gray-200 px-3 py-2">별도</td><td className="border border-gray-200 px-3 py-2">경조사, 교육 등 특별휴가</td></tr>
              </tbody>
            </table>

            <h3 className="font-semibold text-gray-800 mt-4">5-3. 잔여 연차 확인</h3>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>대시보드 "잔여 연차" 카드에서 확인</li>
              <li>좌측 메뉴 "휴가"에서도 상세 내역 확인 가능</li>
            </ul>

            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mt-3">
              <p className="text-xs text-amber-700">
                <strong>⚠️ 참고:</strong> 휴가 신청 시 대표님에게 SMS 알림이 자동 발송됩니다.
              </p>
            </div>
          </div>
        </section>

        {/* 6. 경비 제출 */}
        <section id="sec6" className="mb-10">
          <h2 className="text-lg font-bold text-gray-900 mb-3 pb-2 border-b border-gray-200">6. 경비 제출 및 수령확인</h2>
          <div className="space-y-3 text-sm text-gray-700 leading-relaxed">
            <h3 className="font-semibold text-gray-800 mt-4">6-1. 경비 제출</h3>
            <ol className="list-decimal list-inside space-y-1 ml-2">
              <li>좌측 메뉴 <strong>"경비"</strong> 클릭</li>
              <li>"경비 신청" 버튼 클릭</li>
              <li>지출 날짜, 분류(식비/교통비/소모품/기타), 결제방법 선택</li>
              <li>금액 입력, 지출 내용 입력 (필수)</li>
              <li>증빙자료(영수증 사진) 첨부 (선택)</li>
              <li>"경비 제출" 버튼 클릭</li>
            </ol>

            <h3 className="font-semibold text-gray-800 mt-4">6-2. 경비 처리 과정</h3>
            <div className="bg-gray-50 rounded-xl px-4 py-3">
              <div className="flex items-center gap-2 text-xs text-gray-600 flex-wrap">
                <span className="px-2 py-1 bg-warning-50 text-warning-700 rounded font-semibold">제출(검토중)</span>
                <span>→</span>
                <span className="px-2 py-1 bg-success-50 text-success-700 rounded font-semibold">승인</span>
                <span>→</span>
                <span className="px-2 py-1 bg-primary-50 text-primary-700 rounded font-semibold">지급처리</span>
                <span>→</span>
                <span className="px-2 py-1 bg-success-100 text-success-800 rounded font-semibold">수령확인</span>
              </div>
            </div>

            <h3 className="font-semibold text-gray-800 mt-4">6-3. 수령확인</h3>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>관리자가 지급 처리를 완료하면 <strong>대시보드에 알림</strong>이 표시됩니다</li>
              <li>로그인 시 팝업 알림으로도 안내됩니다</li>
              <li>경비 목록에서 해당 항목을 클릭하면 상세 팝업이 열립니다</li>
              <li>지급 정보(금액, 지급일, 방식 등)를 확인 후 <strong>"수령 확인"</strong> 버튼을 클릭합니다</li>
              <li>수령 확인 시 확인 시간, 기기 정보가 자동으로 기록됩니다</li>
            </ul>

            <h3 className="font-semibold text-gray-800 mt-4">6-4. 취소 요청</h3>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>수령 확인 후에도 문제가 있으면 <strong>"취소 요청"</strong>이 가능합니다</li>
              <li>취소 사유를 입력하면 담당자에게 전달됩니다</li>
              <li>담당자 승인 후에만 취소가 처리됩니다 (직접 취소 불가)</li>
            </ul>
          </div>
        </section>

        {/* 7. 급여명세서 */}
        <section id="sec7" className="mb-10">
          <h2 className="text-lg font-bold text-gray-900 mb-3 pb-2 border-b border-gray-200">7. 급여명세서 확인</h2>
          <div className="space-y-3 text-sm text-gray-700 leading-relaxed">
            <h3 className="font-semibold text-gray-800 mt-4">7-1. 열람 방법</h3>
            <ol className="list-decimal list-inside space-y-1 ml-2">
              <li>대시보드 급여명세서 영역에서 <strong>"보기"</strong> 클릭 또는 <strong>"전체보기"</strong>로 이동</li>
              <li>보안을 위해 <strong>본인 인증</strong>이 필요할 수 있습니다</li>
              <li>인증 성공 후 급여명세서 목록을 확인할 수 있습니다</li>
            </ol>

            <h3 className="font-semibold text-gray-800 mt-4">7-2. 상세 보기</h3>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>"보기" 버튼(👁) 클릭 시 상세 팝업이 열립니다</li>
              <li><strong>왼쪽</strong>: 지급월, 실근로일, 파일명, 전달 문구, 다운로드 버튼</li>
              <li><strong>오른쪽</strong>: PDF/이미지 미리보기</li>
              <li>다운로드 버튼으로 파일을 저장할 수 있습니다</li>
            </ul>

            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mt-3">
              <p className="text-xs text-red-700">
                <strong>🔒 보안 안내:</strong> 급여명세서는 본인만 열람 가능합니다. 다른 직원의 명세서에는 접근할 수 없으며, 데이터베이스 및 파일 저장소 수준에서 완전 차단됩니다.
              </p>
            </div>
          </div>
        </section>

        {/* 8. 공지사항 */}
        <section id="sec8" className="mb-10">
          <h2 className="text-lg font-bold text-gray-900 mb-3 pb-2 border-b border-gray-200">8. 공지사항 확인</h2>
          <div className="space-y-3 text-sm text-gray-700 leading-relaxed">
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>대시보드에서 최근 2건의 공지사항을 미리보기할 수 있습니다</li>
              <li>"전체보기"를 클릭하면 모든 공지사항 목록으로 이동합니다</li>
              <li>공지사항을 클릭하면 상세 팝업이 열립니다</li>
              <li>첨부파일이 있는 경우 다운로드할 수 있습니다</li>
              <li>분류: <strong>공지</strong>(노란색), <strong>업데이트</strong>(파란색), <strong>긴급</strong>(빨간색)</li>
            </ul>
          </div>
        </section>

        {/* 9. 알림 */}
        <section id="sec9" className="mb-10">
          <h2 className="text-lg font-bold text-gray-900 mb-3 pb-2 border-b border-gray-200">9. 알림</h2>
          <div className="space-y-3 text-sm text-gray-700 leading-relaxed">
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>상단 헤더의 종 아이콘(🔔)을 클릭하면 알림 목록을 확인할 수 있습니다</li>
              <li>신청 승인/반려, 경비 처리 등의 알림이 표시됩니다</li>
              <li>읽지 않은 알림은 빨간 점으로 표시됩니다</li>
            </ul>
          </div>
        </section>

        {/* 11. FAQ */}
        <section id="sec11" className="mb-6">
          <h2 className="text-lg font-bold text-gray-900 mb-3 pb-2 border-b border-gray-200">11. 자주 묻는 질문 (FAQ)</h2>
          <div className="space-y-4 text-sm text-gray-700">
            {[
              { q: 'Q. 로그인이 안 됩니다.', a: '발급받은 사번과 비밀번호로 로그인하세요. 비밀번호를 분실한 경우 인사담당자에게 초기화를 요청하세요.' },
              { q: 'Q. 연장근무 신청을 취소하고 싶습니다.', a: '"대기" 상태일 때만 취소 가능합니다. 이미 승인된 건은 관리자에게 문의하세요.' },
              { q: 'Q. 급여명세서가 보이지 않습니다.', a: '관리자가 해당 월 명세서를 등록해야 확인 가능합니다. 이메일 인증 후 열람할 수 있습니다.' },
              { q: 'Q. 경비 수령확인은 꼭 해야 하나요?', a: '네, 지급받은 경비에 대해 수령확인을 해주셔야 처리가 완료됩니다. 대시보드에 알림이 표시됩니다.' },
              { q: 'Q. 경비 수령확인 후 취소하고 싶습니다.', a: '수령확인 후에는 "취소 요청"을 통해 사유를 입력하면 담당자 승인 후 처리됩니다.' },
              { q: 'Q. 모바일에서도 사용 가능한가요?', a: '네, 모바일 브라우저에서 동일하게 사용 가능합니다. 홈 화면에 추가하면 앱처럼 편리하게 이용할 수 있습니다.' },
              { q: 'Q. 비밀번호를 변경하고 싶습니다.', a: '인사담당자에게 비밀번호 초기화를 요청하세요. 임시 비밀번호가 발급되며, 로그인 시 새 비밀번호를 설정할 수 있습니다.' },
            ].map((item, i) => (
              <div key={i} className="bg-gray-50 rounded-xl px-4 py-3">
                <p className="font-semibold text-gray-800 mb-1">{item.q}</p>
                <p className="text-gray-600">{item.a}</p>
              </div>
            ))}
          </div>
        </section>

        {/* 하단 */}
        <div className="text-center pt-6 border-t border-gray-200">
          <p className="text-xs text-gray-400">
            부성TK 근태관리 시스템 | 문의: 인사담당자에게 연락해 주세요
          </p>
          <p className="text-xs text-gray-300 mt-1">
            &copy; {new Date().getFullYear()} 부성TK. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  )
}
