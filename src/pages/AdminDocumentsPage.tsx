import { useState, useEffect, CSSProperties } from 'react'
import { FileText, Printer, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

type DocId = 'career' | 'employment' | 'severance' | 'resignation'

const DOCS: { id: DocId; title: string; desc: string; bg: string; iconColor: string }[] = [
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
  const [openDoc, setOpenDoc] = useState<DocId | null>(null)
  const [fields, setFields] = useState<Record<string, string>>({})

  const today = new Date()
  const dateStr = `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일`

  useEffect(() => {
    if (openDoc) {
      setFields({
        name: employee?.name ?? '',
        department: employee?.department ?? '',
        date: dateStr,
      })
    }
  }, [openDoc])

  const f = (k: string) => fields[k] ?? ''
  const sf = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setFields(p => ({ ...p, [k]: e.target.value }))

  function handlePrint() { window.print() }

  function ApprovalBoxes({ levels = ['기안', '검토', '결재'] }: { levels?: string[] }) {
    return (
      <table style={{ borderCollapse: 'collapse', float: 'right', marginBottom: '16px' }}>
        <tbody>
          <tr>{levels.map(l => <td key={l} style={{ ...th, width: '60px' }}>{l}</td>)}</tr>
          <tr>{levels.map(l => <td key={l} style={{ ...td, width: '60px', height: '50px' }} />)}</tr>
          <tr>{levels.map(l => <td key={l} style={{ ...td, width: '60px', textAlign: 'center', height: '20px', fontSize: '8pt' }}>{l === '기안' ? f('name') : ''}</td>)}</tr>
        </tbody>
      </table>
    )
  }

  function DraftInfo() {
    return (
      <table style={{ borderCollapse: 'collapse', width: '220px', float: 'left', marginBottom: '16px' }}>
        <colgroup><col width="70" /><col width="150" /></colgroup>
        <tbody>
          {[['기 안 자', f('name')], ['소 속', f('department')], ['기 안 일', dateStr]].map(([label, val]) => (
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
              <td style={td}><input style={inputSt} value={f('name')} onChange={sf('name')} /></td>
              <td style={th}>주민등록번호</td>
              <td style={td}><input style={inputSt} value={f('ssn')} onChange={sf('ssn')} placeholder="000000-0000000" /></td>
            </tr>
            <tr>
              <td style={th}>주 소</td>
              <td colSpan={3} style={td}><input style={inputSt} value={f('address')} onChange={sf('address')} /></td>
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
                  <input style={{ ...inputSt, width: '90px' }} value={f(`from${i}`)} onChange={sf(`from${i}`)} placeholder="yyyy.mm.dd" />
                  {' ~ '}
                  <input style={{ ...inputSt, width: '90px' }} value={f(`to${i}`)} onChange={sf(`to${i}`)} placeholder="yyyy.mm.dd" />
                </td>
                <td style={td}><input style={inputSt} value={f(`pos${i}`)} onChange={sf(`pos${i}`)} /></td>
                <td style={td}><input style={inputSt} value={f(`duty${i}`)} onChange={sf(`duty${i}`)} /></td>
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
              <td style={td}><input style={inputSt} value={f('name')} onChange={sf('name')} /></td>
              <td style={th}>주민등록번호</td>
              <td style={td}><input style={inputSt} value={f('ssn')} onChange={sf('ssn')} placeholder="000000-0000000" /></td>
            </tr>
            <tr>
              <td style={th}>주 소</td>
              <td colSpan={3} style={td}><input style={inputSt} value={f('address')} onChange={sf('address')} /></td>
            </tr>
            <tr>
              <td rowSpan={3} style={th}>재직사항</td>
              <td style={th}>소 속</td>
              <td colSpan={3} style={td}><input style={inputSt} value={f('department')} onChange={sf('department')} /></td>
            </tr>
            <tr>
              <td style={th}>직 위</td>
              <td colSpan={3} style={td}><input style={inputSt} value={f('position')} onChange={sf('position')} /></td>
            </tr>
            <tr>
              <td style={th}>재직기간</td>
              <td colSpan={3} style={td}>
                <input style={{ ...inputSt, width: '120px' }} value={f('periodFrom')} onChange={sf('periodFrom')} placeholder="yyyy.mm.dd" />
                {' ~ '}
                <input style={{ ...inputSt, width: '120px' }} value={f('periodTo')} onChange={sf('periodTo')} placeholder="yyyy.mm.dd" />
              </td>
            </tr>
            <tr>
              <td style={th}>발급용도</td>
              <td colSpan={4} style={td}><input style={inputSt} value={f('purpose')} onChange={sf('purpose')} /></td>
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
              <td style={hdrTd}><input style={inputSt} value={f('docNo')} onChange={sf('docNo')} /></td>
              <td style={hdrTh}>보안등급</td>
              <td style={hdrTd}><input style={inputSt} value={f('secLevel')} onChange={sf('secLevel')} /></td>
              <td style={hdrTh}>기안일시</td>
              <td style={hdrTd}>{dateStr}</td>
            </tr>
            <tr>
              <td style={hdrTh}>기안자</td>
              <td style={hdrTd}>{f('name')}</td>
              <td style={hdrTh}>부서</td>
              <td style={hdrTd}>{f('department')}</td>
              <td style={hdrTh}>보존연한</td>
              <td style={hdrTd}><input style={inputSt} value={f('retention')} onChange={sf('retention')} /></td>
            </tr>
          </tbody>
        </table>
        {/* 제목·본문 테이블 */}
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <colgroup><col width="130" /><col /><col /></colgroup>
          <tbody>
            <tr>
              <td style={th}>제 목</td>
              <td colSpan={2} style={td}><input style={inputSt} value={f('subject')} onChange={sf('subject')} /></td>
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
              <td colSpan={2} style={td}><input style={inputSt} value={f('name')} onChange={sf('name')} /></td>
            </tr>
            <tr>
              <td style={th}>소속부서 / 직급</td>
              <td colSpan={2} style={td}><input style={inputSt} value={f('deptRank')} onChange={sf('deptRank')} /></td>
            </tr>
            <tr>
              <td style={th}>입사년월일</td>
              <td colSpan={2} style={td}><input style={inputSt} value={f('hireDate')} onChange={sf('hireDate')} placeholder="yyyy.mm.dd" /></td>
            </tr>
            <tr>
              <td style={th}>신청목적</td>
              <td colSpan={2} style={td}><input style={inputSt} value={f('purpose')} onChange={sf('purpose')} /></td>
            </tr>
            <tr>
              <td style={th}>정산기간</td>
              <td colSpan={2} style={td}>
                <input style={{ ...inputSt, width: '120px' }} value={f('periodFrom')} onChange={sf('periodFrom')} placeholder="yyyy.mm.dd" />
                {' ~ '}
                <input style={{ ...inputSt, width: '120px' }} value={f('periodTo')} onChange={sf('periodTo')} placeholder="yyyy.mm.dd" />
              </td>
            </tr>
            <tr>
              <td style={th}>지급희망일자</td>
              <td colSpan={2} style={td}><input style={inputSt} value={f('payDate')} onChange={sf('payDate')} placeholder="yyyy.mm.dd" /></td>
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
              <td style={td}><input style={inputSt} value={f('name')} onChange={sf('name')} /></td>
              <td style={th}>주민등록번호</td>
              <td style={td}><input style={inputSt} value={f('ssn')} onChange={sf('ssn')} placeholder="000000-0000000" /></td>
            </tr>
            <tr>
              <td style={th}>소 속</td>
              <td style={td}><input style={inputSt} value={f('department')} onChange={sf('department')} /></td>
              <td style={th}>직 위</td>
              <td style={td}><input style={inputSt} value={f('position')} onChange={sf('position')} /></td>
            </tr>
            <tr>
              <td style={th}>입 사 일</td>
              <td style={td}><input style={inputSt} value={f('hireDate')} onChange={sf('hireDate')} placeholder="yyyy.mm.dd" /></td>
              <td style={th}>퇴직 희망일</td>
              <td style={td}><input style={inputSt} value={f('resignDate')} onChange={sf('resignDate')} placeholder="yyyy.mm.dd" /></td>
            </tr>
            <tr>
              <td style={th}>사직 사유</td>
              <td colSpan={4} style={{ ...td, verticalAlign: 'top', padding: '6px 8px' }}>
                <textarea
                  style={{ width: '100%', border: 'none', background: 'transparent', fontSize: '9pt', outline: 'none', resize: 'none', minHeight: '80px' }}
                  value={f('resignReason')}
                  onChange={sf('resignReason')}
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
                <p style={{ textAlign: 'right', marginRight: '60px' }}>신청인: {f('name')} &nbsp;&nbsp;&nbsp; (서명)</p>
                <br />
                <p style={{ textAlign: 'right', marginRight: '60px' }}>부성티케이 주식회사 대표이사 귀중</p>
              </td>
            </tr>
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
            <div id="print-area" className="p-8">
              {openDoc === 'career' && <CareerDoc />}
              {openDoc === 'employment' && <EmploymentDoc />}
              {openDoc === 'severance' && <SeveranceDoc />}
              {openDoc === 'resignation' && <ResignationDoc />}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
