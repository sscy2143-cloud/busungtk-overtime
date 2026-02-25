import type { VercelRequest, VercelResponse } from '@vercel/node'
import * as crypto from 'crypto'

function getSolapiAuth() {
  const apiKey = process.env.SOLAPI_API_KEY
  const apiSecret = process.env.SOLAPI_API_SECRET

  if (!apiKey || !apiSecret) {
    throw new Error('SOLAPI credentials not configured')
  }

  const date = new Date().toISOString()
  const salt = crypto.randomBytes(16).toString('hex')
  const signature = crypto
    .createHmac('sha256', apiSecret)
    .update(date + salt)
    .digest('hex')
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`
}

async function sendSMS(
  to: string,
  message: string,
): Promise<{ success: boolean; error?: string }> {
  if (!process.env.SOLAPI_API_KEY || !process.env.SOLAPI_API_SECRET || !process.env.SOLAPI_SENDER) {
    return { success: false, error: 'SOLAPI 환경변수 미설정' }
  }

  const response = await fetch('https://api.solapi.com/messages/v4/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: getSolapiAuth(),
    },
    body: JSON.stringify({
      message: {
        to,
        from: process.env.SOLAPI_SENDER,
        text: message,
      },
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    return { success: false, error: `Solapi API error: ${error}` }
  }

  await response.json()
  return { success: true }
}

/**
 * POST /api/notify-leave
 * 휴가 신청 시 사장님에게 SMS 알림
 *
 * Body: {
 *   employeeName: string    // 신청자 이름
 *   leaveType: string       // 연차, 오전반차, 오후반차, 특별휴가, 병가
 *   startDate: string       // 시작일
 *   endDate: string         // 종료일
 *   days: number            // 일수
 *   reason: string          // 사유
 * }
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { employeeName, leaveType, startDate, endDate, days, reason } = req.body

    if (!employeeName || !leaveType || !startDate) {
      return res.status(400).json({ error: '필수 항목 누락 (employeeName, leaveType, startDate)' })
    }

    const bossPhone = process.env.BOSS_PHONE
    if (!bossPhone) {
      return res.status(500).json({ error: 'BOSS_PHONE 환경변수 미설정' })
    }

    // 날짜 표시
    const dateRange = startDate === endDate || !endDate
      ? startDate
      : `${startDate} ~ ${endDate}`

    // SMS 메시지 (80바이트 이내면 SMS, 초과면 LMS 자동 전환)
    const message = [
      `[부성TK 휴가신청]`,
      `${employeeName} - ${leaveType} ${days}일`,
      `기간: ${dateRange}`,
      reason ? `사유: ${reason}` : '',
      `근태관리 앱에서 승인해주세요.`,
    ].filter(Boolean).join('\n')

    const result = await sendSMS(bossPhone, message)

    if (!result.success) {
      console.error('SMS 발송 실패:', result.error)
      return res.status(500).json({
        success: false,
        error: result.error,
      })
    }

    return res.status(200).json({
      success: true,
      message: '사장님에게 SMS 알림 발송 완료',
    })
  } catch (error) {
    console.error('notify-leave error:', error)
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '서버 오류',
    })
  }
}
