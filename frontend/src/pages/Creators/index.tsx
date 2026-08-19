import { useState } from 'react';
import { useAppStore } from '../../store/appStore';
import { useCan } from '../../hooks/usePermission';
import Modal from '../../components/Modal';
import { toast } from '../../components/Toast';
import { PageHeader } from '../../components/ui';
import type { Creator, RevenueModel } from '../../types';
import { useCreatorsData } from './useCreatorsData';

const initials = (n: string) =>
  n.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();

const fmt = (n: number) => {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }).format(n); }
  catch { return 'EUR ' + n.toFixed(2); }
};

const REV_LABEL: Record<string, string> = { revshare: 'Rev-Share', salary: 'Salary', ai: 'AI' };

export default function CreatorsPage() {
  const can = useCan();
  const {
    creators, isLoading, isError,
    create: createCreator,
    updateStatus,
    updateSplit,
  } = useCreatorsData();
  const chatters = useAppStore(s => s.chatters);
  const links = useAppStore(s => s.links);
  const updateState = useAppStore(s => s.updateState);

  const canManage = can('creators.manage');
  const canViewComm = can('commissions.view');
  const canManageComm = can('commissions.manage');

  const [creatorModal, setCreatorModal] = useState(false);
  const [splitEdits, setSplitEdits] = useState<Record<string, number>>({});

  // Creator form state
  const [cName, setCName] = useState('');
  const [cHandle, setCHandle] = useState('');
  const [cModel, setCModel] = useState<RevenueModel>('revshare');
  const [cSplit, setCSplit] = useState(70);
  const [cEmail, setCEmail] = useState('');
  const [cSalary, setCSalary] = useState('');
  const [cAutoInc, setCAutoInc] = useState(false);
  const [cInc, setCInc] = useState('');
  const [cStatus, setCStatus] = useState<'active' | 'suspended'>('active');
  const [cAssigned, setCAssigned] = useState<string[]>([]);
  const [cError, setCError] = useState(false);

  const toggleSuspend = async (cr: Creator) => {
    const nextStatus: Creator['status'] = cr.status === 'active' ? 'suspended' : 'active';
    try {
      await updateStatus(cr.id, nextStatus);
      toast(`${cr.name} ${nextStatus === 'active' ? 'activated' : 'suspended \u2013 no new links'}.`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not update creator.');
    }
  };

  const addCreator = async () => {
    if (!cName.trim()) { setCError(true); return; }
    const handle = cHandle.trim() ? (cHandle.trim().startsWith('@') ? cHandle.trim() : '@' + cHandle.trim()) : undefined;
    try {
      await createCreator({
        name: cName.trim(),
        handle,
        revModel: cModel,
        splitCreator: cModel === 'revshare' ? Math.min(100, Math.max(0, cSplit)) : undefined,
        salary: cModel === 'salary' ? (+cSalary || 0) : undefined,
        salaryInc: cModel === 'salary' && cAutoInc ? (+cInc || 0) : undefined,
        status: cStatus === 'suspended' ? 'suspended' : 'active',
      });
      // Assigning chatters isn't yet supported by the backend, so we mirror
      // it into the demo store where the local UI reads assignment counts.
      if (cAssigned.length > 0) {
        const updatedChatters = chatters.map(ch =>
          cAssigned.includes(ch.name) && !ch.assigned.includes(cName.trim())
            ? { ...ch, assigned: [...ch.assigned, cName.trim()] }
            : ch,
        );
        updateState({ chatters: updatedChatters });
      }
      setCreatorModal(false);
      resetForm();
      toast(
        cModel === 'revshare' && cEmail
          ? `Creator added \u2013 login invite queued to ${cEmail}.`
          : 'Creator added.',
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not create creator.');
    }
  };

  const resetForm = () => {
    setCName(''); setCHandle(''); setCModel('revshare'); setCSplit(70);
    setCEmail(''); setCSalary(''); setCAutoInc(false); setCInc('');
    setCStatus('active'); setCAssigned([]); setCError(false);
  };

  // --- Creator splits ---
  const getSplit = (cr: Creator) => splitEdits[cr.id] ?? cr.splitCreator ?? 70;

  const saveSplits = async () => {
    const dirty = Object.entries(splitEdits).filter(([id, v]) => {
      const cr = creators.find(c => c.id === id);
      return cr && cr.revModel === 'revshare' && v != null;
    });
    if (dirty.length === 0) return;
    try {
      await Promise.all(dirty.map(([id, v]) => updateSplit(id, Math.min(100, Math.max(0, v)))));
      setSplitEdits({});
      toast('Creator splits saved.');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save splits.');
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="People"
        title="Creators"
        subtitle="Content creators operating under this workspace."
        actions={canManage ? <button className="btn" onClick={() => setCreatorModal(true)}>Add creator</button> : null}
      />

      {/* Creator cards */}
      <div className="ws-grid">
        {isLoading ? (
          <div className="card" style={{ gridColumn: '1/-1', color: 'var(--muted)', textAlign: 'center', padding: 34 }}>
            Loading creators…
          </div>
        ) : isError ? (
          <div className="card" style={{ gridColumn: '1/-1', color: 'var(--neg)', textAlign: 'center', padding: 34 }}>
            Couldn't load creators. Try again in a moment.
          </div>
        ) : creators.length > 0 ? creators.map(cr => {
          const chatterCount = chatters.filter(ch => ch.assigned.includes(cr.name)).length;
          const paidLinks = links.filter(l => l.creator === cr.name && l.status === 'Paid');
          const paidCustomers = new Set(paidLinks.map(l => l.customerUsername)).size;
          const suspended = cr.status !== 'active';
          const model = cr.revModel === 'revshare'
            ? `${cr.splitCreator}% / ${100 - cr.splitCreator}%`
            : cr.revModel === 'salary'
              ? fmt(cr.salary || 0) + '/mo'
              : '\u2013';

          return (
            <div key={cr.id} className="card ws">
              <div className="ws-top">
                <div className="ws-mark" style={{ background: cr.color }}>{initials(cr.name)}</div>
                <div style={{ flex: 1 }}>
                  <div className="ws-name">{cr.name}</div>
                  <div className="ws-meta">{cr.handle}</div>
                </div>
                {canManage && (
                  <button
                    className="btn ghost"
                    style={{ padding: '5px 10px', fontSize: '13.2px' }}
                    onClick={() => toggleSuspend(cr)}
                  >
                    {suspended ? 'Activate' : 'Suspend'}
                  </button>
                )}
              </div>
              <div>
                <div className="ws-row">
                  <span>Status</span>
                  <span className={`pill ${suspended ? 'no' : 'ok'}`}>
                    {suspended ? 'Suspended' : 'Active'}
                  </span>
                </div>
                <div className="ws-row">
                  <span>Revenue model</span>
                  <span>
                    {REV_LABEL[cr.revModel] || '\u2013'}
                    {model !== '\u2013' ? ` \u00b7 ${model}` : ''}
                  </span>
                </div>
                <div className="ws-row"><span>Paid customers</span><span>{paidCustomers}</span></div>
                <div className="ws-row"><span>Paid links</span><span>{paidLinks.length}</span></div>
                <div className="ws-row"><span>Chatters assigned</span><span>{chatterCount}</span></div>
              </div>
            </div>
          );
        }) : (
          <div className="card" style={{ gridColumn: '1/-1', color: 'var(--muted)', textAlign: 'center', padding: 34 }}>
            No creators yet.
          </div>
        )}
      </div>

      {/* Creator revenue splits */}
      {canViewComm && creators.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="card">
            <div className="sechead" style={{ marginTop: 0 }}>
              Creator revenue splits{' '}
              <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: '13.2px' }}>
                &mdash; % of distributable, set per creator
              </span>
            </div>
            <div className="tablewrap" style={{ border: 'none' }}>
              <table>
                <thead>
                  <tr><th>Creator</th><th>Model</th><th>Creator share</th><th>Agency share</th></tr>
                </thead>
                <tbody>
                  {creators.map(cr => {
                    if (cr.revModel === 'revshare') {
                      const val = getSplit(cr);
                      return (
                        <tr key={cr.id}>
                          <td className="cname">{cr.name}</td>
                          <td><span className="seg">revshare</span></td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <input
                                type="number" value={val} min={0} max={100}
                                disabled={!canManageComm}
                                onChange={e => setSplitEdits(prev => ({
                                  ...prev, [cr.id]: +e.target.value,
                                }))}
                                style={{ width: 80 }}
                              />
                              <span style={{ color: 'var(--muted)' }}>%</span>
                            </div>
                          </td>
                          <td className="mono-val">{100 - val}%</td>
                        </tr>
                      );
                    }
                    if (cr.revModel === 'salary') {
                      return (
                        <tr key={cr.id}>
                          <td className="cname">{cr.name}</td>
                          <td><span className="seg">salary</span></td>
                          <td colSpan={2} style={{ color: 'var(--muted)' }}>
                            Fixed {fmt(cr.salary || 0)}/mo &mdash; no per-sale split
                          </td>
                        </tr>
                      );
                    }
                    return (
                      <tr key={cr.id}>
                        <td className="cname">{cr.name}</td>
                        <td><span className="seg">ai</span></td>
                        <td colSpan={2} style={{ color: 'var(--muted)' }}>
                          AI &mdash; agency keeps distributable
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {canManageComm && (
              <div style={{ textAlign: 'right', marginTop: 10 }}>
                <button className="btn" onClick={saveSplits}>Save creator splits</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Add Creator Modal */}
      <Modal open={creatorModal} onClose={() => { setCreatorModal(false); resetForm(); }}>
        <h3>Add creator</h3>
        <p className="sub">A content creator operating under this workspace.</p>
        <div className="field">
          <label>Creator's name</label>
          <input
            type="text" placeholder="e.g. Ava Lane" value={cName}
            onChange={e => { setCName(e.target.value); setCError(false); }}
            style={cError ? { borderColor: 'var(--red)' } : undefined}
          />
        </div>
        <div className="field">
          <label>Handle</label>
          <input type="text" placeholder="@handle" value={cHandle}
            onChange={e => setCHandle(e.target.value)} />
        </div>
        <div className="field">
          <label>Revenue model</label>
          <select value={cModel} onChange={e => setCModel(e.target.value as RevenueModel)}>
            <option value="revshare">Rev-Share</option>
            <option value="salary">Salary</option>
            <option value="ai">AI</option>
          </select>
        </div>

        {/* Model-specific fields */}
        {cModel === 'revshare' && (
          <>
            <div className="field">
              <label>% Split (Creator / Agency)</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="number" value={cSplit} min={0} max={100} style={{ width: 90 }}
                  onChange={e => setCSplit(+e.target.value)} />
                <span style={{ color: 'var(--muted)' }}>% creator</span>
              </div>
            </div>
            <div className="field">
              <label>Creator sign-up email</label>
              <input type="text" placeholder="creator@email.com \u2013 we'll send a login invite"
                value={cEmail} onChange={e => setCEmail(e.target.value)} />
            </div>
          </>
        )}
        {cModel === 'salary' && (
          <>
            <div className="field">
              <label>Monthly salary (\u20ac)</label>
              <input type="number" placeholder="3500" min={0} value={cSalary}
                onChange={e => setCSalary(e.target.value)} />
            </div>
            <div className="field">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={cAutoInc}
                  onChange={e => setCAutoInc(e.target.checked)}
                  style={{ minWidth: 'auto', width: 'auto' }} />
                Automatic monthly increase
              </label>
              <input type="number" placeholder="% per month" min={0} value={cInc}
                onChange={e => setCInc(e.target.value)} style={{ marginTop: 6 }} />
            </div>
          </>
        )}
        {cModel === 'ai' && (
          <div style={{ fontSize: '13.8px', color: 'var(--muted)', padding: '2px 2px 6px' }}>
            AI model &mdash; no revenue split or salary needed.
          </div>
        )}

        <div className="field">
          <label>Status</label>
          <select value={cStatus} onChange={e => setCStatus(e.target.value as 'active' | 'suspended')}>
            <option value="active">Active</option>
            <option value="suspended">Hold (no links yet)</option>
          </select>
        </div>
        <div className="field">
          <label>Assign chatters</label>
          <div style={{ maxHeight: 110, overflow: 'auto' }}>
            {chatters.length > 0 ? chatters.map(ch => (
              <label key={ch.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '14.3px', padding: '5px 0' }}>
                <input
                  type="checkbox" value={ch.name}
                  checked={cAssigned.includes(ch.name)}
                  onChange={e => {
                    setCAssigned(prev =>
                      e.target.checked ? [...prev, ch.name] : prev.filter(n => n !== ch.name)
                    );
                  }}
                  style={{ minWidth: 'auto', width: 'auto' }}
                />
                {ch.name}
              </label>
            )) : (
              <span style={{ color: 'var(--muted)', fontSize: '14.3px' }}>No chatters yet.</span>
            )}
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn ghost" onClick={() => { setCreatorModal(false); resetForm(); }}>Cancel</button>
          <button className="btn" onClick={addCreator}>Add creator</button>
        </div>
      </Modal>
    </div>
  );
}
