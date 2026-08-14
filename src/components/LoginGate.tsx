import { useState, type ReactNode } from 'react';
import { useAppStore } from '../store/appStore';

interface Props { children: ReactNode; }

export default function LoginGate({ children }: Props) {
  const mode = useAppStore(s => s.mode);
  const token = useAppStore(s => s.token);
  const loadDemoState = useAppStore(s => s.loadDemoState);
  const setAuth = useAppStore(s => s.setAuth);

  const [base, setBase] = useState('http://localhost:3000');
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [totp, setTotp] = useState('');
  const [show2fa, setShow2fa] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [wsChoices, setWsChoices] = useState<{ id: string; name: string; role: string }[] | null>(null);

  // Already authenticated
  if (mode === 'demo' || (mode === 'live' && token)) {
    return <>{children}</>;
  }

  const enterDemo = () => {
    loadDemoState();
  };

  const submit = async () => {
    setErr('');
    const url = base.trim().replace(/\/$/, '') || 'http://localhost:3000';
    const e = email.trim();
    const p = pass;
    const t = totp.trim();
    if (!e || !p) { setErr('Email and password required.'); return; }

    setBusy(true);
    try {
      const body: Record<string, string> = { email: e, password: p };
      if (t) body.totp = t;
      const res = await fetch(url + '/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        if (res.status === 401) { setErr('Invalid credentials.'); setBusy(false); return; }
        throw new Error('Login failed. Check the backend URL.');
      }
      const data = await res.json();

      // 2FA required
      if (data.twoFactorRequired) {
        setShow2fa(true);
        setErr(t ? 'Invalid code. Try again.' : 'Enter your two-factor code.');
        setBusy(false);
        return;
      }

      const wss: { id: string; name: string; role: string }[] = data.workspaces || [];
      if (wss.length === 0) { setErr('No workspaces on this account.'); setBusy(false); return; }

      if (wss.length === 1) {
        setAuth(data.accessToken, data.refreshToken);
      } else {
        setWsChoices(wss);
        // Store tokens temporarily for workspace pick
        setAuth(data.accessToken, data.refreshToken);
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Login failed. Check the backend URL.');
    }
    setBusy(false);
  };

  // Workspace picker after multi-workspace login
  if (wsChoices) {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'radial-gradient(1200px 600px at 85% -10%,#16233b 0%,transparent 60%),var(--ink)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}>
        <div style={{ width: '100%', maxWidth: 400 }}>
          <div style={{ textAlign: 'center', marginBottom: 6 }}>
            <div style={{ fontSize: 38, fontWeight: 800, color: 'var(--brand)', marginBottom: 4 }}>H</div>
            <h2 style={{ fontWeight: 800, fontSize: '20px', marginBottom: 4 }}>HigherPays</h2>
          </div>
          <div className="card" style={{ padding: 24 }}>
            <div style={{ fontSize: '13.2px', color: 'var(--muted)', marginBottom: 6 }}>Choose a workspace</div>
            {wsChoices.map(w => (
              <button key={w.id} className="btn ghost" style={{ width: '100%', marginBottom: 6, justifyContent: 'flex-start' }}
                onClick={() => setWsChoices(null)}>
                {w.name} · {w.role}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'radial-gradient(1200px 600px at 85% -10%,#16233b 0%,transparent 60%),var(--ink)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 6 }}>
          <div style={{ fontSize: 38, fontWeight: 800, color: 'var(--brand)', marginBottom: 4 }}>H</div>
          <h2 style={{ fontWeight: 800, fontSize: '20px', marginBottom: 4 }}>HigherPays</h2>
          <p style={{ color: 'var(--muted)', fontSize: '14.3px' }}>Merchant console</p>
        </div>

        {/* Login card */}
        <div className="card" style={{ padding: 24 }}>
          <div className="field">
            <label>Backend URL</label>
            <input type="text" value={base} onChange={e => setBase(e.target.value)} placeholder="http://localhost:3000" />
          </div>
          <div className="field">
            <label>Email</label>
            <input type="text" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@agency.com" />
          </div>
          <div className="field">
            <label>Password</label>
            <input type="password" value={pass} onChange={e => setPass(e.target.value)} placeholder="••••••••" />
          </div>
          {show2fa && (
            <div className="field">
              <label>Two-factor code</label>
              <input type="text" value={totp} onChange={e => setTotp(e.target.value)}
                inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit code" />
            </div>
          )}
          {err && <div style={{ color: 'var(--red)', fontSize: '14.3px', minHeight: 18, marginBottom: 6 }}>{err}</div>}
          <button className="btn" style={{ width: '100%' }} disabled={busy} onClick={submit}>
            {busy ? 'Logging in…' : 'Log in'}
          </button>
        </div>

        {/* Demo mode */}
        <div style={{ marginTop: 14, textAlign: 'center' }}>
          <button className="btn ghost" style={{ width: '100%' }} onClick={enterDemo}>
            Continue in demo mode (mock data)
          </button>
        </div>
      </div>
    </div>
  );
}
