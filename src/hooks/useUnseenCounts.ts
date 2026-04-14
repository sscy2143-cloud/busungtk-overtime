import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const SEEN_KEY_PREFIX = 'busungtk_seen_'

function getSeenIds(key: string): Set<string> {
  try {
    const stored = localStorage.getItem(key)
    return stored ? new Set(JSON.parse(stored)) : new Set()
  } catch {
    return new Set()
  }
}

function saveSeenIds(key: string, ids: Set<string>) {
  localStorage.setItem(key, JSON.stringify([...ids]))
}

export function markAsSeen(category: string, employeeId: string, itemId: string) {
  const key = `${SEEN_KEY_PREFIX}${category}_${employeeId}`
  const seen = getSeenIds(key)
  seen.add(itemId)
  saveSeenIds(key, seen)
  // Dispatch custom event so sidebar can update
  window.dispatchEvent(new CustomEvent('unseen-updated'))
}

export function useUnseenCounts(employeeId: string | undefined, isAdmin: boolean) {
  const [overtimeCount, setOvertimeCount] = useState(0)
  const [leaveCount, setLeaveCount] = useState(0)
  const [expenseCount, setExpenseCount] = useState(0)

  const refresh = useCallback(async () => {
    if (!employeeId || !isAdmin) return

    // Fetch pending overtime requests
    const { data: overtimes } = await supabase
      .from('overtime_requests')
      .select('id')
      .in('status', ['pending', 'manager_approved'])

    if (overtimes) {
      const seen = getSeenIds(`${SEEN_KEY_PREFIX}overtime_${employeeId}`)
      // Clean up seen IDs that are no longer pending (item was approved/rejected)
      const currentIds = new Set(overtimes.map(r => r.id))
      const cleanedSeen = new Set([...seen].filter(id => currentIds.has(id)))
      if (cleanedSeen.size !== seen.size) {
        saveSeenIds(`${SEEN_KEY_PREFIX}overtime_${employeeId}`, cleanedSeen)
      }
      setOvertimeCount(overtimes.filter(r => !cleanedSeen.has(r.id)).length)
    }

    // Fetch pending leave requests
    const { data: leaves } = await supabase
      .from('leave_requests')
      .select('id')
      .in('status', ['pending', 'manager_approved'])

    if (leaves) {
      const seen = getSeenIds(`${SEEN_KEY_PREFIX}leave_${employeeId}`)
      const currentIds = new Set(leaves.map(r => r.id))
      const cleanedSeen = new Set([...seen].filter(id => currentIds.has(id)))
      if (cleanedSeen.size !== seen.size) {
        saveSeenIds(`${SEEN_KEY_PREFIX}leave_${employeeId}`, cleanedSeen)
      }
      setLeaveCount(leaves.filter(r => !cleanedSeen.has(r.id)).length)
    }

    // Fetch pending expenses
    const { data: expenses } = await supabase
      .from('expenses')
      .select('id')
      .eq('status', 'pending')

    if (expenses) {
      const seen = getSeenIds(`${SEEN_KEY_PREFIX}expense_${employeeId}`)
      const currentIds = new Set(expenses.map(r => r.id))
      const cleanedSeen = new Set([...seen].filter(id => currentIds.has(id)))
      if (cleanedSeen.size !== seen.size) {
        saveSeenIds(`${SEEN_KEY_PREFIX}expense_${employeeId}`, cleanedSeen)
      }
      setExpenseCount(expenses.filter(r => !cleanedSeen.has(r.id)).length)
    }
  }, [employeeId, isAdmin])

  useEffect(() => {
    refresh()
    // Listen for seen updates from pages
    const handler = () => refresh()
    window.addEventListener('unseen-updated', handler)
    // Refresh periodically (every 30 seconds)
    const interval = setInterval(refresh, 30000)
    return () => {
      window.removeEventListener('unseen-updated', handler)
      clearInterval(interval)
    }
  }, [refresh])

  return { overtimeCount, leaveCount, expenseCount, refresh }
}
