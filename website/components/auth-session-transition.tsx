"use client";

import { useEffect } from "react";

function clearStaleSupabaseBrowserSessions() {
  for (const storage of [window.localStorage, window.sessionStorage]) {
    try {
      for (let index = storage.length - 1; index >= 0; index -= 1) {
        const key = storage.key(index);
        if (key?.startsWith("sb-") && key.includes("-auth-token")) {
          storage.removeItem(key);
        }
      }
    } catch {
      // Storage may be unavailable in a private browser context. The server
      // session exchanged by the callback remains the source of truth.
    }
  }
}

export function AuthSessionTransition({ nextPath }: { nextPath: string }) {
  useEffect(() => {
    clearStaleSupabaseBrowserSessions();
    window.location.replace(nextPath);
  }, [nextPath]);

  return (
    <main aria-live="polite">
      <p>جارٍ تأمين جلسة الدخول…</p>
    </main>
  );
}
