import { useState, type CSSProperties } from 'react'
import { FileText, Printer, X, BookOpen } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

type DocId = 'career' | 'employment' | 'severance' | 'resignation' | 'admin-guide'

const DOCS: { id: DocId; title: string; desc: string; bg: string; iconColor: string }[] = [
  { id: 'admin-guide', title: '관리자 이용 가이드', desc: '근태관리 시스템 관리자 기능 안내', bg: 'bg-purple-50 border-purple-200', iconColor: 'text-purple-500' },
  { id: 'career', title: '경력증명서', desc: '재직 기간 및 담당 업무 이력 증명', bg: 'bg-blue-50 border-blue-200', iconColor: 'text-blue-500' },
  { id: 'employment', title: '재직증명서', desc: '현재 재직 중임을 증명하는 서류', bg: 'bg-green-50 border-green-200', iconColor: 'text-green-500' },
  { id: 'severance', title: '퇴직금 중간정산서', desc: '퇴직금 중간 정산 신청서', bg: 'bg-orange-50 border-orange-200', iconColor: 'text-orange-500' },
  { id: 'resignation', title: '사직서', desc: '퇴직 의사를 표명하는 서류', bg: 'bg-red-50 border-red-200', iconColor: 'text-red-500' },
]

const th: CSSProperties = {
  background: '#dddddd', fontWeight: 'bold', textAlign: 'center',
  verticalAlign: 'middle', border: '1px solid black',
  padding: '4px 8px', fontSize: '9pt', whiteSpace: 'nowrap',
}
const td: CSSProperties = {
  border: '1px solid black', padding: '4px 8px',
  fontSize: '9pt', verticalAlign: 'middle',
}
const inputSt: CSSProperties = {
  width: '100%', border: 'none', borderBottom: '1px solid #999',
  background: 'transparent', fontSize: '9pt', outline: 'none', padding: '1px 2px',
}

