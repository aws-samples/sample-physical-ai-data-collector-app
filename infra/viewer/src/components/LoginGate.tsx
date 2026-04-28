import { useEffect, useState } from 'react';
import { isAuthenticated, handleCallback, login } from '../auth';

export default function LoginGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    (async () => {
      // Handle OAuth callback if code is in URL
      if (new URLSearchParams(window.location.search).has('code')) {
        await handleCallback();
      }
      setAuthed(isAuthenticated());
      setReady(true);
    })();
  }, []);

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0d1117]">
        <span className="spinner w-6 h-6 text-sky-400" />
      </div>
    );
  }

  if (!authed) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-8 bg-[#0d1117] px-4">
        <div className="flex flex-col items-center gap-3">
          <svg viewBox="0 0 24 24" className="w-12 h-12 text-sky-400" fill="none"
            stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 20 L8 8 L12 14 L16 6 L22 20" />
            <circle cx="16" cy="6" r="1.5" fill="currentColor" stroke="none" />
          </svg>
          <span className="font-mono text-sky-400 font-semibold text-lg tracking-widest uppercase">
            PAI Data Viewer
          </span>
          <p className="text-slate-400 text-sm text-center max-w-sm">
            Review and label physical-AI training captures from your Android devices.
          </p>
        </div>
        <button onClick={login} className="btn btn-primary px-8 py-2.5 text-base">
          Sign in with Cognito
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
