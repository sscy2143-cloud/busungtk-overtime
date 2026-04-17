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
  const apiKey = process.env.SOLAPI_API_KEY!
  const apiSecret = process.env.SOLAPI_API_SECRET!
  const date = new Date().toISOString()
  const salt = crypto.randomBytes(16).toString('hex')
  const signature = crypto
    .createHmac('sha256', apiSecret)
    .update(date + salt)
    .digest('hex')
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`
}

interface SendResult {
  success: boolean
  method?: 'alimtalk'
  error?: string
}

async function sendAlimtalk(
  to: string,
  templateId: string,
  variables: Record<string, string>,
): Promise<SendResult> {
  const pfId = process.env.SOLAPI_KAKAO_PF_ID
  if (!pfId || !templateId) {
    return { success: false, error: '알림톡 설정 미완료 (pfId 또는 templateId 없음)' }
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
        kakaoOptions: {
          pfId,
          templateId,
          variables,
        },
      },
    }),
  })

  if (!response.ok) {
    const err = await response.text()
    return { success: false, error: `알림톡 발송 실패: ${err}` }
  }

  return { success: true, method: 'alimtalk' }
}

// 알림톡만 발송
async function sendNotification(
  to: string,
  templateId: string,
  variables: Record<string, string>,
): Promise<SendResult> {
  const result = await sendAlimtalk(to, templateId, variables)
  if (!result.success) {
    console.log(`알림톡 실패 (${to}): ${result.error}`)
  }
  return result
}

function getRecipients(): string[] {
  const phones: string[] = []
  if (process.env.BOSS_PHONE) phones.push(process.env.BOSS_PHONE)
  if (process.env.MANAGER_PHONE) phones.push(process.env.MANAGER_PHONE)
  return phones
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin || ''
  const allowedOrigins = [
    'https://busungtk-overtime.vercel.app',
    'https://busungtk-overtime-beta.vercel.app',
    process.env.ALLOWED_ORIGIN,
  ].filter(Boolean)
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  } else {
    res.setHeader('Access-Control-Allow-Origin', 'https://busungtk-overtime.vercel.app')
  }
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')

  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!(await verifyAuth(req))) return res.status(401).json({ error: '인증이 필요합니다' })

  try {
    const { type, employeeName, date, startTime, endTime, reason, leaveType, startDate, endDate, days } = req.body

    if (!type || !employeeName) {
      return res.status(400).json({ error: '필수 항목 누락 (type, employeeName)' })
    }

    const recipients = getRecipients()
    if (recipients.length === 0) {
      return res.status(500).json({ error: '수신자 전화번호 미설정' })
    }

    let templateId: string
    let variables: Record<string, string>

    if (type === 'overtime') {
      templateId = process.env.KAKAO_OVERTIME_TEMPLATE_ID ?? ''
      variables = {
        '#{직원명}': employeeName,
        '#{날짜}': date ?? '',
        '#{시간}': `${startTime ?? ''} ~ ${endTime ?? ''}`,
        '#{사유}': reason || '(사유 없음)',
      }
    } else if (type === 'leave') {
      templateId = process.env.KAKAO_LEAVE_TEMPLATE_ID ?? ''
      const dateRange = startDate === endDate || !endDate ? startDate : `${startDate} ~ ${endDate}`
      variables = {
        '#{직원명}': employeeName,
        '#{휴가종류}': leaveType ?? '',
        '#{기간}': dateRange ?? '',
        '#{일수}': `${days ?? 1}`,
        '#{사유}': reason || '(사유 없음)',
      }
    } else {
      return res.status(400).json({ error: `지원하지 않는 알림 유형: ${type}` })
    }

    // 모든 수신자에게 알림톡 발송
    const results = await Promise.allSettled(
      recipients.map((phone) => sendNotification(phone, templateId, variables)),
    )

    const summary = results.map((r, i) => ({
      phone: recipients[i].slice(0, 3) + '****' + recipients[i].slice(-4),
      ...(r.status === 'fulfilled' ? r.value : { success: false, error: String(r.reason) }),
    }))

    return res.status(200).json({ success: true, results: summary })
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '서버 오류',
    })
  }
}
