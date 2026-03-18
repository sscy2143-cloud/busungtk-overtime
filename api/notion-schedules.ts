import type { VercelRequest, VercelResponse } from '@vercel/node'
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS - 허용 도메인만
  const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://busungtk-overtime.vercel.app'
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin)
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')

  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // 인증 확인
  if (!(await verifyAuth(req))) {
    return res.status(401).json({ error: '인증이 필요합니다' })
  }

  const NOTION_API_KEY = process.env.NOTION_API_KEY
  const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID

  if (!NOTION_API_KEY || !NOTION_DATABASE_ID) {
    return res.status(500).json({ error: 'Notion API 설정이 되지 않았습니다' })
  }

  try {
    const from = new Date()
    from.setDate(from.getDate() - 7)
    const to = new Date()
    to.setDate(to.getDate() + 14)

    const response = await fetch(`https://api.notion.com/v1/databases/${NOTION_DATABASE_ID}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_API_KEY}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28',
      },
      body: JSON.stringify({
        filter: {
          property: '날짜',
          date: { on_or_after: from.toISOString().split('T')[0] },
        },
        sorts: [{ property: '날짜', direction: 'descending' }],
        page_size: 100,
      }),
    })

    if (!response.ok) {
      return res.status(500).json({ error: 'Notion API 호출 실패' })
    }

    const data = await response.json()

    const schedules = data.results
      .filter((page: any) => {
        const dateProp = page.properties?.['날짜']?.date
        if (!dateProp?.start) return false
        const d = dateProp.start.split('T')[0]
        return d <= to.toISOString().split('T')[0]
      })
      .map((page: any) => {
        const title = page.properties?.['이름']?.title?.[0]?.plain_text ?? ''
        const dateStart = page.properties?.['날짜']?.date?.start ?? ''
        const dateEnd = page.properties?.['날짜']?.date?.end ?? null
        const status = page.properties?.['상태']?.status?.name ?? ''

        const siteMatch = title.match(/\[([^\]]+)\]/)
        const siteName = siteMatch ? siteMatch[1] : ''
        const workTitle = title.replace(/\[[^\]]+\]\s*/, '').trim()

        return {
          id: page.id,
          title,
          date: dateStart.split('T')[0],
          dateEnd: dateEnd ? dateEnd.split('T')[0] : null,
          siteName,
          workTitle,
          status,
        }
      })

    return res.status(200).json({ schedules })
  } catch {
    return res.status(500).json({ error: '서버 오류가 발생했습니다' })
  }
}
