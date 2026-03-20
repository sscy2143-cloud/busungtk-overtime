import type { Plugin } from 'vite'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const EMAIL_DOMAIN = '@busungtk.internal'

function loadEnvFile(): Record<string, string> {
  try {
    const content = readFileSync(resolve(process.cwd(), '.env'), 'utf-8')
    const env: Record<string, string> = {}
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const idx = trimmed.indexOf('=')
      if (idx > 0) {
        env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim()
      }
    }
    return env
  } catch { return {} }
}

export function apiPlugin(): Plugin {
  return {
    name: 'api-handler',
    configureServer(server) {
      const env = loadEnvFile()

      server.middlewares.use('/api/admin-user', async (req, res) => {
        const SUPABASE_URL = env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL!
        const SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY!
        const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!

        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Methods', 'POST, PUT, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

        if (req.method === 'OPTIONS') {
          res.statusCode = 204
          res.end()
          return
        }

        // Parse body
        const body = await new Promise<any>((resolve) => {
          let data = ''
          req.on('data', (chunk: Buffer) => { data += chunk.toString() })
          req.on('end', () => {
            try { resolve(JSON.parse(data)) } catch { resolve({}) }
          })
        })

        // JWT auth
        const authHeader = req.headers.authorization
        if (!authHeader?.startsWith('Bearer ')) {
          res.statusCode = 401
          res.end(JSON.stringify({ error: '인증이 필요합니다' }))
          return
        }

        const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          global: { headers: { Authorization: authHeader } },
        })
        const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(authHeader.split(' ')[1])
        if (authError || !user) {
          res.statusCode = 401
          res.end(JSON.stringify({ error: '인증이 필요합니다' }))
          return
        }

        // Check admin role (service role로 RLS 우회)
        const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
          auth: { autoRefreshToken: false, persistSession: false },
        })
        const { data: caller } = await supabaseAdmin
          .from('employees')
          .select('role')
          .eq('id', user.id)
          .single()

        if (!caller || (caller.role !== 'admin' && caller.role !== 'manager')) {
          res.statusCode = 403
          res.end(JSON.stringify({ error: '관리자 권한이 필요합니다' }))
          return
        }

        // POST: create user
        if (req.method === 'POST') {
          const { employeeNumber, name, password, department, role, employeeType } = body

          if (!employeeNumber || !name || !password) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: '사번, 이름, 비밀번호는 필수입니다' }))
            return
          }
          if (password.length < 6) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: '비밀번호는 6자 이상이어야 합니다' }))
            return
          }

          const email = `${employeeNumber.toLowerCase()}${EMAIL_DOMAIN}`

          const { data: authData, error: createErr } = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
          })

          if (createErr) {
            if (createErr.message.includes('already been registered')) {
              res.statusCode = 409
              res.end(JSON.stringify({ error: '이미 등록된 사번입니다' }))
              return
            }
            res.statusCode = 500
            res.end(JSON.stringify({ error: '계정 생성 실패' }))
            return
          }

          const { error: empError } = await supabaseAdmin
            .from('employees')
            .insert({
              id: authData.user.id,
              name,
              email,
              department: department || '',
              role: role || 'employee',
              employee_type: employeeType || 'office',
              hourly_wage: 0,
              is_active: true,
              force_password_change: true,
            })

          if (empError) {
            await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
            res.statusCode = 500
            res.end(JSON.stringify({ error: '직원 정보 등록 실패' }))
            return
          }

          res.statusCode = 201
          res.end(JSON.stringify({ success: true, userId: authData.user.id }))
          return
        }

        // PUT: reset password
        if (req.method === 'PUT') {
          const { userId, newPassword } = body

          if (!userId || !newPassword) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: '사용자 ID와 새 비밀번호는 필수입니다' }))
            return
          }
          if (newPassword.length < 6) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: '비밀번호는 6자 이상이어야 합니다' }))
            return
          }

          const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
            password: newPassword,
          })

          if (error) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: '비밀번호 초기화 실패' }))
            return
          }

          // 강제 비밀번호 변경 플래그 설정
          await supabaseAdmin
            .from('employees')
            .update({ force_password_change: true })
            .eq('id', userId)

          res.statusCode = 200
          res.end(JSON.stringify({ success: true }))
          return
        }

        res.statusCode = 405
        res.end(JSON.stringify({ error: '허용되지 않는 메서드입니다' }))
      })
    },
  }
}
