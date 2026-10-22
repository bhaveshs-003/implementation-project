import { supabase } from './supabase.js';

export async function apiFetch(path, options = {}) {
  const { body, headers: extraHeaders = {}, ...rest } = options;

  const { data: { session } } = await supabase.auth.getSession();
  if (session?.access_token) {
    document.cookie = `access_token=${session.access_token}; path=/; SameSite=Lax; Secure`;
  }

  const headers = { ...extraHeaders };
  let finalBody = body;

  if (body && typeof body === 'object' && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    finalBody = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(path, {
      credentials: 'include',
      headers,
      body: finalBody,
      ...rest,
    });
  } catch {
    throw { status: 0, error: 'Cannot reach the server. Check your connection or try again shortly.' };
  }

  let data;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    data = await res.json();
  } else {
    data = await res.text();
  }

  if (!res.ok) {
    const err = { status: res.status, error: (data && data.error) || data || 'Request failed' };
    throw err;
  }

  return data;
}
