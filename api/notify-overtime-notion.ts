import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const NOTION_API_KEY = process.env.NOTION_API_KEY
  const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID

  if (!NOTION_API_KEY || !NOTION_DATABASE_ID) {
    return res.status(500).json({ error: 'Notion API 설정이 되지 않았습니다' })
  }

  try {
    const {
      employeeName,
      date,
      startTime,
      endTime,
      overtimeType,
      siteName,
      workDetails,
      reason,
    } = req.body

    const title = `[야근] ${employeeName} - ${siteName || '본사'}`

    const response = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_API_KEY}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28',
      },
      body: JSON.stringify({
        parent: { database_id: NOTION_DATABASE_ID },
        properties: {
          // 제목 (title 타입 속성)
          '이름': {
            title: [{ text: { content: title } }],
          },
          // 날짜 (date 타입 속성)
          '날짜': {
            date: {
              start: `${date}T${startTime}:00`,
              end: `${date}T${endTime}:00`,
            },
          },
        },
        // 페이지 본문에 상세 정보 추가
        children: [
          {
            object: 'block',
            type: 'heading_2',
            heading_2: {
              rich_text: [{ text: { content: '야근 정보' } }],
            },
          },
          {
            object: 'block',
            type: 'bulleted_list_item',
            bulleted_list_item: {
              rich_text: [{ text: { content: `직원: ${employeeName}` } }],
            },
          },
          {
            object: 'block',
            type: 'bulleted_list_item',
            bulleted_list_item: {
              rich_text: [{ text: { content: `유형: ${overtimeType}` } }],
            },
          },
          {
            object: 'block',
            type: 'bulleted_list_item',
            bulleted_list_item: {
              rich_text: [{ text: { content: `현장: ${siteName || '미지정'}` } }],
            },
          },
          {
            object: 'block',
            type: 'bulleted_list_item',
            bulleted_list_item: {
              rich_text: [{ text: { content: `시간: ${startTime} ~ ${endTime}` } }],
            },
          },
          ...(workDetails ? [{
            object: 'block' as const,
            type: 'paragraph' as const,
            paragraph: {
              rich_text: [{ text: { content: `작업내용: ${workDetails}` } }],
            },
          }] : []),
          ...(reason ? [{
            object: 'block' as const,
            type: 'paragraph' as const,
            paragraph: {
              rich_text: [{ text: { content: `사유: ${reason}` } }],
            },
          }] : []),
        ],
      }),
    })

    if (!response.ok) {
      const errorData = await response.json()
      console.error('[Notion API] error:', errorData)
      return res.status(500).json({
        success: false,
        error: 'Notion API 호출 실패',
        details: errorData,
      })
    }

    const data = await response.json()
    return res.status(200).json({
      success: true,
      message: '노션 캘린더에 일정이 추가되었습니다',
      pageId: data.id,
    })
  } catch (error) {
    console.error('[Notion API] exception:', error)
    return res.status(500).json({
      success: false,
      error: '서버 오류가 발생했습니다',
    })
  }
}
