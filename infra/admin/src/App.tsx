import React, { useEffect, useState } from 'react';
import { isAuthenticated, handleCallback, login, logout, getUser } from './auth';
import DashboardPage from './pages/DashboardPage';
import CreateQRPage from './pages/CreateQRPage';
import ChangePasswordPage from './pages/ChangePasswordPage';

type Page = 'dashboard' | 'create-qr' | 'change-password';

export default function App() {
  const [authed, setAuthed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState<Page>('dashboard');

  useEffect(() => {
    const init = async () => {
      if (window.location.search.includes('code=')) {
        const ok = await handleCallback();
        if (ok) { setAuthed(true); setLoading(false); return; }
      }
      setAuthed(isAuthenticated());
      setLoading(false);
    };
    void init();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  if (!authed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-xl shadow p-10 flex flex-col items-center gap-6 max-w-sm w-full">
          <h1 className="text-2xl font-bold text-gray-800">PAI Admin Console</h1>
          <p className="text-gray-500 text-sm text-center">Sign in with your admin account to manage workspace invites and members.</p>
          <button
            onClick={() => void login()}
            className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-2.5 rounded-lg transition"
          >
            Sign In
          </button>
        </div>
      </div>
    );
  }

  const user = getUser();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Nav */}
      <nav className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <span className="font-bold text-gray-800 text-lg">PAI Admin</span>
          <button
            onClick={() => setPage('dashboard')}
            className={`text-sm font-medium px-3 py-1.5 rounded-md transition ${page === 'dashboard' ? 'bg-orange-100 text-orange-700' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            Dashboard
          </button>
          <button
            onClick={() => setPage('create-qr')}
            className={`text-sm font-medium px-3 py-1.5 rounded-md transition ${page === 'create-qr' ? 'bg-orange-100 text-orange-700' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            Create QR
          </button>
          <button
            onClick={() => setPage('change-password')}
            className={`text-sm font-medium px-3 py-1.5 rounded-md transition ${page === 'change-password' ? 'bg-orange-100 text-orange-700' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            Change Password
          </button>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">{user?.username ?? user?.email}</span>
          <button
            onClick={logout}
            className="text-sm text-gray-500 hover:text-red-600 transition"
          >
            Sign Out
          </button>
        </div>
      </nav>

      {/* Content */}
      <main className="p-6 max-w-5xl mx-auto">
        {page === 'dashboard' && <DashboardPage />}
        {page === 'create-qr' && <CreateQRPage onCreated={() => setPage('dashboard')} />}
        {page === 'change-password' && <ChangePasswordPage onDone={() => setPage('dashboard')} />}
      </main>
    </div>
  );
}
