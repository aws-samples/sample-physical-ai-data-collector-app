import React, { useState } from 'react';
import QRCode from 'qrcode';
import { createInvite, type QRPayload } from '../api';

interface Props {
  onCreated: () => void;
}

const DEFAULT_APP_CONFIG = {
  region:            import.meta.env.VITE_REGION ?? 'ap-northeast-2',
  bucketName:        import.meta.env.VITE_APP_BUCKET_NAME ?? '',
  bucketPrefix:      '',
  autoCreatePrefix:  false,
  userPoolId:        import.meta.env.VITE_APP_USER_POOL_ID ?? '',
  userPoolClientId:  import.meta.env.VITE_APP_USER_POOL_CLIENT_ID ?? '',
  identityPoolId:    import.meta.env.VITE_APP_IDENTITY_POOL_ID ?? '',
  inviteApiEndpoint: import.meta.env.VITE_INVITE_API_ENDPOINT ?? '',
};

export default function CreateQRPage({ onCreated }: Props) {
  const [form, setForm] = useState({
    workspaceName:            '',
    orgName:                  '',
    timeWindowHours:          168,
    maxUsers:                 0,
    requireEmailVerification: false,
    dailyQuotaGB:             0,
    totalQuotaGB:             0,
    ...DEFAULT_APP_CONFIG,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ qrDataUrl: string; payload: QRPayload } | null>(null);

  const set = (key: string, value: unknown) =>
    setForm(f => ({ ...f, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.workspaceName.trim() || !form.orgName.trim()) {
      setError('Workspace name and org name are required.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await createInvite({ ...form, maxUses: form.maxUsers });
      const dataUrl = await QRCode.toDataURL(JSON.stringify(res.qrPayload), {
        errorCorrectionLevel: 'M',
        width: 400,
        margin: 2,
      });
      setResult({ qrDataUrl: dataUrl, payload: res.qrPayload });
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const downloadQR = () => {
    if (!result) return;
    const a = document.createElement('a');
    a.href = result.qrDataUrl;
    a.download = `pai-invite-${form.orgName}-${Date.now()}.png`;
    a.click();
  };

  if (result) {
    return (
      <div className="space-y-6 max-w-lg">
        <h2 className="text-xl font-semibold text-gray-800">QR Created Successfully</h2>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex flex-col items-center gap-4">
          <img src={result.qrDataUrl} alt="QR Code" className="w-64 h-64" />
          <button
            onClick={downloadQR}
            className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-2.5 rounded-lg transition"
          >
            Download QR Image
          </button>
        </div>

        <div className="bg-gray-50 rounded-xl border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">QR Payload (JSON)</h3>
          <pre className="text-xs text-gray-600 overflow-auto">{JSON.stringify(result.payload, null, 2)}</pre>
        </div>

        <button
          onClick={() => { setResult(null); setForm(f => ({ ...f, workspaceName: '', orgName: '' })); }}
          className="text-sm text-gray-500 hover:text-orange-600 transition"
        >
          Create Another
        </button>
        <button
          onClick={onCreated}
          className="ml-4 text-sm text-gray-500 hover:text-blue-600 transition"
        >
          Back to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-lg space-y-6">
      <h2 className="text-xl font-semibold text-gray-800">Create Workspace QR</h2>

      <form onSubmit={e => void handleSubmit(e)} className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-5">

        <section className="space-y-3">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Workspace Info</h3>
          <Field label="Workspace Name" required>
            <input
              className={input}
              placeholder="e.g. Robot Lab A"
              value={form.workspaceName}
              onChange={e => set('workspaceName', e.target.value)}
            />
          </Field>
          <Field label="Org Name (slug)" required>
            <input
              className={input}
              placeholder="e.g. robot-lab-a"
              value={form.orgName}
              onChange={e => set('orgName', e.target.value.toLowerCase().replace(/\s/g, '-'))}
            />
          </Field>
        </section>

        <section className="space-y-3">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Invite Settings</h3>
          <Field label={`Validity Window: ${form.timeWindowHours}h (${(form.timeWindowHours / 24).toFixed(1)} days)`}>
            <input
              type="range" min={1} max={720} step={1}
              value={form.timeWindowHours}
              onChange={e => set('timeWindowHours', Number(e.target.value))}
              className="w-full accent-orange-500"
            />
          </Field>
          <Field label="Max Users (0 = unlimited)">
            <input
              type="number" min={0} className={input}
              value={form.maxUsers}
              onChange={e => set('maxUsers', Number(e.target.value))}
            />
          </Field>
          <Field label="">
            <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
              <input
                type="checkbox"
                checked={form.requireEmailVerification}
                onChange={e => set('requireEmailVerification', e.target.checked)}
                className="accent-orange-500"
              />
              Require email verification
            </label>
          </Field>
        </section>

        <section className="space-y-3">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Quota (0 = unlimited)</h3>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Daily Quota (GB)">
              <input type="number" min={0} step={0.1} className={input} value={form.dailyQuotaGB}
                onChange={e => set('dailyQuotaGB', Number(e.target.value))} />
            </Field>
            <Field label="Total Quota (GB)">
              <input type="number" min={0} step={0.1} className={input} value={form.totalQuotaGB}
                onChange={e => set('totalQuotaGB', Number(e.target.value))} />
            </Field>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">App Infrastructure Config</h3>
          <p className="text-xs text-gray-400">These values are embedded in the QR code so the app can connect to the right AWS resources. Cognito IDs are pre-filled from your deployment.</p>
          <Field label="Region">
            <input
              className={input}
              value={form.region}
              onChange={e => set('region', e.target.value)}
            />
          </Field>
          <Field label="S3 Bucket Name">
            <input
              className={input}
              placeholder="e.g. pai-raw-data-123456789012"
              value={form.bucketName}
              onChange={e => set('bucketName', e.target.value)}
            />
          </Field>
          <Field label="S3 Bucket Prefix (optional)">
            <div className="space-y-2">
              <input
                className={input}
                placeholder="e.g. workspaces/robot-lab-a"
                value={form.bucketPrefix}
                onChange={e => set('bucketPrefix', e.target.value)}
              />
              <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={form.autoCreatePrefix}
                  onChange={e => set('autoCreatePrefix', e.target.checked)}
                  className="accent-orange-500"
                />
                Auto-create prefix in S3 on first upload
              </label>
            </div>
          </Field>
          <Field label="Invite API Endpoint">
            <input
              className={input}
              value={form.inviteApiEndpoint}
              onChange={e => set('inviteApiEndpoint', e.target.value)}
            />
          </Field>

          <div className="rounded-lg bg-blue-50 border border-blue-100 p-3 space-y-3">
            <p className="text-xs font-medium text-blue-700">Cognito (pre-filled from deployment)</p>
            {[
              { key: 'userPoolId',       label: 'User Pool ID' },
              { key: 'userPoolClientId', label: 'User Pool Client ID' },
              { key: 'identityPoolId',   label: 'Identity Pool ID' },
            ].map(({ key, label }) => (
              <Field key={key} label={label}>
                <input
                  className={input}
                  value={(form as unknown as Record<string, string>)[key]}
                  onChange={e => set(key, e.target.value)}
                />
              </Field>
            ))}
          </div>
        </section>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 rounded-lg p-2">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg transition"
        >
          {loading ? 'Creating...' : 'Generate QR Code'}
        </button>
      </form>
    </div>
  );
}

const input = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300';

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      {label && (
        <label className="text-xs font-medium text-gray-600">
          {label}{required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
      )}
      {children}
    </div>
  );
}
