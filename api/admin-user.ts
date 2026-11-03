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
    .select('role, is_active')
    .eq('id', authResult.data.user.id)
    .single()

  // 비활성(퇴사) 계정의 남은 세션은 관리 API 를 쓸 수 없다 (D15 — DB 의 is_admin()/is_manager_or_admin() 과 같은 기준)
  if (!caller || caller.is_active === false || (caller.role !== 'admin' && caller.role !== 'manager')) {
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

  // PATCH(action=set_active): 퇴사(비활성화)·복직(재활성화)와 인증 차단을 한 번에 (D15)
  //   퇴사: employees.is_active=false → Auth ban(장기). 차단이 실패해도 비활성은 유지하고 207 로 재시도를 안내한다.
  //   복직: Auth ban 해제 → is_active=true. 해제가 실패하면 활성화하지 않는다(로그인 불가인 "활성" 상태를 남기지 않기 위해).
  //   둘 다 멱등이라 실패 시 같은 요청을 다시 보내면 된다. 이미 발급된 액세스 토큰은 만료(기본 1시간)까지 유효하다.
  if (req.method === 'PATCH' && req.body?.action === 'set_active') {
    const { userId, active } = req.body as { userId?: string; active?: boolean }
    if (!userId || typeof active !== 'boolean') {
      return res.status(400).json({ error: '사용자 ID와 활성 여부가 필요합니다' })
    }
    if (userId === authResult.data.user.id) {
      return res.status(400).json({ error: '본인 계정은 퇴사 처리할 수 없습니다' })
    }
    const { data: target } = await supabaseAdmin
      .from('employees')
      .select('id, role, is_active')
      .eq('id', userId)
      .single()
    if (!target) {
      return res.status(404).json({ error: '직원을 찾을 수 없습니다' })
    }
    if (caller.role === 'manager' && target.role === 'admin') {
      return res.status(403).json({ error: '관리자 계정은 다른 관리자만 처리할 수 있습니다' })
    }

    const steps: { employee: 'ok' | 'failed' | 'skipped'; auth: 'ok' | 'failed' | 'skipped' } = { employee: 'skipped', auth: 'skipped' }

    if (active) {
      const { error: unbanErr } = await supabaseAdmin.auth.admin.updateUserById(userId, { ban_duration: 'none' })
      if (unbanErr) {
        steps.auth = 'failed'
        return res.status(500).json({ error: '인증 차단 해제에 실패했습니다. 다시 시도하세요', steps })
      }
      steps.auth = 'ok'
      const { error: actErr } = await supabaseAdmin.from('employees').update({ is_active: true }).eq('id', userId)
      if (actErr) {
        steps.employee = 'failed'
        return res.status(500).json({ error: '복직 처리(활성화)에 실패했습니다. 인증 차단은 해제됐으니 다시 시도하세요', steps })
      }
      steps.employee = 'ok'
      return res.status(200).json({ success: true, steps })
    }

    const { error: deactErr } = await supabaseAdmin.from('employees').update({ is_active: false }).eq('id', userId)
    if (deactErr) {
      steps.employee = 'failed'
      return res.status(500).json({ error: '퇴사 처리(비활성화)에 실패했습니다', steps })
    }
    steps.employee = 'ok'
    const { error: banErr } = await supabaseAdmin.auth.admin.updateUserById(userId, { ban_duration: '876000h' })
    if (banErr) {
      steps.auth = 'failed'
      return res.status(207).json({ success: false, error: '비활성화는 됐지만 인증 차단에 실패했습니다. 다시 시도하세요', steps })
    }
    steps.auth = 'ok'
    return res.status(200).json({ success: true, steps })
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