export function AdminDocumentsPage() {
  const { employee } = useAuth()
  const navigate = useNavigate()
  const [openDoc, setOpenDoc] = useState<DocId | null>(null)

  const today = new Date()
  const dateStr = `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일`

  const name = employee?.name ?? ''
  const dept = employee?.department ?? ''

  function handlePrint() { window.print() }

  function ApprovalBoxes({ levels = ['기안', '검토', '결재'] }: { levels?: string[] }) {
    return (
      <table style={{ borderCollapse: 'collapse', float: 'right', marginBottom: '16px' }}>
        <tbody>
          <tr>{levels.map(l => <td key={l} style={{ ...th, width: '60px' }}>{l}</td>)}</tr>
          <tr>{levels.map(l => <td key={l} style={{ ...td, width: '60px', height: '50px' }} />)}</tr>
          <tr>{levels.map(l => <td key={l} style={{ ...td, width: '60px', textAlign: 'center', height: '20px', fontSize: '8pt' }}>{l === '기안' ? name : ''}</td>)}</tr>
        </tbody>
      </table>
    )
  }

  function DraftInfo() {
    return (
      <table style={{ borderCollapse: 'collapse', width: '220px', float: 'left', marginBottom: '16px' }}>
        <colgroup><col width="70" /><col width="150" /></colgroup>
        <tbody>
          {[['기 안 자', name], ['소 속', dept], ['기 안 일', dateStr]].map(([label, val]) => (
            <tr key={label}>
              <td style={th}>{label}</td>
              <td style={td}>{val}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  // ── 경력증명서 ──────────────────────────────────────────────────
  function CareerDoc() {
    return (
      <div style={{ fontFamily: "'Malgun Gothic', dotum, sans-serif" }}>
        <h1 style={{ textAlign: 'center', fontSize: '22pt', fontWeight: 'bold', margin: '20px 0 28px' }}>경력증명서</h1>
        <div style={{ overflow: 'hidden', marginBottom: '24px' }}>
          <DraftInfo />
          <ApprovalBoxes />
        </div>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <colgroup>
            <col width="70" /><col width="80" /><col /><col width="90" /><col />
          </colgroup>
          <tbody>
            <tr>
              <td rowSpan={2} style={th}>인적사항</td>
              <td style={th}>성 명</td>
              <td style={td}><input style={inputSt} defaultValue={name} /></td>
              <td style={th}>주민등록번호</td>
              <td style={td}><input style={inputSt} defaultValue="" placeholder="000000-0000000" /></td>
            </tr>
            <tr>
              <td style={th}>주 소</td>
              <td colSpan={3} style={td}><input style={inputSt} defaultValue="" /></td>
            </tr>
            <tr>
              <td rowSpan={5} style={th}>증명사항</td>
              <td colSpan={2} style={th}>재 직 기 간</td>
              <td style={th}>소속 및 직위</td>
              <td style={th}>담당 업무 내용</td>
            </tr>
            {[0, 1, 2, 3].map(i => (
              <tr key={i}>
                <td colSpan={2} style={{ ...td, textAlign: 'center' }}>
                  <input style={{ ...inputSt, width: '90px' }} defaultValue="" placeholder="yyyy.mm.dd" />
                  {' ~ '}
                  <input style={{ ...inputSt, width: '90px' }} defaultValue="" placeholder="yyyy.mm.dd" />
                </td>
                <td style={td}><input style={inputSt} defaultValue={i === 0 ? dept : ''} /></td>
                <td style={td}><input style={inputSt} defaultValue="" /></td>
              </tr>
            ))}
            <tr>
              <td colSpan={5} style={{ ...td, textAlign: 'center', padding: '24px 20px' }}>
                <p style={{ marginBottom: '32px' }}>상기와 같이 재직하였음을 증명함.</p>
                <p style={{ textAlign: 'right', marginRight: '60px' }}>{dateStr}</p>
                <br />
                <p style={{ textAlign: 'right', marginRight: '60px' }}>부성티케이 주식회사 대표이사 &nbsp;&nbsp;&nbsp; (인)</p>
                <br />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    )
  }

  // ── 재직증명서 ──────────────────────────────────────────────────
  function EmploymentDoc() {
    return (
      <div style={{ fontFamily: "'Malgun Gothic', dotum, sans-serif" }}>
        <h1 style={{ textAlign: 'center', fontSize: '22pt', fontWeight: 'bold', margin: '20px 0 28px' }}>재직증명서</h1>
        <div style={{ overflow: 'hidden', marginBottom: '24px' }}>
          <DraftInfo />
          <ApprovalBoxes />
        </div>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <colgroup><col width="100" /><col width="100" /><col /><col width="120" /><col /></colgroup>
          <tbody>
            <tr>
              <td rowSpan={2} style={th}>인적사항</td>
              <td style={th}>성 명</td>
              <td style={td}><input style={inputSt} defaultValue={name} /></td>
              <td style={th}>주민등록번호</td>
              <td style={td}><input style={inputSt} defaultValue="" placeholder="000000-0000000" /></td>
            </tr>
            <tr>
              <td style={th}>주 소</td>
              <td colSpan={3} style={td}><input style={inputSt} defaultValue="" /></td>
            </tr>
            <tr>
              <td rowSpan={3} style={th}>재직사항</td>
              <td style={th}>소 속</td>
              <td colSpan={3} style={td}><input style={inputSt} defaultValue={dept} /></td>
            </tr>
            <tr>
              <td style={th}>직 위</td>
              <td colSpan={3} style={td}><input style={inputSt} defaultValue="" /></td>
            </tr>
            <tr>
              <td style={th}>재직기간</td>
              <td colSpan={3} style={td}>
                <input style={{ ...inputSt, width: '120px' }} defaultValue="" placeholder="yyyy.mm.dd" />
                {' ~ '}
                <input style={{ ...inputSt, width: '120px' }} defaultValue="" placeholder="yyyy.mm.dd" />
              </td>
            </tr>
            <tr>
              <td style={th}>발급용도</td>
              <td colSpan={4} style={td}><input style={inputSt} defaultValue="" /></td>
            </tr>
            <tr>
              <td colSpan={5} style={{ ...td, textAlign: 'center', padding: '24px 20px' }}>
                <p style={{ marginBottom: '32px' }}>위와 같이 재직하고 있음을 증명합니다.</p>
                <p style={{ textAlign: 'right', marginRight: '60px' }}>{dateStr}</p>
                <br />
                <p style={{ textAlign: 'right', marginRight: '60px' }}>부성티케이 주식회사 대표이사 &nbsp;&nbsp;&nbsp; (인)</p>
                <br />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    )
  }

  // ── 퇴직금 중간정산서 ───────────────────────────────────────────
  function SeveranceDoc() {
    const hdrTh: CSSProperties = { ...th, fontSize: '10pt', padding: '5px' }
    const hdrTd: CSSProperties = { ...td, textAlign: 'center', fontSize: '10pt', padding: '5px' }
    return (
      <div style={{ fontFamily: "'Malgun Gothic', dotum, sans-serif" }}>
        {/* 제목 + 결재선 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
          <h1 style={{ fontSize: '22pt', fontWeight: 'bold', margin: 0 }}>퇴직금 중간정산신청서</h1>
          <ApprovalBoxes />
        </div>
        {/* 헤더 정보 테이블 */}
        <table style={{ borderCollapse: 'collapse', width: '100%', marginBottom: '12px' }}>
          <colgroup><col width="100" /><col /><col width="100" /><col /><col width="100" /><col /></colgroup>
          <tbody>
            <tr>
              <td style={hdrTh}>문서번호</td>
              <td style={hdrTd}><input style={inputSt} defaultValue="" /></td>
              <td style={hdrTh}>보안등급</td>
              <td style={hdrTd}><input style={inputSt} defaultValue="" /></td>
              <td style={hdrTh}>기안일시</td>
              <td style={hdrTd}>{dateStr}</td>
            </tr>
            <tr>
              <td style={hdrTh}>기안자</td>
              <td style={hdrTd}>{name}</td>
              <td style={hdrTh}>부서</td>
              <td style={hdrTd}>{dept}</td>
              <td style={hdrTh}>보존연한</td>
              <td style={hdrTd}><input style={inputSt} defaultValue="" /></td>
            </tr>
          </tbody>
        </table>
        {/* 제목·본문 테이블 */}
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <colgroup><col width="130" /><col /><col /></colgroup>
          <tbody>
            <tr>
              <td style={th}>제 목</td>
              <td colSpan={2} style={td}><input style={inputSt} defaultValue="" /></td>
            </tr>
            <tr>
              <td colSpan={3} style={{ ...td, textAlign: 'center', padding: '20px', lineHeight: '2' }}>
                본인의 퇴직금에 대한 중간 정산을 아래와 같이 신청하오니 지급하여 주시기 바랍니다.<br />
                <br />- 아래 -
              </td>
            </tr>
            <tr>
              <td colSpan={3} style={{ ...td, fontWeight: 'bold', padding: '8px 12px', fontSize: '10pt' }}>□ 신청사항</td>
            </tr>
            <tr>
              <td style={th}>성 명</td>
              <td colSpan={2} style={td}><input style={inputSt} defaultValue={name} /></td>
            </tr>
            <tr>
              <td style={th}>소속부서 / 직급</td>
              <td colSpan={2} style={td}><input style={inputSt} defaultValue={dept} /></td>
            </tr>
            <tr>
              <td style={th}>입사년월일</td>
              <td colSpan={2} style={td}><input style={inputSt} defaultValue="" placeholder="yyyy.mm.dd" /></td>
            </tr>
            <tr>
              <td style={th}>신청목적</td>
              <td colSpan={2} style={td}><input style={inputSt} defaultValue="" /></td>
            </tr>
            <tr>
              <td style={th}>정산기간</td>
              <td colSpan={2} style={td}>
                <input style={{ ...inputSt, width: '120px' }} defaultValue="" placeholder="yyyy.mm.dd" />
                {' ~ '}
                <input style={{ ...inputSt, width: '120px' }} defaultValue="" placeholder="yyyy.mm.dd" />
              </td>
            </tr>
            <tr>
              <td style={th}>지급희망일자</td>
              <td colSpan={2} style={td}><input style={inputSt} defaultValue="" placeholder="yyyy.mm.dd" /></td>
            </tr>
          </tbody>
        </table>
      </div>
    )
  }

  // ── 사직서 ──────────────────────────────────────────────────────
  function ResignationDoc() {
    return (
      <div style={{ fontFamily: "'Malgun Gothic', dotum, sans-serif" }}>
        <h1 style={{ textAlign: 'center', fontSize: '22pt', fontWeight: 'bold', margin: '20px 0 28px' }}>사 직 서</h1>
        <div style={{ overflow: 'hidden', marginBottom: '24px' }}>
          <DraftInfo />
          <ApprovalBoxes levels={['수신', '검토', '결재']} />
        </div>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <colgroup><col width="100" /><col width="140" /><col /><col width="140" /><col /></colgroup>
          <tbody>
            <tr>
              <td rowSpan={3} style={th}>신청인<br />정보</td>
              <td style={th}>성 명</td>
              <td style={td}><input style={inputSt} defaultValue={name} /></td>
              <td style={th}>주민등록번호</td>
              <td style={td}><input style={inputSt} defaultValue="" placeholder="000000-0000000" /></td>
            </tr>
            <tr>
              <td style={th}>소 속</td>
              <td style={td}><input style={inputSt} defaultValue={dept} /></td>
              <td style={th}>직 위</td>
              <td style={td}><input style={inputSt} defaultValue="" /></td>
            </tr>
            <tr>
              <td style={th}>입 사 일</td>
              <td style={td}><input style={inputSt} defaultValue="" placeholder="yyyy.mm.dd" /></td>
              <td style={th}>퇴직 희망일</td>
              <td style={td}><input style={inputSt} defaultValue="" placeholder="yyyy.mm.dd" /></td>
            </tr>
            <tr>
              <td style={th}>사직 사유</td>
              <td colSpan={4} style={{ ...td, verticalAlign: 'top', padding: '6px 8px' }}>
                <textarea
                  style={{ width: '100%', border: 'none', background: 'transparent', fontSize: '9pt', outline: 'none', resize: 'none', minHeight: '80px' }}
                  defaultValue=""
                  placeholder="사직 사유를 입력하세요"
                />
              </td>
            </tr>
            <tr>
              <td colSpan={5} style={{ ...td, padding: '8px', fontSize: '8pt', color: '#444' }}>
                위와 같은 사유로 사직을 제출합니다.
              </td>
            </tr>
            <tr>
              <td colSpan={5} style={{ ...td, textAlign: 'center', padding: '24px 20px' }}>
                <p style={{ textAlign: 'right', marginRight: '60px' }}>{dateStr}</p>
                <br />
                <p style={{ textAlign: 'right', marginRight: '60px' }}>신청인: {name} &nbsp;&nbsp;&nbsp; (서명)</p>
                <br />
                <p style={{ textAlign: 'right', marginRight: '60px' }}>부성티케이 주식회사 대표이사 귀중</p>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    )
  }

  function AdminGuideDoc() {
    const gSt: CSSProperties = { fontFamily: "'Malgun Gothic', dotum, sans-serif", lineHeight: '1.8' }
    const h2St: CSSProperties = { fontSize: '14pt', fontWeight: 'bold', margin: '24px 0 8px', borderBottom: '1px solid #ccc', paddingBottom: '4px' }
    const ulSt: CSSProperties = { paddingLeft: '20px', margin: '4px 0', listStyleType: 'disc' }
    const liSt: CSSProperties = { fontSize: '10pt', marginBottom: '2px' }
    return (
      <div style={gSt}>
        <h1 style={{ textAlign: 'center', fontSize: '18pt', fontWeight: 'bold', margin: '16px 0 24px' }}>관리자 이용 가이드</h1>
        <p style={{ textAlign: 'center', fontSize: '9pt', color: '#888', marginBottom: '24px' }}>부성TK 근태관리 시스템</p>

        <h2 style={h2St}>1. 관리자 대시보드</h2>
        <ul style={ulSt}><li style={liSt}>승인 대기 건수, 전체 직원 현황 등을 한눈에 확인</li></ul>

        <h2 style={h2St}>2. 승인 관리</h2>
        <ul style={ulSt}>
          <li style={liSt}>연장근무 신청을 승인/반려 처리</li>
          <li style={liSt}>반려 시 사유를 입력합니다</li>
          <li style={liSt}>승인/반려 권한은 대표만 가능합니다</li>
        </ul>

        <h2 style={h2St}>3. 연장근무 현황</h2>
        <ul style={ulSt}>
          <li style={liSt}>전 직원의 연장근무 현황을 대시보드/목록/수당 형태로 확인</li>
          <li style={liSt}>직원별 주간 근무시간 게이지 확인</li>
        </ul>

        <h2 style={h2St}>4. 휴가 관리</h2>
        <ul style={ulSt}>
          <li style={liSt}>전 직원의 연차 부여/조정/사용 현황 관리</li>
          <li style={liSt}>보상휴가(대체휴가) 관리</li>
        </ul>

        <h2 style={h2St}>5. 경비 관리</h2>
        <ul style={ulSt}>
          <li style={liSt}>직원 경비 승인/반려 처리</li>
          <li style={liSt}>지급 처리: 지급금액, 지급방식, 은행/계좌정보, 메모 입력</li>
          <li style={liSt}>관리자 전용 메모: 직원에게 보이지 않는 내부 메모 작성 가능</li>
          <li style={liSt}>직원 수령확인 상태 모니터링</li>
          <li style={liSt}>취소 요청 승인/거절 처리</li>
          <li style={liSt}>엑셀(CSV) 내보내기 지원</li>
        </ul>

        <h2 style={h2St}>6. 급여명세서 관리</h2>
        <ul style={ulSt}>
          <li style={liSt}>명세서 등록: 지급월 선택 → 전 직원 목록에서 개별 파일 업로드</li>
          <li style={liSt}>실근로일 기간 설정 (달력에서 선택)</li>
          <li style={liSt}>전달 문구: 직원에게 보여지는 메시지</li>
          <li style={liSt}>기타(관리자 메모): 직원에게 보이지 않는 내부 메모</li>
          <li style={liSt}>등록 현황: 전체 등록 내역 조회, 직원별 필터, 다운로드/삭제</li>
        </ul>

        <h2 style={h2St}>7. 공지사항 관리</h2>
        <ul style={ulSt}>
          <li style={liSt}>공지사항 작성/수정/삭제</li>
          <li style={liSt}>리치 텍스트 에디터 지원 (굵게, 기울임, 목록, 링크, 이미지 등)</li>
          <li style={liSt}>파일 첨부 / 공지 분류 / 활성·숨김 토글</li>
        </ul>

        <h2 style={h2St}>8. 직원 관리</h2>
        <ul style={ulSt}>
          <li style={liSt}>직원 정보 조회/수정 (기본정보 · 계정관리 · 퇴사관리)</li>
          <li style={liSt}>부서, 직급, 시급 설정</li>
          <li style={liSt}>비밀번호 초기화 (인사담당자 비밀번호 재확인 필요)</li>
          <li style={liSt}>계정 활성화/비활성화</li>
          <li style={liSt}>직원 추가: 사번, 이름, 임시 비밀번호 → 최초 로그인 시 변경</li>
        </ul>

        <h2 style={h2St}>9. 자료실</h2>
        <ul style={ulSt}>
          <li style={liSt}>경력증명서, 재직증명서, 퇴직금 중간정산서, 사직서 등 서류 양식</li>
          <li style={liSt}>인쇄 가능한 형태로 제공</li>
        </ul>

        <h2 style={h2St}>권한 구분</h2>
        <table style={{ borderCollapse: 'collapse', width: '100%', marginTop: '8px', fontSize: '10pt' }}>
          <thead>
            <tr style={{ background: '#eee' }}>
              <th style={{ border: '1px solid #ccc', padding: '6px 10px', textAlign: 'left' }}>구분</th>
              <th style={{ border: '1px solid #ccc', padding: '6px 10px', textAlign: 'center' }}>인사담당</th>
              <th style={{ border: '1px solid #ccc', padding: '6px 10px', textAlign: 'center' }}>대표</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['연장근무 승인/반려', '불가', '가능'],
              ['휴가 관리', '가능', '가능'],
              ['경비 관리', '가능', '가능'],
              ['급여명세서 관리', '가능', '가능'],
              ['직원 계정 관리', '가능', '가능'],
              ['직원 추가/삭제', '불가', '가능'],
            ].map(([item, manager, admin]) => (
              <tr key={item}>
                <td style={{ border: '1px solid #ccc', padding: '4px 10px' }}>{item}</td>
                <td style={{ border: '1px solid #ccc', padding: '4px 10px', textAlign: 'center' }}>{manager}</td>
                <td style={{ border: '1px solid #ccc', padding: '4px 10px', textAlign: 'center' }}>{admin}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* 인쇄 전용 스타일 */}
      <style>{`
        @media print {
          body > * { visibility: hidden; }
          #print-area, #print-area * { visibility: visible; }
          #print-area { position: fixed; top: 0; left: 0; width: 100%; padding: 20px 40px; background: white; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div>
        <h1 className="text-xl font-bold text-gray-900">자료실</h1>
        <p className="text-sm text-gray-500 mt-0.5">문서 양식을 열람하고 작성 후 인쇄하세요</p>
      </div>

      {/* 이용 가이드 */}
      <div className="mb-4">
        <button
          onClick={() => navigate('/guide')}
          className="w-full flex items-center gap-4 p-5 rounded-2xl border-2 bg-primary-50 border-primary-200 hover:shadow-md transition-all text-left"
        >
          <div className="w-12 h-12 bg-primary-100 rounded-xl flex items-center justify-center flex-shrink-0">
            <BookOpen size={24} className="text-primary-600" />
          </div>
          <div>
            <p className="font-bold text-gray-900">부성TK 근태관리 이용 가이드</p>
            <p className="text-xs text-gray-500 mt-0.5">시스템 사용법 A to Z · PDF 저장/인쇄 가능</p>
          </div>
        </button>
      </div>

      {/* 문서 목록 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {DOCS.map(doc => (
          <button
            key={doc.id}
            onClick={() => setOpenDoc(doc.id)}
            className={`flex flex-col items-center gap-3 p-6 rounded-2xl border-2 hover:shadow-md transition-all text-left ${doc.bg}`}
          >
            <FileText className={`w-10 h-10 ${doc.iconColor}`} />
            <div>
              <p className="text-sm font-bold text-gray-900 text-center">{doc.title}</p>
              <p className="text-xs text-gray-500 mt-1 text-center leading-relaxed">{doc.desc}</p>
            </div>
          </button>
        ))}
      </div>

      {/* 문서 모달 */}
      {openDoc && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 py-8 px-4">
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl">
            {/* 모달 헤더 */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 no-print">
              <h2 className="text-base font-bold text-gray-900">
                {DOCS.find(d => d.id === openDoc)?.title}
              </h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={handlePrint}
                  className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white text-sm font-semibold rounded-xl hover:bg-primary-700 transition-colors"
                >
                  <Printer className="w-4 h-4" />
                  인쇄
                </button>
                <button
                  onClick={() => setOpenDoc(null)}
                  className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-xl transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* 문서 본문 */}
            <div id="print-area" className="p-8" key={openDoc}>
              {openDoc === 'admin-guide' && AdminGuideDoc()}
              {openDoc === 'career' && CareerDoc()}
              {openDoc === 'employment' && EmploymentDoc()}
              {openDoc === 'severance' && SeveranceDoc()}
              {openDoc === 'resignation' && ResignationDoc()}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
