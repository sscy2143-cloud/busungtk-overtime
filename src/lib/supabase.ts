import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isDemoMode = !supabaseUrl || !supabaseAnonKey

// 데모 모드에서도 Supabase 연결 (RPC 호출 필요)
// 환경변수가 없으면 Proxy로 대체
export const supabase: SupabaseClient = isDemoMode
  ? new Proxy({} as SupabaseClient, {
      get(_target, prop) {
        if (prop === 'auth') {
          return {
            getSession: () => Promise.resolve({ data: { session: null }, error: null }),
            onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
            signInWithOAuth: () => Promise.resolve({ data: null, error: null }),
            signOut: () => Promise.resolve({ error: null }),
          }
        }
        if (prop === 'from') {
          return () => ({
            select: () => ({ order: () => Promise.resolve({ data: [], error: null }), eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }),
            insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }),
            update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
            delete: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
          })
        }
        if (prop === 'rpc') {
          return () => Promise.resolve({ data: [], error: null })
        }
        return () => {}
      },
    })
  : createClient(supabaseUrl, supabaseAnonKey)
