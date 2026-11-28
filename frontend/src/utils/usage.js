import { useCallback, useEffect, useState } from 'react';
import { API_BASE_URL } from '../config';

// Today's output credits for the signed-in weaver ({ used, limit, blocked, paused, resetAt, ... }).
// Returns null until loaded (or when the request fails: the server still enforces the limit).
export function useUsage() {
  const [usage, setUsage] = useState(null);
  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/usage`);
      if (res.ok) setUsage(await res.json());
    } catch { /* offline: leave as is */ }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return [usage, refresh, setUsage];
}

export function usageMessage(u) {
  if (!u) return '';
  const at = new Date(u.resetAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (u.paused) return 'Generation is paused by the administrator. Please wait until the next day.';
  if (u.used >= u.limit) return `Daily limit reached (${u.used}/${u.limit}). Your credits reset at ${at}.`;
  return '';
}
