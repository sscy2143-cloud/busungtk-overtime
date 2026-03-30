import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase, isDemoMode } from '../lib/supabase'
import type { Employee } from '../types'
import type { User, Session } from '@supabase/supabase-js'

const EMAIL_DOMAIN = '@busungtk.internal'

interface AuthState {
  user: User | null
  employee: Employee | null
  session: Session | null
  loading: boolean
  isDemo: boolean
  signInWithPassword: (employeeNumber: string, password: string) => Promise<{ success: boolean; error?: string }>
  signInAsDemo: (password: string) => Promise<boolean>
  changePassword: (newPassword: string) => Promise<{ success: boolean; error?: string }>
  signOut: () => Promise<void>
}

const DEMO_EMPLOYEES: Record<string, Employee> = {
  admin: {
    id: 'demo-adm-001',
    name: '관리자 (데모)',
    email: 'admin@busungtk.com',
    avatar_url: undefined,
    department: '경영지원',
    role: 'admin',
    employee_type: 'office',
    hourly_wage: 0,
    manager_id: null,
    is_active: true,
    created_at: '2024-01-01T00:00:00Z',
  },
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [isDemo, setIsDemo] = useState(false)

  useEffect(() => {
    if (isDemoMode) {
      setLoading(false)
      return
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) {
        fetchEmployee(session.user.id)
      } else {
        setLoading(false)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) {
        setLoading(true)
        fetchEmployee(session.user.id)
      } else {
        setEmployee(null)
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function fetchEmployee(userId: string) {
    const { data, error } = await supabase
      .from('employees')
      .select('*')
      .eq('id', userId)
      .single()

    if (error) {
      console.error('fetchEmployee error:', error.message, error.code)
    }
    if (data) {
      setEmployee(data)
    }
    setLoading(false)
  }

  async function signInWithPassword(employeeNumber: string, password: string): Promise<{ success: boolean; error?: string }> {
    const email = employeeNumber.includes('@')
      ? employeeNumber
      : `${employeeNumber.toLowerCase()}${EMAIL_DOMAIN}`

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      if (error.message.includes('Invalid login credentials')) {
        return { success: false, error: '사번 또는 비밀번호가 올바르지 않습니다' }
      }
      return { success: false, error: '로그인 중 오류가 발생했습니다' }
    }

    return { success: true }
  }

  async function signInAsDemo(password: string): Promise<boolean> {
    if (!import.meta.env.DEV) return false

    const DEMO_LIMIT_KEY = 'busungtk_demo_attempts'
    const stored = JSON.parse(localStorage.getItem(DEMO_LIMIT_KEY) || '{"count":0,"lockedUntil":0}')
    if (Date.now() < stored.lockedUntil) return false
    if (password !== '0527') {
      const newCount = stored.count + 1
      localStorage.setItem(DEMO_LIMIT_KEY, JSON.stringify(
        newCount >= 5 ? { count: 0, lockedUntil: Date.now() + 60000 } : { count: newCount, lockedUntil: 0 }
      ))
      return false
    }
    localStorage.removeItem(DEMO_LIMIT_KEY)

    const demoEmp = DEMO_EMPLOYEES.admin
    setEmployee(demoEmp)
    setUser({ id: demoEmp.id, email: demoEmp.email } as User)
    setIsDemo(true)
    setLoading(false)
    return true
  }

  async function changePassword(newPassword: string): Promise<{ success: boolean; error?: string }> {
    // 1. 비밀번호 변경 먼저 수행
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) {
      return { success: false, error: '비밀번호 변경에 실패했습니다' }
    }

    // 2. force_password_change 플래그 해제 (여러 방법 시도)
    if (employee) {
      // 방법 1: RPC 호출
      const { error: rpcError } = await supabase.rpc('clear_force_password_change')
      if (rpcError) {
        console.warn('clear_force_password_change RPC failed, trying direct update:', rpcError)
        // 방법 2: 직접 update (manager/admin은 RLS 통과)
        await supabase
          .from('employees')
          .update({ force_password_change: false })
          .eq('id', employee.id)
      }
      // 로컬 상태 즉시 반영
      setEmployee({ ...employee, force_password_change: false })
    }

    return { success: true }
  }

  async function signOut() {
    await supabase.auth.signOut()
    setUser(null)
    setEmployee(null)
    setSession(null)
    setIsDemo(false)
  }

  // 15분 비활성 자동 로그아웃 (금융 등급 보안)
  useEffect(() => {
    if (!user && !isDemo) return
    const INACTIVITY_MS = 15 * 60 * 1000
    let timeout: ReturnType<typeof setTimeout>

    function resetTimer() {
      clearTimeout(timeout)
      timeout = setTimeout(() => {
        signOut()
        window.location.href = '/'
      }, INACTIVITY_MS)
    }

    const events = ['mousedown', 'keydown', 'touchstart', 'scroll'] as const
    events.forEach(e => window.addEventListener(e, resetTimer))
    resetTimer()

    return () => {
      clearTimeout(timeout)
      events.forEach(e => window.removeEventListener(e, resetTimer))
    }
  }, [user, isDemo])

  return (
    <AuthContext.Provider value={{ user, employee, session, loading, isDemo, signInWithPassword, signInAsDemo, changePassword, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
