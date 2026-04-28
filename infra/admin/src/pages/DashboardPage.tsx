import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { listInvites, listMembers, extendInvite, revokeInvite, type Invite, type Member } from '../api';

function fmtDate(unix: number): string {
  if (!unix) return '-';
  return new Date(unix * 1000).toLocaleString();
}

function toDateInputValue(unix: number): string {
  const d = new Date(unix * 1000);
  return d.toISOString().substring(0, 10);
}

function StatusBadge({ invite }: { invite: Invite }) {
  if (!invite.isActive) return <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-600">Revoked</span>;
  if (invite.isExpired)  return <span className="px-2 py-0.5 text-xs rounded-full bg-red-100 text-red-600">Expired</span>;
  return <span className="px-2 py-0.5 text-xs rounded-full bg-green-100 text-green-700">Active</span>;
}

interface ExtendDialogProps {
  invite: Invite;
  onClose: () => void;
  onSave: (token: string, newExpiry: number) => Promise<void>;
}

function ExtendDialog({ invite, onClose, onSave }: ExtendDialogProps) {
  const minDate = toDateInputValue(Math.floor(Date.now() / 1000) + 86400);
  const defaultDate = toDateInputValue(
    invite.isExpired
      ? Math.floor(Date.now() / 1000) + 7 * 86400
      : invite.expiresAt + 7 * 86400,
  );
  const [dateValue, setDateValue] = useState(defaultDate);
  const [saving, setSaving] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  const handleSave = async () => {
    const newExpiry = Math.floor(new Date(dateValue + 'T23:59:59Z').getTime() / 1000);
    setSaving(true);
    try { await onSave(invite.token, newExpiry); onClose(); }
    finally { setSaving(false); }
  };

  return (
    <div ref={overlayRef} className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={e => { if (e.target === overlayRef.current) onClose(); }}>
      <div className="bg-white rounded-xl shadow-xl p-6 w-80 space-y-4">
        <h3 className="font-semibold text-gray-800">
          {invite.isExpired ? 'Renew' : 'Extend'} QR Expiry
        </h3>
        <p className="text-xs text-gray-500 truncate">Token: {invite.token}</p>
        <p className="text-xs text-gray-500">
          Current expiry: <span className="font-medium text-gray-700">{fmtDate(invite.expiresAt)}</span>
        </p>
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600">New expiry date</label>
          <input
            type="date"
            min={minDate}
            value={dateValue}
            onChange={e => setDateValue(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
          />
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 transition">Cancel</button>
          <button
            onClick={() => void handleSave()}
            disabled={saving || !dateValue}
            className="px-4 py-1.5 text-sm bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white rounded-lg transition font-medium"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface QRViewDialogProps {
  invite: Invite;
  onClose: () => void;
}

function QRViewDialog({ invite, onClose }: QRViewDialogProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const payload = {
      workspaceName:            invite.workspaceName,
      orgName:                  invite.orgName,
      region:                   invite.region,
      bucketName:               invite.bucketName,
      bucketPrefix:             invite.bucketPrefix,
      userPoolId:               invite.userPoolId,
      userPoolClientId:         invite.userPoolClientId,
      identityPoolId:           invite.identityPoolId,
      inviteApiEndpoint:        invite.inviteApiEndpoint,
      inviteToken:              invite.token,
      expiresAt:                new Date(invite.expiresAt * 1000).toISOString().replace('.000', '').replace(/\.\d{3}/, ''),
      requireEmailVerification: invite.requireEmailVerification,
    };
    QRCode.toDataURL(JSON.stringify(payload), { errorCorrectionLevel: 'M', width: 320, margin: 2 })
      .then(setQrDataUrl)
      .catch(e => setError(String(e)));
  }, [invite]);

  const downloadQR = () => {
    const a = document.createElement('a');
    a.href = qrDataUrl;
    a.download = `pai-invite-${invite.orgName}-${invite.token.substring(4, 10)}.png`;
    a.click();
  };

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={e => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className="bg-white rounded-xl shadow-xl p-6 w-96 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-semibold text-gray-800">{invite.workspaceName}</h3>
            <p className="text-xs text-gray-400 font-mono mt-0.5">{invite.token}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg p-2">{error}</p>}

        {qrDataUrl ? (
          <div className="flex flex-col items-center gap-3">
            <img src={qrDataUrl} alt="QR Code" className="w-64 h-64 border border-gray-100 rounded-lg" />
            <div className="w-full text-xs text-gray-500 space-y-0.5">
              <p>Expires: <span className="font-medium text-gray-700">{fmtDate(invite.expiresAt)}</span></p>
              <p>Uses: <span className="font-medium text-gray-700">{invite.usedCount}{invite.maxUses > 0 ? ` / ${invite.maxUses}` : ' / ∞'}</span></p>
            </div>
            <button
              onClick={downloadQR}
              className="w-full bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold py-2 rounded-lg transition"
            >
              Download QR Image
            </button>
          </div>
        ) : (
          !error && <p className="text-sm text-gray-400 text-center py-4">Generating QR…</p>
        )}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loadingInvites, setLoadingInvites] = useState(true);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [showExpired, setShowExpired] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'invites' | 'members'>('invites');
  const [extendTarget, setExtendTarget] = useState<Invite | null>(null);
  const [qrViewTarget, setQrViewTarget] = useState<Invite | null>(null);

  const fetchInvites = () => {
    setLoadingInvites(true);
    listInvites({ includeExpired: showExpired, includeInactive: showInactive })
      .then(r => setInvites(r.invites))
      .catch(e => setError(String(e)))
      .finally(() => setLoadingInvites(false));
  };

  useEffect(() => { fetchInvites(); }, [showExpired, showInactive]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setLoadingMembers(true);
    listMembers()
      .then(r => setMembers(r.users))
      .catch(e => setError(String(e)))
      .finally(() => setLoadingMembers(false));
  }, []);

  const handleExtend = async (token: string, newExpiry: number) => {
    await extendInvite(token, newExpiry);
    fetchInvites();
  };

  const handleRevoke = async (token: string) => {
    if (!confirm('Revoke this invite? Users will no longer be able to use this QR code.')) return;
    await revokeInvite(token);
    fetchInvites();
  };

  return (
    <div className="space-y-6">
      {extendTarget && (
        <ExtendDialog
          invite={extendTarget}
          onClose={() => setExtendTarget(null)}
          onSave={handleExtend}
        />
      )}
      {qrViewTarget && (
        <QRViewDialog
          invite={qrViewTarget}
          onClose={() => setQrViewTarget(null)}
        />
      )}
      <h2 className="text-xl font-semibold text-gray-800">Dashboard</h2>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
          <p className="text-sm text-gray-500">Active Invites</p>
          <p className="text-3xl font-bold text-green-600 mt-1">
            {invites.filter(i => i.isActive && !i.isExpired).length}
          </p>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
          <p className="text-sm text-gray-500">Total Members</p>
          <p className="text-3xl font-bold text-blue-600 mt-1">{members.length}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
          <p className="text-sm text-gray-500">Total Uses (all QRs)</p>
          <p className="text-3xl font-bold text-orange-600 mt-1">
            {invites.reduce((s, i) => s + i.usedCount, 0)}
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-200">
        {(['invites', 'members'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium transition capitalize ${
              activeTab === tab
                ? 'border-b-2 border-orange-500 text-orange-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Invites Tab */}
      {activeTab === 'invites' && (
        <div className="space-y-3">
          <div className="flex items-center gap-4 text-sm text-gray-600">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={showExpired} onChange={e => setShowExpired(e.target.checked)} />
              Show expired
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
              Show revoked
            </label>
          </div>

          {loadingInvites ? (
            <p className="text-gray-400 text-sm">Loading...</p>
          ) : invites.length === 0 ? (
            <p className="text-gray-400 text-sm">No invites found.</p>
          ) : (
            <div className="space-y-2">
              {invites.map(invite => (
                <div key={invite.token} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-0.5 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-gray-800">{invite.workspaceName}</span>
                        <span className="text-xs text-gray-400">{invite.orgName}</span>
                        <StatusBadge invite={invite} />
                      </div>
                      <p className="text-xs text-gray-400 font-mono truncate">{invite.token}</p>
                      <div className="text-xs text-gray-500 mt-1 flex gap-3 flex-wrap">
                        <span>Uses: <strong className="text-gray-700">{invite.usedCount}</strong>{invite.maxUses > 0 ? ` / ${invite.maxUses}` : ' / ∞'}</span>
                        <span>Expires: {fmtDate(invite.expiresAt)}</span>
                        <span>Created: {fmtDate(invite.createdAt)}</span>
                        {invite.requireEmailVerification && <span className="text-blue-600">Email verified</span>}
                      </div>
                      {/* Progress bar */}
                      {invite.maxUses > 0 && (
                        <div className="mt-2 h-1.5 bg-gray-100 rounded-full w-48">
                          <div
                            className="h-full bg-orange-400 rounded-full transition-all"
                            style={{ width: `${Math.min(100, (invite.usedCount / invite.maxUses) * 100)}%` }}
                          />
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2 shrink-0">
                      {invite.isActive && !invite.isExpired && (
                        <button
                          onClick={() => setQrViewTarget(invite)}
                          className="text-xs px-2.5 py-1.5 bg-purple-50 text-purple-700 rounded-lg hover:bg-purple-100 transition"
                        >
                          View QR
                        </button>
                      )}
                      {invite.isActive && !invite.isExpired && (
                        <button
                          onClick={() => setExtendTarget(invite)}
                          className="text-xs px-2.5 py-1.5 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition"
                        >
                          Extend
                        </button>
                      )}
                      {invite.isExpired && invite.isActive && (
                        <button
                          onClick={() => setExtendTarget(invite)}
                          className="text-xs px-2.5 py-1.5 bg-green-50 text-green-700 rounded-lg hover:bg-green-100 transition"
                        >
                          Renew
                        </button>
                      )}
                      {invite.isActive && (
                        <button
                          onClick={() => void handleRevoke(invite.token)}
                          className="text-xs px-2.5 py-1.5 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition"
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Members Tab */}
      {activeTab === 'members' && (
        <div>
          {loadingMembers ? (
            <p className="text-gray-400 text-sm">Loading...</p>
          ) : members.length === 0 ? (
            <p className="text-gray-400 text-sm">No members yet.</p>
          ) : (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-medium text-gray-600">Username</th>
                    <th className="text-left px-4 py-2.5 font-medium text-gray-600">Email</th>
                    <th className="text-left px-4 py-2.5 font-medium text-gray-600">Status</th>
                    <th className="text-left px-4 py-2.5 font-medium text-gray-600">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m, i) => (
                    <tr key={m.sub} className={i % 2 === 0 ? '' : 'bg-gray-50/50'}>
                      <td className="px-4 py-2.5 font-mono text-xs text-gray-700">{m.username}</td>
                      <td className="px-4 py-2.5 text-gray-700">{m.email || '-'}</td>
                      <td className="px-4 py-2.5">
                        <span className={`px-2 py-0.5 text-xs rounded-full ${
                          m.status === 'CONFIRMED' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                        }`}>
                          {m.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-gray-500 text-xs">{new Date(m.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
