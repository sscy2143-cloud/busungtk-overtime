import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const NOTION_API_KEY = process.env.NOTION_API_KEY
  const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID

  if (!NOTION_API_KEY || !NOTION_DATABASE_ID) {
    return res.status(500).json({ error: 'Notion API 설정이 되지 않았습니다' })
  }

  try {
    // 최근 7일 ~ 앞으로 14일 범위
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
          date: {
            on_or_after: from.toISOString().split('T')[0],
          },
        },
        sorts: [
          { property: '날짜', direction: 'ascending' },
        ],
        page_size: 100,
      }),
    })

    if (!response.ok) {
      const errorData = await response.json()
      console.error('[Notion Schedules] error:', errorData)
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

        // [현장명] 패턴 추출
        const siteMatch = title.match(/\[([^\]]+)\]/)
        const siteName = siteMatch ? siteMatch[1] : ''
        // 제목에서 [현장명] 제거한 나머지가 작업내용
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

    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*')
    return res.status(200).json({ schedules })
  } catch (error) {
    console.error('[Notion Schedules] exception:', error)
    return res.status(500).json({ error: '서버 오류가 발생했습니다' })
  }
}
