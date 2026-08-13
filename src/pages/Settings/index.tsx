import { useState, useCallback } from 'react';
import { useAppStore } from '../../store/appStore';
import { useCan, useActiveWorkspace } from '../../hooks/usePermission';
import { CAPS } from '../../rbac/permissions';
import { rateCard } from '../../business/rateCard';
import { feeBreakdown } from '../../business/feeBreakdown';
import { TZ_LIST, detectedTZ, tzTimeLabel } from '../../business/timezone';
import Modal from '../../components/Modal';
import { toast } from '../../components/Toast';
import type { Permission } from '../../types';

// --- Notification constants (exact copy from HTML) ---
const N_EVENTS: Array<[string, string]> = [
  ['payment.paid', 'Payment received'],
  ['payment.failed', 'Payment declined'],
  ['payment.refunded', 'Refund issued'],
  ['payment.chargeback', 'Chargeback'],
  ['payout.paid', 'Payout sent'],
];
const N_ICON: Record<string, string> = {
  'payment.paid': '\u2705', 'payment.failed': '\u26a0\ufe0f',
  'payment.refunded': '\u21a9\ufe0f', 'payment.chargeback': '\u274c',
  'payout.paid': '\ud83d\udcb8',
};
const N_EVENT_DESC: Record<string, string> = {
  'payment.paid': 'Every successful payment.',
  'payment.failed': 'Declined or failed attempts.',
  'payment.refunded': 'When a transaction is refunded.',
  'payment.chargeback': 'When a customer disputes a payment.',
  'payout.paid': 'When a creator or chatter is paid.',
};
const N_EVENT_PERM: Record<string, Permission> = {
  'payment.paid': 'payments.view', 'payment.failed': 'payments.view',
  'payment.refunded': 'payments.view', 'payment.chargeback': 'commissions.view',
  'payout.paid': 'commissions.view',
};

const fmt = (n: number) => {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }).format(n); }
  catch { return 'EUR ' + n.toFixed(2); }
};

type SettingsTab = 'general' | 'roles' | 'notifications';

