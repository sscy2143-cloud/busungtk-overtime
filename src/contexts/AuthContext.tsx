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
  signInAsDemo: (role: 'employee' | 'manager' | 'admin') => void
  signOut: () => Promise<void>
}

const DEMO_EMPLOYEES: Record<string, Employee> = {
  employee: {
    id: 'demo-emp-001',
    name: '김현장',
    email: 'kim@busungtk.com',
    avatar_url: undefined,
    department: '설치팀',
    role: 'employee',
    employee_type: 'field',
    hourly_wage: 15000,
    manager_id: 'demo-mgr-001',
    is_active: true,
    created_at: '2024-01-01T00:00:00Z',
  },
  manager: {
    id: 'demo-mgr-001',
    name: '정팀장',
    email: 'jung@busungtk.com',
    avatar_url: undefined,
    department: '설치팀',
    role: 'manager',
    employee_type: 'office',
    hourly_wage: 20000,
    manager_id: null,
    is_active: true,
    created_at: '2024-01-01T00:00:00Z',
  },
  admin: {
    id: 'demo-adm-001',
    name: '최인사',
    email: 'choi@busungtk.com',
    avatar_url: undefined,
    department: '경영지원',
    role: 'admin',
    employee_type: 'office',
    hourly_wage: 25000,
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

    setEmployee(data)
    setLoading(false)
  }

  async function signInWithGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
  }

  function signInAsDemo(role: 'employee' | 'manager' | 'admin') {
    const demoEmp = DEMO_EMPLOYEES[role]
    setEmployee(demoEmp)
    setUser({ id: demoEmp.id, email: demoEmp.email } as User)
    setIsDemo(true)
    setLoading(false)
  }

  async function signOut() {
    if (isDemo) {
      setUser(null)
      setEmployee(null)
      setSession(null)
      setIsDemo(false)
      return
    }
    await supabase.auth.signOut()
    setUser(null)
    setEmployee(null)
    setSession(null)
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
