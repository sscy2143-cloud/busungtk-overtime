import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase, isDemoMode } from '../lib/supabase'
import type { Employee } from '../types'
import type { User, Session } from '@supabase/supabase-js'

interface AuthState {
  user: User | null
  employee: Employee | null
  session: Session | null
  loading: boolean
  isDemo: boolean
  signInWithGoogle: () => Promise<void>
  signInAsDemo: (password: string) => Promise<boolean>
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
        fetchEmployee(session.user.id)
      } else {
        setEmployee(null)
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function fetchEmployee(userId: string) {
    const { data } = await supabase
      .from('employees')
      .select('*')
      .eq('id', userId)
      .single()

    if (data) {
      setEmployee(data)
    } else {
      // 첫 Google 로그인 → RPC로 자동 등록 (첫 사용자 = admin, 이후 = employee)
      const authUser = (await supabase.auth.getUser()).data.user
      if (authUser) {
        const meta = authUser.user_metadata ?? {}
        const { data: registered } = await supabase.rpc('register_employee', {
          p_id: userId,
          p_name: meta.full_name || meta.name || authUser.email?.split('@')[0] || '사용자',
          p_email: authUser.email ?? '',
          p_avatar_url: meta.avatar_url ?? null,
        })
        setEmployee(registered as Employee | null)
      }
    }
    setLoading(false)
  }

  async function signInWithGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
  }

  async function signInAsDemo(password: string): Promise<boolean> {
    if (password !== '6325') return false

    if (isDemoMode) {
      // 로컬 개발: env 변수 없으면 기존 데모 모드
      const demoEmp = DEMO_EMPLOYEES.admin
      setEmployee(demoEmp)
      setUser({ id: demoEmp.id, email: demoEmp.email } as User)
      setIsDemo(true)
      setLoading(false)
      return true
    }

    // 프로덕션: 실제 Supabase 인증
    const { error } = await supabase.auth.signInWithPassword({
      email: 'dev@busungtk.com',
      password: 'busungtk6325',
    })

    if (error) {
      console.error('[AuthContext] dev login error:', error.message)
      return false
    }

    // onAuthStateChange가 세션을 감지하고 fetchEmployee를 호출함
    setIsDemo(true)
    return true
  }

  async function signOut() {
    await supabase.auth.signOut()
    setUser(null)
    setEmployee(null)
    setSession(null)
    setIsDemo(false)
  }

  return (
    <AuthContext.Provider value={{ user, employee, session, loading, isDemo, signInWithGoogle, signInAsDemo, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
