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
  const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://busungtk-overtime-beta.vercel.app'
  const origin = req.headers.origin
  if (origin === allowedOrigin || origin === 'https://busungtk-overtime.vercel.app' || process.env.NODE_ENV === 'development') {
    res.setHeader('Access-Control-Allow-Origin', origin || '*')
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, PUT, PATCH, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(204).end()

  // JWT 인증
  const authResult = await verifyAuth(req)
  if (!authResult || authResult.error || !authResult.data.user) {
    return res.status(401).json({ error: '인증이 필요합니다' })
  }

  // 관리자 권한 확인 (서비스 롤로 조회 — anon은 RLS에 막힘)
  const supabaseService = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
  const { data: caller } = await supabaseService
    .from('employees')
    .select('role')
    .eq('id', authResult.data.user.id)
    .single()

  if (!caller || (caller.role !== 'admin' && caller.role !== 'manager')) {
    return res.status(403).json({ error: '관리자 권한이 필요합니다' })
  }

  const supabaseAdmin = supabaseService

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
    const { userId, newPassword, adminPassword } = req.body

    if (!userId || !newPassword) {
      return res.status(400).json({ error: '사용자 ID와 새 비밀번호는 필수입니다' })
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: '비밀번호는 6자 이상이어야 합니다' })
    }

    // 관리자 본인 비밀번호 서버에서 검증 (클라이언트에서 signInWithPassword 호출 시 세션 변경 부작용 방지)
    if (!adminPassword) {
      return res.status(400).json({ error: '본인 비밀번호를 입력하세요' })
    }
    const callerEmail = authResult.data.user.email!
    const supabaseVerify = createClient(
      process.env.VITE_SUPABASE_URL!,
      process.env.VITE_SUPABASE_ANON_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )
    const { error: verifyErr } = await supabaseVerify.auth.signInWithPassword({
      email: callerEmail,
      password: adminPassword,
    })
    if (verifyErr) {
      return res.status(401).json({ error: '본인 비밀번호가 올바르지 않습니다' })
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

  // PATCH: 사번 변경 (Auth 이메일 + employees.email 동시 변경)
  if (req.method === 'PATCH') {
    const { userId, newEmployeeNumber } = req.body

    if (!userId || !newEmployeeNumber) {
      return res.status(400).json({ error: '사용자 ID와 새 사번은 필수입니다' })
    }

    const newEmail = `${newEmployeeNumber.toLowerCase()}${EMAIL_DOMAIN}`

    // Auth 이메일 변경 (SDK 대신 REST API 직접 호출 — SDK email_confirm 호환 문제 우회)
    const supabaseUrl = process.env.VITE_SUPABASE_URL!
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
    const authRes = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
      method: 'PUT',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: newEmail, email_confirm: true }),
    })

    if (!authRes.ok) {
      const errBody = await authRes.text()
      if (errBody.includes('already been registered') || errBody.includes('duplicate')) {
        return res.status(409).json({ error: '이미 사용 중인 사번입니다' })
      }
      return res.status(500).json({ error: `사번 변경 실패: ${errBody}` })
    }

    // employees 테이블 이메일 업데이트
    const { error: empError } = await supabaseAdmin
      .from('employees')
      .update({ email: newEmail })
      .eq('id', userId)

    if (empError) {
      // 롤백: Auth 이메일 원복은 어렵지만 로그 남김
      console.error('employees 테이블 이메일 업데이트 실패:', empError)
      return res.status(500).json({ error: '직원 정보 업데이트 실패' })
    }

    return res.status(200).json({ success: true, newEmail })
  }

  return res.status(405).json({ error: '허용되지 않는 메서드입니다' })
}