export default function SettingsPage() {
  const can = useCan();
  const [tab, setTab] = useState<SettingsTab>('general');

  if (!can('settings.view')) {
    return (
      <div>
        <div className="pagehead"><div><h2>Settings</h2></div></div>
        <div className="card">
          <div className="lock">
            <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.7" stroke="currentColor" style={{ width: 32, height: 32 }}>
              <rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" />
            </svg>
            <strong>You don't have access to settings</strong>
            <span>Ask an owner or admin if you need it.</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="pagehead"><div><h2>Settings</h2></div></div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          className={`btn ghost tgl ${tab === 'general' ? 'active' : ''}`}
          onClick={() => setTab('general')}
        >General</button>
        {can('team.manage') && (
          <button
            className={`btn ghost tgl ${tab === 'roles' ? 'active' : ''}`}
            onClick={() => setTab('roles')}
          >Role permissions</button>
        )}
        {can('payments.view') && (
          <button
            className={`btn ghost tgl ${tab === 'notifications' ? 'active' : ''}`}
            onClick={() => setTab('notifications')}
          >Notifications</button>
        )}
      </div>

      <div>
        {tab === 'general' && <GeneralPane />}
        {tab === 'roles' && can('team.manage') && <RolesPane />}
        {tab === 'notifications' && <NotificationsPane />}
      </div>
    </div>
  );
}

// ===== General tab =====
function GeneralPane() {
  const can = useCan();
  const editable = can('settings.edit');
  const ws = useActiveWorkspace();
  const mode = useAppStore(s => s.mode);
  const fees = useAppStore(s => s.fees);
  const linkLimits = useAppStore(s => s.linkLimits);
  const twoFactorEnabled = useAppStore(s => s.twoFactorEnabled);
  const tzMode = useAppStore(s => s.tzMode);
  const tzManual = useAppStore(s => s.tzManual);
  const setTz = useAppStore(s => s.setTz);
  const updateState = useAppStore(s => s.updateState);
  const workspaces = useAppStore(s => s.workspaces);

  const [wsName, setWsName] = useState(ws?.name || '');
  const [limitMin, setLimitMin] = useState(linkLimits.min == null ? '' : String(linkLimits.min));
  const [limitMax, setLimitMax] = useState(linkLimits.max == null ? '' : String(linkLimits.max));

  const [tfaModal, setTfaModal] = useState(false);
  const [tfaDisableModal, setTfaDisableModal] = useState(false);
  const [tfaCode, setTfaCode] = useState('');
  const [tfaCodeError, setTfaCodeError] = useState(false);

  const isLive = mode === 'live';
  const rc = rateCard(ws, fees, isLive);

  const effectiveFeePct = useCallback((amount: number) => {
    if (amount <= 0) return 0;
    const fb = feeBreakdown(amount, rc);
    return fb.effectivePct;
  }, [rc]);

  const activeTZ = () => (tzMode === 'manual' && tzManual) ? tzManual : detectedTZ();

  const saveName = () => {
    if (!wsName.trim()) return;
    const updated = workspaces.map(w =>
      w.id === ws?.id ? { ...w, name: wsName.trim() } : w
    );
    updateState({ workspaces: updated, brand: { name: wsName.trim(), initial: wsName.trim()[0].toUpperCase() } });
    toast('Saved.');
  };

  const saveLimits = () => {
    const min = limitMin === '' ? null : +limitMin;
    const max = limitMax === '' ? null : +limitMax;
    if (min != null && min < linkLimits.providerMin) {
      toast('Minimum must be at least ' + fmt(linkLimits.providerMin) + ' (provider floor).');
      return;
    }
    if (min != null && max != null && max < min) {
      toast('Maximum must be greater than the minimum.');
      return;
    }
    updateState({ linkLimits: { ...linkLimits, min: min ?? linkLimits.providerMin, max } });
    if (ws) {
      const updated = workspaces.map(w =>
        w.id === ws.id ? { ...w, minLink: min ?? linkLimits.providerMin, maxLink: max } : w
      );
      updateState({ workspaces: updated });
    }
    toast('Link limits saved.');
  };

  const enableTfa = () => {
    if (!/^\d{6}$/.test(tfaCode)) { setTfaCodeError(true); return; }
    updateState({ twoFactorEnabled: true });
    setTfaModal(false); setTfaCode(''); setTfaCodeError(false);
    toast('Two-factor authentication enabled (demo).');
  };

  const disableTfa = () => {
    updateState({ twoFactorEnabled: false });
    setTfaDisableModal(false);
    toast('Two-factor disabled.');
  };

  const rateAtMin = (() => {
    const m = parseFloat(limitMin);
    return m > 0 ? effectiveFeePct(m).toFixed(1) + '%' : '\u2013';
  })();

  return (
    <>
      {/* Branding */}
      <div className="card">
        <div className="sechead" style={{ marginTop: 0 }}>Branding</div>
        <div className="setrow">
          <div><div className="k">Workspace name</div><div className="d">Shown next to the logo in the sidebar.</div></div>
          <input type="text" value={wsName} onChange={e => setWsName(e.target.value)}
            disabled={!editable} style={{ maxWidth: 220 }} />
        </div>
        <div className="setrow">
          <div><div className="k">Currency</div><div className="d">The system runs in euro only. Multi-currency and FX conversion are not enabled, so every amount you see is a real euro figure &mdash; never a converted estimate.</div></div>
          <span className="mono-val">EUR</span>
        </div>
        <div className="sechead">Provider connection</div>
        <div className="setrow"><div><div className="k">Base URL</div><div className="d">Your provider's hosted payment page host.</div></div><span className="mono-val">uiservices.mantapay.biz</span></div>
        <div className="setrow"><div><div className="k">API key</div><div className="d">Stored server-side only. Never exposed in the browser.</div></div><span className="mono-val">&bull;&bull;&bull;&bull; &bull;&bull;&bull;&bull; &bull;&bull;&bull;&bull; 4471</span></div>
        <div className="setrow"><div><div className="k">Webhook</div><div className="d">Where the provider posts results. Source of truth.</div></div><span className="mono-val">/webhooks/payment</span></div>
        {editable && (
          <div className="setrow">
            <div><div className="k">Save</div><div className="d">Updates workspace branding.</div></div>
            <button className="btn" onClick={saveName}>Save changes</button>
          </div>
        )}
      </div>

      {/* Link limits */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="sechead" style={{ marginTop: 0 }}>Payment link limits</div>
        <p className="sub" style={{ marginTop: 0 }}>
          Guardrails for every PPV link a chatter creates. A flat per-transaction fee makes small
          tickets disproportionately expensive &mdash; on your rates a {fmt(5)} link costs
          ~{effectiveFeePct(5).toFixed(1)}% in fees, a {fmt(20)} link ~{effectiveFeePct(20).toFixed(1)}%,
          a {fmt(100)} link ~{effectiveFeePct(100).toFixed(1)}%. Enforced on the server, so the limits
          can't be bypassed.
        </p>
        <div className="setrow">
          <div><div className="k">Minimum amount</div><div className="d">Links below this are blocked. Provider floor is {fmt(linkLimits.providerMin)}.</div></div>
          <input type="number" min={linkLimits.providerMin} step={0.01} value={limitMin}
            onChange={e => setLimitMin(e.target.value)} placeholder="none" disabled={!editable} style={{ maxWidth: 130 }} />
        </div>
        <div className="setrow">
          <div><div className="k">Maximum amount</div><div className="d">Optional ceiling &mdash; guards against a mistyped amount.</div></div>
          <input type="number" min={0} step={0.01} value={limitMax}
            onChange={e => setLimitMax(e.target.value)} placeholder="none" disabled={!editable} style={{ maxWidth: 130 }} />
        </div>
        <div className="setrow">
          <div><div className="k">Effective fee at your minimum</div><div className="d">Total platform fees on a link at this amount.</div></div>
          <span className="mono-val">{rateAtMin}</span>
        </div>
        {editable && (
          <div className="setrow">
            <div><div className="k">Save limits</div><div className="d">Applies to all new links in this workspace.</div></div>
            <button className="btn" onClick={saveLimits}>Save limits</button>
          </div>
        )}
      </div>

      {/* Security */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="sechead" style={{ marginTop: 0 }}>Security</div>
        <div className="setrow">
          <div><div className="k">Two-factor authentication</div><div className="d">Require a 6-digit code from an authenticator app at login, in addition to your password.</div></div>
          <button className={`btn ${twoFactorEnabled ? 'ghost' : ''}`}
            onClick={() => twoFactorEnabled ? setTfaDisableModal(true) : setTfaModal(true)}>
            {twoFactorEnabled ? 'Disable 2FA' : 'Enable 2FA'}
          </button>
        </div>
      </div>

      {/* Time & region */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="sechead" style={{ marginTop: 0 }}>Time &amp; region</div>
        <div className="setrow">
          <div><div className="k">Time zone</div><div className="d">All dates and time filters are shown in this zone. Choose automatic to match your device.</div></div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '13.2px', whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={tzMode === 'auto'}
                onChange={e => {
                  setTz(e.target.checked ? 'auto' : 'manual', tzManual || detectedTZ());
                  toast('Time zone: ' + (e.target.checked ? detectedTZ() : (tzManual || detectedTZ())));
                }} /> Automatic
            </label>
            <select disabled={tzMode === 'auto'} value={activeTZ()} style={{ maxWidth: 210 }}
              onChange={e => { setTz('manual', e.target.value); toast('Time zone: ' + e.target.value); }}>
              {TZ_LIST.map(z => <option key={z} value={z}>{z}</option>)}
            </select>
          </div>
        </div>
        <div className="setrow">
          <div><div className="k">Active zone</div><div className="d">Device detected: {detectedTZ()}</div></div>
          <span className="mono-val">{activeTZ()} &middot; {tzTimeLabel(null, activeTZ())}</span>
        </div>
      </div>

      {/* Getting started */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="sechead" style={{ marginTop: 0 }}>Getting started</div>
        <div className="setrow">
          <div><div className="k">Product tour</div><div className="d">Replay the quick guided tour and tips for the console.</div></div>
          <button className="btn ghost" onClick={() => toast('Tour coming soon.')}>Take the tour</button>
        </div>
      </div>

      {/* Danger zone */}
      {can('settings.danger') && (
        <div className="card" style={{ marginTop: 16, borderColor: '#52242b' }}>
          <div className="sechead" style={{ marginTop: 0, color: 'var(--red)' }}>Danger zone</div>
          <div className="setrow">
            <div><div className="k">Rotate API key</div><div className="d">Invalidates the current key.</div></div>
            <button className="btn danger" onClick={() => toast('Rotate key is a server action \u2013 hand to your developer.')}>Rotate key</button>
          </div>
        </div>
      )}

      {/* 2FA Enable Modal */}
      <Modal open={tfaModal} onClose={() => { setTfaModal(false); setTfaCode(''); setTfaCodeError(false); }}>
        <h3>Enable two-factor authentication</h3>
        <p className="sub">Add a new account in your authenticator app (Google Authenticator, Authy, 1Password) using this setup key, then enter the 6-digit code it shows.</p>
        <div className="field">
          <label>Setup key</label>
          <input type="text" readOnly value="JBSW Y3DP EHPK 3PXP" onClick={e => (e.target as HTMLInputElement).select()}
            style={{ fontFamily: 'ui-monospace,Menlo,monospace', letterSpacing: 2, textAlign: 'center', fontSize: '15.4px' }} />
        </div>
        <div className="field">
          <label>6-digit code from your app</label>
          <input type="text" inputMode="numeric" autoComplete="one-time-code" placeholder="000000" maxLength={6}
            value={tfaCode} onChange={e => { setTfaCode(e.target.value); setTfaCodeError(false); }}
            style={tfaCodeError ? { borderColor: 'var(--red)' } : undefined} />
        </div>
        <div className="modal-actions">
          <button className="btn ghost" onClick={() => { setTfaModal(false); setTfaCode(''); }}>Cancel</button>
          <button className="btn" onClick={enableTfa}>Verify &amp; enable</button>
        </div>
      </Modal>

      {/* 2FA Disable Modal */}
      <Modal open={tfaDisableModal} onClose={() => setTfaDisableModal(false)}>
        <h3>Disable two-factor?</h3>
        <p className="sub">Your account will then be protected by password only.</p>
        <div className="modal-actions">
          <button className="btn ghost" onClick={() => setTfaDisableModal(false)}>Keep it on</button>
          <button className="btn danger" onClick={disableTfa}>Disable</button>
        </div>
      </Modal>
    </>
  );
}

// ===== Role Permissions tab =====
function RolesPane() {
  const can = useCan();
  const editable = can('team.manage');
  const roles = useAppStore(s => s.roles);
  const updateState = useAppStore(s => s.updateState);

  const [addRoleModal, setAddRoleModal] = useState(false);
  const [roleName, setRoleName] = useState('');
  const [roleError, setRoleError] = useState(false);

  const roleNames = Object.keys(roles).filter(r => r !== 'super_admin');

  const togglePerm = (r: string, perm: Permission, checked: boolean) => {
    const set = new Set(roles[r] || []);
    if (checked) set.add(perm); else set.delete(perm);
    const newRoles = { ...roles, [r]: [...set] };
    updateState({ roles: newRoles });
    toast(`${r}: ${checked ? 'granted' : 'revoked'} ${perm}`);
  };

  const addRole = () => {
    const n = roleName.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (!n || roles[n]) { setRoleError(true); return; }
    const newRoles = { ...roles, [n]: ['payments.view' as Permission] };
    updateState({ roles: newRoles });
    setAddRoleModal(false);
    setRoleName('');
    toast('Role "' + n + '" created.');
  };

  return (
    <>
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div className="sechead" style={{ margin: 0 }}>Role permissions</div>
            <p className="sub" style={{ margin: '4px 0 0' }}>What each role can see and do in this workspace.</p>
          </div>
          {editable && (
            <button className="btn ghost" style={{ padding: '7px 13px' }} onClick={() => setAddRoleModal(true)}>
              + Add custom role
            </button>
          )}
        </div>
        <div className="tablewrap" style={{ border: 'none' }}>
          <table>
            <thead>
              <tr>
                <th>Capability</th>
                {roleNames.map(r => <th key={r} style={{ textTransform: 'capitalize' }}>{r}</th>)}
              </tr>
            </thead>
            <tbody>
              {CAPS.filter(([, p]) => p !== 'platform.view').map(([label, perm]) => (
                <tr key={perm}>
                  <td>{label}</td>
                  {roleNames.map(r => {
                    const on = (roles[r] || []).includes(perm);
                    const lock = r === 'owner';
                    return (
                      <td key={r}>
                        {editable && !lock ? (
                          <input type="checkbox" checked={on}
                            onChange={e => togglePerm(r, perm, e.target.checked)}
                            style={{ minWidth: 'auto', width: 'auto', cursor: 'pointer' }} />
                        ) : (
                          on
                            ? <span className="pill ok">Yes</span>
                            : <span style={{ color: '#43506b' }}>&mdash;</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={addRoleModal} onClose={() => { setAddRoleModal(false); setRoleName(''); setRoleError(false); }}>
        <h3>New custom role</h3>
        <p className="sub">Starts with no permissions &mdash; grant them in the matrix.</p>
        <div className="field">
          <label>Role name</label>
          <input type="text" placeholder="e.g. finance" value={roleName}
            onChange={e => { setRoleName(e.target.value); setRoleError(false); }}
            style={roleError ? { borderColor: 'var(--red)' } : undefined} />
        </div>
        <div className="modal-actions">
          <button className="btn ghost" onClick={() => { setAddRoleModal(false); setRoleName(''); }}>Cancel</button>
          <button className="btn" onClick={addRole}>Create role</button>
        </div>
      </Modal>
    </>
  );
}

// ===== Notifications tab =====
function NotificationsPane() {
  const can = useCan();
  const mode = useAppStore(s => s.mode);

  const allowedEvents = N_EVENTS.filter(([k]) => can(N_EVENT_PERM[k])).map(([k]) => k);

  const [subscribedSet, setSubscribedSet] = useState<Set<string>>(new Set(allowedEvents));

  // Telegram channels (demo-only state)
  const [channels, setChannels] = useState<Array<{
    id: string; type: string; target: string; label: string; events: string[]; active: boolean; lastError?: string;
  }>>([]);
  const [nChat, setNChat] = useState('');
  const [nLabel, setNLabel] = useState('');
  const [nEvents, setNEvents] = useState<Set<string>>(new Set(['payment.paid']));

  const canEdit = can('settings.edit');
  const canViewSettings = can('settings.view');

  const savePrefs = () => {
    toast('Notification preferences saved.');
  };

  const addChat = () => {
    if (!nChat.trim()) { toast('Paste the Telegram chat ID.'); return; }
    if (nEvents.size === 0) { toast('Pick at least one event.'); return; }
    setChannels(prev => [...prev, {
      id: 'c' + Date.now(), type: 'telegram', target: nChat.trim(),
      label: nLabel.trim(), events: [...nEvents], active: true,
    }]);
    setNChat(''); setNLabel(''); setNEvents(new Set(['payment.paid']));
    toast('Chat connected (demo).');
  };

  const removeChat = (id: string) => {
    setChannels(prev => prev.filter(c => c.id !== id));
    toast('Chat removed.');
  };

  const testChat = () => {
    if (mode !== 'live') { toast('Test messages need a live connection.'); return; }
  };

  return (
    <>
      {/* Your notifications (personal) */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="sechead" style={{ marginTop: 0 }}>Your notifications</div>
        <p className="sub" style={{ marginTop: 0 }}>
          Choose what appears in your notification bell. This is personal &mdash; it doesn't change
          what your teammates see. Only events your role can access are listed.
        </p>
        {allowedEvents.map(k => {
          const label = (N_EVENTS.find(x => x[0] === k) || [, k])[1] as string;
          return (
            <div className="setrow" key={k}>
              <div>
                <div className="k">{N_ICON[k] || ''} {label}</div>
                <div className="d">{N_EVENT_DESC[k] || ''}</div>
              </div>
              <input type="checkbox" checked={subscribedSet.has(k)}
                onChange={e => {
                  setSubscribedSet(prev => {
                    const next = new Set(prev);
                    e.target.checked ? next.add(k) : next.delete(k);
                    return next;
                  });
                }}
                style={{ minWidth: 'auto', width: 'auto', cursor: 'pointer' }} />
            </div>
          );
        })}
        {allowedEvents.length < N_EVENTS.length && (
          <p className="sub" style={{ marginTop: 10 }}>
            {N_EVENTS.length - allowedEvents.length} more event type(s) are limited to roles that can view commissions.
          </p>
        )}
        <div style={{ textAlign: 'right', marginTop: 10 }}>
          <button className="btn" onClick={savePrefs}>Save my preferences</button>
        </div>
      </div>

      {/* Telegram (workspace-wide config, needs settings access) */}
      {canViewSettings && (
        <div className="card">
          <div className="sechead" style={{ marginTop: 0 }}>Telegram notifications</div>
          <p className="sub" style={{ marginTop: 0 }}>
            Send a message to a Telegram chat every time a payment happens. Add our bot to your group,
            then paste the chat ID below. We never store your bot token &mdash; HigherPays delivers through its own bot.
          </p>

          {channels.length > 0 ? (
            <div className="tablewrap" style={{ border: 'none' }}>
              <table>
                <thead><tr><th>Chat</th><th>Events</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {channels.map(c => (
                    <tr key={c.id}>
                      <td className="cname">{c.label || c.target}<div className="cemail">{c.target}</div></td>
                      <td>
                        {(c.events || []).map(e => (
                          <span className="seg" key={e}>
                            {(N_EVENTS.find(x => x[0] === e) || [, e])[1]}
                          </span>
                        )).reduce<React.ReactNode[]>((acc, el, i) => i === 0 ? [el] : [...acc, ' ', el], [])}
                      </td>
                      <td>
                        {c.lastError
                          ? <><span className="pill no">Error</span><div className="cemail">{c.lastError}</div></>
                          : c.active ? <span className="pill ok">Active</span> : <span className="seg">Paused</span>}
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {canEdit && (
                          <>
                            <button className="btn ghost" style={{ padding: '4px 10px', fontWeight: 400 }}
                              onClick={testChat}>Test</button>{' '}
                            <button className="btn ghost" style={{ padding: '4px 10px', fontWeight: 400, color: 'var(--red)' }}
                              onClick={() => removeChat(c.id)}>Remove</button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="sub">No chats connected yet.</p>
          )}

          {canEdit && (
            <>
              <div className="sechead">Add a chat</div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div className="field" style={{ flex: 1, minWidth: 150 }}>
                  <label>Telegram chat ID</label>
                  <input type="text" placeholder="-1001234567890" value={nChat}
                    onChange={e => setNChat(e.target.value)} />
                </div>
                <div className="field" style={{ flex: 1, minWidth: 150 }}>
                  <label>Label</label>
                  <input type="text" placeholder="Ops room" value={nLabel}
                    onChange={e => setNLabel(e.target.value)} />
                </div>
              </div>
              <div style={{ margin: '8px 0 12px' }}>
                {N_EVENTS.map(([k, l]) => (
                  <label key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginRight: 14, fontSize: '13.2px' }}>
                    <input type="checkbox" checked={nEvents.has(k)}
                      onChange={e => {
                        setNEvents(prev => {
                          const next = new Set(prev);
                          e.target.checked ? next.add(k) : next.delete(k);
                          return next;
                        });
                      }}
                      style={{ minWidth: 'auto', width: 'auto' }} /> {l}
                  </label>
                ))}
              </div>
              <div style={{ textAlign: 'right' }}>
                <button className="btn" onClick={addChat}>Connect chat</button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
