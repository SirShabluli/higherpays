import { useState, useMemo } from 'react';
import { useAppStore } from '../../store/appStore';
import { useCan } from '../../hooks/usePermission';
import Modal from '../../components/Modal';
import { toast } from '../../components/Toast';

const fmt = (n: number) => {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }).format(n); }
  catch { return 'EUR ' + n.toFixed(2); }
};

// Mock volumes per workspace for demo
const MOCK_VOLUMES: Record<string, number> = { ws1: 41200, ws2: 18800, ws3: 26500 };

// Demo activity feed
function demoActivity() {
  const n = Date.now();
  return [
    { action: 'link.create', workspace: 'Aurora Media', actor: 'Sam Ortiz', ts: n - 3 * 6e4 },
    { action: 'payout.post_sale', workspace: 'Nordic Elite', actor: 'system', ts: n - 11 * 6e4 },
    { action: 'creator.create', workspace: 'Iberia Collective', actor: 'Ana Ruiz', ts: n - 42 * 6e4 },
    { action: 'customer.export', workspace: 'Aurora Media', actor: 'You', ts: n - 70 * 6e4 },
    { action: 'role.update', workspace: 'Nordic Elite', actor: 'Erik Vinter', ts: n - 95 * 6e4 },
    { action: 'auth.login', workspace: 'Iberia Collective', actor: 'Ana Ruiz', ts: n - 140 * 6e4 },
  ];
}

function ago(ts: number): string {
  const m = Math.round((Date.now() - ts) / 6e4);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  return Math.round(m / 60) + 'h ago';
}

const ACTION_LABELS: Record<string, string> = {
  'link.create': 'created a payment link',
  'payout.post_sale': 'posted a sale payout',
  'creator.create': 'added a creator',
  'customer.export': 'exported customers',
  'role.update': 'changed a role',
  'role.create': 'created a role',
  'auth.login': 'logged in',
  'invite.create': 'sent an invite',
  'invite.accept': 'accepted an invite',
  'workspace.rename': 'renamed the workspace',
  'platform.agency.onboard': 'onboarded an agency',
};

