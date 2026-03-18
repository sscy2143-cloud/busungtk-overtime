import type { VercelRequest, VercelResponse } from '@vercel/node'
import * as crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'

async function verifyAuth(req: VercelRequest): Promise<boolean> {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) return false
  const supabase = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.VITE_SUPABASE_ANON_KEY!,
  )
  const { data: { user }, error } = await supabase.auth.getUser(authHeader.split(' ')[1])
  return !error && !!user
}

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://busungtk-overtime.vercel.app'
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin)
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')

  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // 인증 확인
  if (!(await verifyAuth(req))) {
    return res.status(401).json({ error: '인증이 필요합니다' })
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

    const dateRange = startDate === endDate || !endDate
      ? startDate
      : `${startDate} ~ ${endDate}`

    const message = [
      `[부성TK 휴가신청]`,
      `${employeeName} - ${leaveType} ${days}일`,
      `기간: ${dateRange}`,
      reason ? `사유: ${reason}` : '',
      `근태관리 앱에서 승인해주세요.`,
    ].filter(Boolean).join('\n')

    const result = await sendSMS(bossPhone, message)

    if (!result.success) {
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
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '서버 오류',
    })
  }
}
