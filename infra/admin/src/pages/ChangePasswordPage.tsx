import React, { useState } from 'react';
import { changeAdminPassword } from '../api';

interface Props {
  onDone: () => void;
}

export default function ChangePasswordPage({ onDone }: Props) {
  const [newPassword, setNewPassword]     = useState('');
  const [confirm, setConfirm]             = useState('');
  const [loading, setLoading]             = useState(false);
  const [error, setError]                 = useState('');
  const [success, setSuccess]             = useState(false);
  const [showNew, setShowNew]             = useState(false);
  const [showConfirm, setShowConfirm]     = useState(false);

  const requirements = [
    { label: 'At least 12 characters',  met: newPassword.length >= 12 },
    { label: 'Uppercase letter',         met: /[A-Z]/.test(newPassword) },
    { label: 'Number',                   met: /\d/.test(newPassword) },
    { label: 'Symbol (!#$%&*+,-.;=?^_~)', met: /[!#$%&*+,\-.;=?^_~]/.test(newPassword) },
  ];

  const allMet = requirements.every(r => r.met);
  const matches = newPassword === confirm && confirm !== '';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!allMet) { setError('Password does not meet requirements.'); return; }
    if (!matches) { setError('Passwords do not match.'); return; }

    setError('');
    setLoading(true);
    try {
      await changeAdminPassword(newPassword);
      setSuccess(true);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="max-w-md space-y-6">
        <h2 className="text-xl font-semibold text-gray-800">Change Admin Password</h2>
        <div className="bg-green-50 border border-green-200 rounded-xl p-6 flex flex-col items-center gap-4 text-center">
          <svg className="w-12 h-12 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <p className="text-green-800 font-medium">Password updated successfully</p>
          <p className="text-sm text-green-700">Both Cognito and Secrets Manager have been updated. Your next login will use the new password.</p>
          <button
            onClick={onDone}
            className="mt-2 px-5 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold rounded-lg transition"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md space-y-6">
      <h2 className="text-xl font-semibold text-gray-800">Change Admin Password</h2>
      <p className="text-sm text-gray-500">
        Updates the <code className="bg-gray-100 px-1 rounded text-xs">admin</code> account password in both Cognito and Secrets Manager simultaneously.
      </p>

      <form onSubmit={e => void handleSubmit(e)} className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-5">

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600">New Password <span className="text-red-500">*</span></label>
          <div className="relative">
            <input
              type={showNew ? 'text' : 'password'}
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
              placeholder="Enter new password"
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShowNew(v => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
            >
              {showNew ? 'Hide' : 'Show'}
            </button>
          </div>
          {/* Requirements checklist */}
          {newPassword && (
            <ul className="mt-2 space-y-1">
              {requirements.map(r => (
                <li key={r.label} className={`flex items-center gap-1.5 text-xs ${r.met ? 'text-green-600' : 'text-gray-400'}`}>
                  <span>{r.met ? '✓' : '○'}</span>
                  {r.label}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600">Confirm Password <span className="text-red-500">*</span></label>
          <div className="relative">
            <input
              type={showConfirm ? 'text' : 'password'}
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              className={`w-full border rounded-lg px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300 ${
                confirm && !matches ? 'border-red-300' : 'border-gray-200'
              }`}
              placeholder="Re-enter new password"
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShowConfirm(v => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
            >
              {showConfirm ? 'Hide' : 'Show'}
            </button>
          </div>
          {confirm && !matches && (
            <p className="text-xs text-red-500 mt-1">Passwords do not match</p>
          )}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>
        )}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={loading || !allMet || !matches}
            className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg transition text-sm"
          >
            {loading ? 'Updating…' : 'Update Password'}
          </button>
          <button
            type="button"
            onClick={onDone}
            className="px-4 py-2.5 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg transition"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