export default function PlatformPage() {
  const can = useCan();
  const workspaces = useAppStore(s => s.workspaces);
  const updateState = useAppStore(s => s.updateState);
  const setActiveWorkspace = useAppStore(s => s.setActiveWorkspace);

  // Fee edit modal
  const [feeWs, setFeeWs] = useState<string | null>(null);
  const [feePsp, setFeePsp] = useState('');
  const [feeMargin, setFeeMargin] = useState('');

  // Onboard modal
  const [showOnboard, setShowOnboard] = useState(false);
  const [obName, setObName] = useState('');
  const [obEmail, setObEmail] = useState('');
  const [obCur, setObCur] = useState('EUR');
  const [obMid, setObMid] = useState('');
  const [obPsp, setObPsp] = useState('8');
  const [obMarginVal, setObMarginVal] = useState('5');
  const [obCreator, setObCreator] = useState('70');
  const [obChatter, setObChatter] = useState('8');
  const [obCbf, setObCbf] = useState('15');
  const [obErr, setObErr] = useState('');

  // Onboard success
  const [onboardResult, setOnboardResult] = useState<{ name: string; token: string } | null>(null);

  if (!can('platform.view')) {
    return (
      <div>
        <div className="pagehead"><div><h2>Platform</h2><p>Access denied.</p></div></div>
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <h3>No access</h3>
          <p className="sub">Only super_admin (HigherPays operator) can see the platform back office.</p>
        </div>
      </div>
    );
  }

  // Per-agency revenue splits
  const rows = workspaces.map(w => {
    const g = MOCK_VOLUMES[w.id] || 0;
    const blended = w.pspRate + w.marginRate;
    const pf = g * blended / 100;
    const margin = g * w.marginRate / 100;
    return { w, g, blended, pf, margin };
  });
  const totalVol = rows.reduce((s, r) => s + r.g, 0);
  const totalMargin = rows.reduce((s, r) => s + r.margin, 0);
  const avgBlended = rows.length ? rows.reduce((s, r) => s + r.blended, 0) / rows.length : 0;

  const activity = demoActivity();

  // Fee edit handlers
  const openFee = (wsId: string) => {
    const w = workspaces.find(x => x.id === wsId);
    if (!w) return;
    setFeeWs(wsId);
    setFeePsp(String(w.pspRate));
    setFeeMargin(String(w.marginRate));
  };

  const saveFee = () => {
    if (!feeWs) return;
    const updated = workspaces.map(w =>
      w.id === feeWs ? { ...w, pspRate: +feePsp || 0, marginRate: +feeMargin || 0 } : w,
    );
    updateState({ workspaces: updated });
    const w = updated.find(x => x.id === feeWs);
    toast('Fees updated for ' + (w?.name || '') + '.');
    setFeeWs(null);
  };

  // Onboard
  const submitOnboard = () => {
    setObErr('');
    const name = obName.trim();
    const email = obEmail.trim();
    if (!name) { setObErr('Agency name is required.'); return; }
    if (!email.includes('@')) { setObErr('A valid owner email is required.'); return; }

    const colors = ['#15C3AF', '#4ADE9E', '#F5C451', '#F4707A', '#06A185'];
    const newId = 'ws' + (workspaces.length + 1);
    const newWs = {
      id: newId,
      name,
      initial: name[0].toUpperCase(),
      color: colors[workspaces.length % colors.length],
      client: name,
      contact: email,
      mid: obMid.trim() || 'MID-NEW',
      reservePct: 5,
      reserveReleaseDays: 180,
      declineFee: 0.2,
      refundFee: 15,
      chargebackFee: +obCbf || 15,
      currencies: [obCur.trim().toUpperCase() || 'EUR'],
      pspRate: +obPsp || 8,
      marginRate: +obMarginVal || 5,
      pspFixedFee: 0.5,
      minLink: 20,
      maxLink: null as number | null,
      status: 'setup' as const,
    };

    updateState({ workspaces: [...workspaces, newWs] });
    const token = 'demo-invite-' + Math.random().toString(36).slice(2, 12);
    setShowOnboard(false);
    setOnboardResult({ name, token });
    toast(name + ' onboarded.');
  };

  // View workspace (switch context)
  const viewWorkspace = (wsId: string) => {
    setActiveWorkspace(wsId);
    toast('Switched to ' + (workspaces.find(w => w.id === wsId)?.name || wsId));
  };

  const feeWsObj = feeWs ? workspaces.find(w => w.id === feeWs) : null;

  return (
    <div>
      <div className="pagehead">
        <div>
          <h2>Platform Back Office</h2>
          <p>HigherPays operator view — across every agency workspace.</p>
        </div>
        <button className="btn" onClick={() => {
          setObName(''); setObEmail(''); setObCur('EUR'); setObMid(''); setObPsp('8'); setObMarginVal('5');
          setObCreator('70'); setObChatter('8'); setObCbf('15'); setObErr('');
          setShowOnboard(true);
        }}>
          + Onboard agency
        </button>
      </div>

      {/* Summary stats */}
      <div className="stats">
        <div className="card stat"><div className="lbl">Agencies</div><div className="val">{workspaces.length}</div><div className="sub">workspaces</div></div>
        <div className="card stat"><div className="lbl">Total volume</div><div className="val">{fmt(totalVol)}</div><div className="sub">across agencies</div></div>
        <div className="card stat"><div className="lbl">HigherPays margin</div><div className="val" style={{ color: 'var(--mint)' }}>{fmt(totalMargin)}</div><div className="sub up">our revenue</div></div>
        <div className="card stat"><div className="lbl">Avg blended</div><div className="val">{avgBlended.toFixed(1)}%</div><div className="sub">PSP + margin</div></div>
      </div>

      {/* Per-agency breakdown */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="sechead" style={{ marginTop: 0 }}>Per-agency revenue splits</div>
        <div className="tablewrap" style={{ border: 'none' }}>
          <table>
            <thead><tr><th>Agency</th><th>MID</th><th>Volume</th><th>PSP %</th><th>Our margin %</th><th>Blended</th><th>Our €</th><th></th></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.w.id}>
                  <td className="cname">{r.w.name}</td>
                  <td className="cemail">{r.w.mid}</td>
                  <td className="amt">{fmt(r.g)}</td>
                  <td>{r.w.pspRate}%</td>
                  <td>{r.w.marginRate}%</td>
                  <td>{r.blended}%</td>
                  <td className="amt" style={{ color: 'var(--mint)' }}>{fmt(r.margin)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn ghost" style={{ padding: '5px 11px', fontSize: '13.2px' }} onClick={() => viewWorkspace(r.w.id)}>View</button>
                    {' '}
                    <button className="btn ghost" style={{ padding: '5px 11px', fontSize: '13.2px' }} onClick={() => openFee(r.w.id)}>Edit fee</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Activity feed */}
      <div className="card">
        <div className="sechead" style={{ marginTop: 0 }}>Activity across agencies</div>
        {activity.map((a, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '9px 0', borderBottom: '1px solid rgba(30,43,68,.5)' }}>
            <span style={{ color: 'var(--text)' }}>
              <b style={{ color: 'var(--brand)' }}>{a.workspace}</b> · {a.actor} {ACTION_LABELS[a.action] || a.action}
            </span>
            <span style={{ whiteSpace: 'nowrap', color: 'var(--muted)', fontSize: '13.2px' }}>{ago(a.ts)}</span>
          </div>
        ))}
      </div>

      {/* Fee edit modal */}
      <Modal open={!!feeWs} onClose={() => setFeeWs(null)}>
        {feeWsObj && (
          <>
            <h3>Edit fees — {feeWsObj.name}</h3>
            <div className="field"><label>PSP rate %</label><input type="number" value={feePsp} onChange={e => setFeePsp(e.target.value)} min="0" max="100" /></div>
            <div className="field"><label>HigherPays margin %</label><input type="number" value={feeMargin} onChange={e => setFeeMargin(e.target.value)} min="0" max="100" /></div>
            <div style={{ fontSize: '14.3px', color: 'var(--muted)', padding: '8px 0' }}>
              Blended (agency sees): <b style={{ color: 'var(--text)' }}>{((+feePsp || 0) + (+feeMargin || 0))}%</b>
            </div>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setFeeWs(null)}>Cancel</button>
              <button className="btn" onClick={saveFee}>Save</button>
            </div>
          </>
        )}
      </Modal>

      {/* Onboard modal */}
      <Modal open={showOnboard} onClose={() => setShowOnboard(false)}>
        <h3>Onboard a new agency</h3>
        <p className="sub">Creates the workspace, fees and splits, and emails the owner an invite to set their password.</p>
        <div className="field"><label>Agency name</label><input type="text" value={obName} onChange={e => setObName(e.target.value)} placeholder="Nordic Elite" /></div>
        <div className="field"><label>Owner email</label><input type="text" value={obEmail} onChange={e => setObEmail(e.target.value)} placeholder="owner@agency.com" /></div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div className="field" style={{ flex: 1 }}><label>Currency</label><input type="text" value={obCur} onChange={e => setObCur(e.target.value)} maxLength={3} /></div>
          <div className="field" style={{ flex: 1 }}><label>MID (optional)</label><input type="text" value={obMid} onChange={e => setObMid(e.target.value)} placeholder="MID-…" /></div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div className="field" style={{ flex: 1 }}><label>PSP rate %</label><input type="number" value={obPsp} onChange={e => setObPsp(e.target.value)} min="0" max="100" /></div>
          <div className="field" style={{ flex: 1 }}><label>HigherPays margin %</label><input type="number" value={obMarginVal} onChange={e => setObMarginVal(e.target.value)} min="0" max="100" /></div>
        </div>
        <div style={{ fontSize: '14.3px', color: 'var(--muted)', padding: '6px 0' }}>
          Blended (agency sees): <b style={{ color: 'var(--text)' }}>{((+obPsp || 0) + (+obMarginVal || 0))}%</b>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div className="field" style={{ flex: 1 }}><label>Creator split %</label><input type="number" value={obCreator} onChange={e => setObCreator(e.target.value)} min="0" max="100" /></div>
          <div className="field" style={{ flex: 1 }}><label>Chatter %</label><input type="number" value={obChatter} onChange={e => setObChatter(e.target.value)} min="0" max="100" /></div>
        </div>
        <div className="field"><label>Chargeback fee (€)</label><input type="number" value={obCbf} onChange={e => setObCbf(e.target.value)} min="0" /></div>
        {obErr && <div style={{ color: 'var(--red)', fontSize: '14.3px', minHeight: 16 }}>{obErr}</div>}
        <div className="modal-actions">
          <button className="btn ghost" onClick={() => setShowOnboard(false)}>Cancel</button>
          <button className="btn" onClick={submitOnboard}>Create &amp; send invite</button>
        </div>
      </Modal>

      {/* Onboard success modal */}
      <Modal open={!!onboardResult} onClose={() => setOnboardResult(null)}>
        {onboardResult && (
          <>
            <h3>{onboardResult.name} onboarded ✓</h3>
            <p className="sub">The owner has been emailed an invite. You can also copy these directly.</p>
            <div className="field">
              <label>Owner invite link</label>
              <input type="text" readOnly value={`https://app.higherpays.com/accept-invite?token=${onboardResult.token}`} onClick={e => (e.target as HTMLInputElement).select()} />
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setOnboardResult(null)}>Done</button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
