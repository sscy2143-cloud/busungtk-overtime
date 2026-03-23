import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const EMAIL_DOMAIN = '@busungtk.internal'

function verifyAuth(req: VercelRequest) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) return null
  const supabase = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.VITE_SUPABASE_ANON_KEY!,
  )
  return supabase.auth.getUser(authHeader.split(' ')[1])
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  const allowed = 'https://busungtk-overtime.vercel.app'
  const origin = req.headers.origin
  if (origin === allowed || process.env.NODE_ENV === 'development') {
    res.setHeader('Access-Control-Allow-Origin', origin || '*')
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, PUT, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(204).end()

  // JWT 인증
  const authResult = await verifyAuth(req)
  if (!authResult || authResult.error || !authResult.data.user) {
    return res.status(401).json({ error: '인증이 필요합니다' })
  }

  // 관리자 권한 확인
  const supabaseAnon = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.VITE_SUPABASE_ANON_KEY!,
  )
  const { data: caller } = await supabaseAnon
    .from('employees')
    .select('role')
    .eq('id', authResult.data.user.id)
    .single()

  if (!caller || (caller.role !== 'admin' && caller.role !== 'manager')) {
    return res.status(403).json({ error: '관리자 권한이 필요합니다' })
  }

  // 서비스 롤 클라이언트 (사용자 생성/비밀번호 변경용)
  const supabaseAdmin = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // POST: 직원 계정 생성
  if (req.method === 'POST') {
    const { employeeNumber, name, password, department, role, employeeType } = req.body

    if (!employeeNumber || !name || !password) {
      return res.status(400).json({ error: '사번, 이름, 비밀번호는 필수입니다' })
    }

    if (password.length < 6) {
      return res.status(400).json({ error: '비밀번호는 6자 이상이어야 합니다' })
    }

    // 매니저는 employee 역할만 생성 가능 (권한 상승 방지)
    const requestedRole = role || 'employee'
    if (caller.role === 'manager' && requestedRole !== 'employee') {
      return res.status(403).json({ error: '매니저는 일반 직원만 생성할 수 있습니다' })
    }

    const email = `${employeeNumber.toLowerCase()}${EMAIL_DOMAIN}`

    // 1. Supabase Auth 사용자 생성
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })

    if (authError) {
      if (authError.message.includes('already been registered')) {
        return res.status(409).json({ error: '이미 등록된 사번입니다' })
      }
      return res.status(500).json({ error: '계정 생성 실패' })
    }

    // 2. employees 테이블에 직원 정보 등록
    const { error: empError } = await supabaseAdmin
      .from('employees')
      .insert({
        id: authData.user.id,
        name,
        email,
        department: department || '',
        role: requestedRole,
        employee_type: employeeType || 'office',
        hourly_wage: 0,
        is_active: true,
        force_password_change: true,
      })

    if (empError) {
      // 롤백: auth 사용자 삭제
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
      return res.status(500).json({ error: '직원 정보 등록 실패' })
    }

    return res.status(201).json({ success: true, userId: authData.user.id })
  }

  // PUT: 비밀번호 초기화
  if (req.method === 'PUT') {
    const { userId, newPassword } = req.body

    if (!userId || !newPassword) {
      return res.status(400).json({ error: '사용자 ID와 새 비밀번호는 필수입니다' })
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: '비밀번호는 6자 이상이어야 합니다' })
    }

    // 매니저는 관리자 비밀번호 초기화 불가
    if (caller.role === 'manager') {
      const { data: target } = await supabaseAdmin
        .from('employees')
        .select('role')
        .eq('id', userId)
        .single()
      if (target?.role === 'admin') {
        return res.status(403).json({ error: '관리자 비밀번호는 다른 관리자만 초기화할 수 있습니다' })
      }
    }

    const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      password: newPassword,
    })

    if (error) {
      return res.status(500).json({ error: '비밀번호 초기화 실패' })
    }

    // 강제 비밀번호 변경 플래그 설정
    await supabaseAdmin
      .from('employees')
      .update({ force_password_change: true })
      .eq('id', userId)

    return res.status(200).json({ success: true })
  }

  return res.status(405).json({ error: '허용되지 않는 메서드입니다' })
}
