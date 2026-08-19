import { useState } from 'react';
import { useAppStore } from '../../store/appStore';
import { useCan } from '../../hooks/usePermission';
import Modal from '../../components/Modal';
import { toast } from '../../components/Toast';
import { PageHeader } from '../../components/ui';
import { useTeamData } from './useTeamData';

const initials = (n: string) =>
  n.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();

export default function TeamPage() {
  const can = useCan();
  const members = useAppStore(s => s.members);
  const { chatters, isLoading, isError, setCommission } = useTeamData();
  const creators = useAppStore(s => s.creators);
  const commission = useAppStore(s => s.commission);
  const mode = useAppStore(s => s.mode);
  const updateState = useAppStore(s => s.updateState);

  const [chatterModal, setChatterModal] = useState(false);
  const [inviteModal, setInviteModal] = useState(false);

  // chatter form state
  const [hName, setHName] = useState('');
  const [hEmail, setHEmail] = useState('');
  const [hShift, setHShift] = useState<'Day' | 'Night'>('Day');
  const [hAssigned, setHAssigned] = useState<string[]>([]);
  const [hErrors, setHErrors] = useState<Record<string, boolean>>({});

  // invite form state
  const [invName, setInvName] = useState('');
  const [invEmail, setInvEmail] = useState('');
  const [invRole, setInvRole] = useState('admin');
  const [invErrors, setInvErrors] = useState<Record<string, boolean>>({});

  const canManage = can('team.manage');

  const people = [
    ...members.map(m => ({ name: m.name, email: m.email, role: m.role, extra: '' })),
    ...chatters.map(c => ({
      name: c.name, email: c.email, role: 'chatter' as const,
      extra: `${c.shift} \u00b7 ${c.assigned.join(', ') || 'unassigned'}`,
    })),
  ];

  // --- Chatter commission ---
  const canViewComm = can('commissions.view');
  const canManageComm = can('commissions.manage');
  const [commEdits, setCommEdits] = useState<Record<string, number>>({});

  const getCommPct = (ch: typeof chatters[0]) =>
    commEdits[ch.id] ?? ch.commissionPct ?? commission.chatterPct;

  const saveCommission = async () => {
    const dirty = Object.entries(commEdits);
    if (dirty.length === 0) return;
    try {
      await Promise.all(dirty.map(([id, pct]) => setCommission(id, pct)));
      setCommEdits({});
      toast('Chatter commission saved.');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save commission.');
    }
  };

  // --- Add chatter ---
  const addChatter = () => {
    const errors: Record<string, boolean> = {};
    if (!hName.trim()) errors.name = true;
    if (!hEmail.trim()) errors.email = true;
    if (Object.keys(errors).length) { setHErrors(errors); return; }
    const newChatter = {
      id: 'ch' + (chatters.length + 1),
      name: hName.trim(),
      email: hEmail.trim(),
      status: 'active' as const,
      shift: hShift,
      assigned: hAssigned,
      commissionPct: commission.chatterPct,
    };
    updateState({ chatters: [...chatters, newChatter] });
    setChatterModal(false);
    setHName(''); setHEmail(''); setHShift('Day'); setHAssigned([]); setHErrors({});
    toast('Chatter added.');
  };

  // --- Invite member ---
  const inviteMember = () => {
    const errors: Record<string, boolean> = {};
    if (!invName.trim()) errors.name = true;
    if (!invEmail.trim()) errors.email = true;
    if (Object.keys(errors).length) { setInvErrors(errors); return; }
    const newMember = { name: invName.trim(), email: invEmail.trim(), role: invRole };
    updateState({ members: [...members, newMember] });
    setInviteModal(false);
    setInvName(''); setInvEmail(''); setInvRole('admin'); setInvErrors({});
    toast(mode === 'demo' ? 'Invite sent (demo).' : 'Invite sent.');
  };

  return (
    <div>
      <PageHeader
        eyebrow="People"
        title="Team"
        subtitle="Everyone with a seat in this workspace."
        actions={
          canManage ? (
            <>
              <button className="btn ghost" onClick={() => setChatterModal(true)}>Add chatter</button>
              <button className="btn" onClick={() => setInviteModal(true)}>Invite member</button>
            </>
          ) : null
        }
      />

      {/* Team table */}
      <div className="card">
        <div className="tablewrap" style={{ border: 'none' }}>
          <table>
            <thead>
              <tr><th>Person</th><th>Role</th><th>Details</th></tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={3} style={{ padding: 36, textAlign: 'center', color: 'var(--muted)' }}>Loading team…</td></tr>
              ) : isError ? (
                <tr><td colSpan={3} style={{ padding: 36, textAlign: 'center', color: 'var(--neg)' }}>Couldn't load team.</td></tr>
              ) : people.map((p, i) => (
                <tr key={i}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div className="avatar" style={{ width: 30, height: 30, fontSize: '13.2px' }}>
                        {initials(p.name)}
                      </div>
                      <div>
                        <div className="cname">{p.name}</div>
                        <div className="cemail">{p.email}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={`rolebadge ${p.role === 'owner' ? 'owner' : ''}`}>
                      {p.role[0].toUpperCase() + p.role.slice(1)}
                    </span>
                  </td>
                  <td className="cemail">{p.extra}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Chatter commission */}
      {canViewComm && chatters.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="card">
            <div className="sechead" style={{ marginTop: 0 }}>
              Chatter commission{' '}
              <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: '13.2px' }}>
                &mdash; % of distributable, set per chatter
              </span>
            </div>
            <div className="tablewrap" style={{ border: 'none' }}>
              <table>
                <thead>
                  <tr><th>Chatter</th><th>Commission of distributable</th></tr>
                </thead>
                <tbody>
                  {chatters.map(ch => (
                    <tr key={ch.id}>
                      <td className="cname">{ch.name}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <input
                            type="number"
                            value={getCommPct(ch)}
                            min={0}
                            max={100}
                            disabled={!canManageComm}
                            onChange={e => setCommEdits(prev => ({
                              ...prev, [ch.id]: +e.target.value,
                            }))}
                            style={{ width: 80 }}
                          />
                          <span style={{ color: 'var(--muted)' }}>%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {canManageComm && (
              <div style={{ textAlign: 'right', marginTop: 10 }}>
                <button className="btn" onClick={saveCommission}>Save chatter commission</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Add Chatter Modal */}
      <Modal open={chatterModal} onClose={() => setChatterModal(false)}>
        <h3>Add chatter</h3>
        <p className="sub">An employee who handles messaging for assigned creators.</p>
        <div className="field">
          <label>Name</label>
          <input
            type="text" placeholder="Full name" value={hName}
            onChange={e => { setHName(e.target.value); setHErrors(p => ({ ...p, name: false })); }}
            style={hErrors.name ? { borderColor: 'var(--red)' } : undefined}
          />
        </div>
        <div className="field">
          <label>Work email</label>
          <input
            type="text" placeholder="name@company.com" value={hEmail}
            onChange={e => { setHEmail(e.target.value); setHErrors(p => ({ ...p, email: false })); }}
            style={hErrors.email ? { borderColor: 'var(--red)' } : undefined}
          />
        </div>
        <div className="field">
          <label>Shift</label>
          <select value={hShift} onChange={e => setHShift(e.target.value as 'Day' | 'Night')}>
            <option>Day</option>
            <option>Night</option>
          </select>
        </div>
        <div className="field">
          <label>Assigned creators</label>
          <div style={{ maxHeight: 130, overflow: 'auto' }}>
            {creators.length > 0 ? creators.map(cr => (
              <label key={cr.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '14.3px', padding: '6px 0', color: 'var(--text)' }}>
                <input
                  type="checkbox" value={cr.name}
                  checked={hAssigned.includes(cr.name)}
                  onChange={e => {
                    setHAssigned(prev =>
                      e.target.checked ? [...prev, cr.name] : prev.filter(n => n !== cr.name)
                    );
                  }}
                  style={{ minWidth: 'auto', width: 'auto' }}
                />
                {cr.name} <span style={{ color: 'var(--muted)' }}>{cr.handle}</span>
              </label>
            )) : (
              <span style={{ color: 'var(--muted)', fontSize: '14.3px' }}>Add a creator first.</span>
            )}
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn ghost" onClick={() => setChatterModal(false)}>Cancel</button>
          <button className="btn" onClick={addChatter}>Add chatter</button>
        </div>
      </Modal>

      {/* Invite Member Modal */}
      <Modal open={inviteModal} onClose={() => setInviteModal(false)}>
        <h3>Invite team member</h3>
        <p className="sub">They'll receive an email with a login link.</p>
        <div className="field">
          <label>Name</label>
          <input
            type="text" placeholder="Full name" value={invName}
            onChange={e => { setInvName(e.target.value); setInvErrors(p => ({ ...p, name: false })); }}
            style={invErrors.name ? { borderColor: 'var(--red)' } : undefined}
          />
        </div>
        <div className="field">
          <label>Email</label>
          <input
            type="text" placeholder="name@company.com" value={invEmail}
            onChange={e => { setInvEmail(e.target.value); setInvErrors(p => ({ ...p, email: false })); }}
            style={invErrors.email ? { borderColor: 'var(--red)' } : undefined}
          />
        </div>
        <div className="field">
          <label>Role</label>
          <select value={invRole} onChange={e => setInvRole(e.target.value)}>
            <option value="admin">Admin</option>
            <option value="manager">Manager</option>
            <option value="analyst">Analyst</option>
          </select>
        </div>
        <div className="modal-actions">
          <button className="btn ghost" onClick={() => setInviteModal(false)}>Cancel</button>
          <button className="btn" onClick={inviteMember}>Send invite</button>
        </div>
      </Modal>
    </div>
  );
}
