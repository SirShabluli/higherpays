import { useState } from 'react';
import { useAppStore } from '../../store/appStore';
import { useCan } from '../../hooks/usePermission';
import Modal from '../../components/Modal';
import { toast } from '../../components/Toast';
import type { Workspace } from '../../types';

export default function WorkspacesPage() {
  const can = useCan();
  const workspaces = useAppStore(s => s.workspaces);
  const updateState = useAppStore(s => s.updateState);

  const superAdmin = can('platform.view');
  const canCreate = can('workspaces.create');

  const [deepDive, setDeepDive] = useState<Workspace | null>(null);
  const [newWsModal, setNewWsModal] = useState(false);
  const [feeModal, setFeeModal] = useState<Workspace | null>(null);

  // New workspace form
  const [wsName, setWsName] = useState('');
  const [wsClient, setWsClient] = useState('');
  const [wsMid, setWsMid] = useState('');
  const [wsErrors, setWsErrors] = useState<Record<string, boolean>>({});

  // Fee edit form
  const [feePsp, setFeePsp] = useState('');
  const [feeMargin, setFeeMargin] = useState('');

  const openDeepDive = (w: Workspace) => setDeepDive(w);
  const openFeeEdit = (w: Workspace) => {
    setFeePsp(String(w.pspRate));
    setFeeMargin(String(w.marginRate));
    setFeeModal(w);
  };

  const saveFee = () => {
    if (!feeModal) return;
    const psp = Math.max(0, +feePsp || 0);
    const margin = Math.max(0, +feeMargin || 0);
    const updated = workspaces.map(w =>
      w.id === feeModal.id ? { ...w, pspRate: psp, marginRate: margin } : w
    );
    updateState({ workspaces: updated });
    setFeeModal(null);
    setDeepDive(null);
    toast('Platform fee updated.');
  };

  const addWorkspace = () => {
    const errors: Record<string, boolean> = {};
    if (!wsName.trim()) errors.name = true;
    if (Object.keys(errors).length) { setWsErrors(errors); return; }
    const colors = ['#15C3AF', '#4ADE9E', '#F5C451', '#F4707A', '#B98CFF'];
    const ws: Workspace = {
      id: 'ws' + (workspaces.length + 1),
      name: wsName.trim(),
      initial: wsName.trim()[0].toUpperCase(),
      color: colors[workspaces.length % colors.length],
      client: wsClient.trim() || wsName.trim(),
      contact: '',
      mid: wsMid.trim() || 'MID-' + Math.floor(1000 + Math.random() * 9000) + '-EU',
      reservePct: 5, reserveReleaseDays: 180, declineFee: 0.2, refundFee: 15,
      chargebackFee: 60, currencies: ['EUR'], pspRate: 8, marginRate: 5,
      pspFixedFee: 0.5, minLink: 20, maxLink: 400, status: 'setup',
    };
    updateState({ workspaces: [...workspaces, ws] });
    setNewWsModal(false);
    setWsName(''); setWsClient(''); setWsMid(''); setWsErrors({});
    toast('Workspace created.');
  };

  return (
    <div>
      <div className="pagehead">
        <div><h2>Workspaces</h2><p>Agencies connected to the platform.</p></div>
        {canCreate && (
          <button className="btn" onClick={() => setNewWsModal(true)}>+ New workspace</button>
        )}
      </div>

      <div className="ws-grid">
        {workspaces.map(w => (
          <div key={w.id} className="card ws">
            <div className="ws-top">
              <div className="ws-mark" style={{ background: w.color }}>{w.initial}</div>
              <div style={{ flex: 1 }}>
                <div className="ws-name">{w.name}</div>
                <div className="ws-meta">{w.mid}</div>
              </div>
            </div>
            <div>
              <div className="ws-row"><span>Client</span><span>{w.client || '\u2013'}</span></div>
              <div className="ws-row">
                <span>Currencies</span>
                <span>{(w.currencies || []).join(', ')}</span>
              </div>
              <div className="ws-row">
                <span>Blended fee</span>
                <span>{w.pspRate + w.marginRate}%</span>
              </div>
              <div className="ws-row">
                <span>Status</span>
                <span className={`pill ${w.status === 'live' ? 'ok' : 'no'}`}>
                  {w.status === 'live' ? 'Live' : 'Setup'}
                </span>
              </div>
            </div>
            {superAdmin && (
              <button
                className="btn ghost"
                style={{ marginTop: 4 }}
                onClick={() => openDeepDive(w)}
              >
                Deep-dive &amp; control
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Deep-dive modal */}
      <Modal open={!!deepDive} onClose={() => setDeepDive(null)}>
        {deepDive && (
          <>
            <h3>{deepDive.name}</h3>
            <p className="sub">{deepDive.client} &middot; {deepDive.contact || 'no contact'}</p>
            <div className="deep">
              <div className="dcell">
                <div className="dl">MID</div>
                <div className="dv" style={{ fontSize: '15.4px' }}>{deepDive.mid}</div>
              </div>
              <div className="dcell">
                <div className="dl">Blended fee</div>
                <div className="dv">{deepDive.pspRate + deepDive.marginRate}%</div>
              </div>
              <div className="dcell">
                <div className="dl">Our margin</div>
                <div className="dv" style={{ color: 'var(--mint)' }}>{deepDive.marginRate}%</div>
              </div>
            </div>
            <div className="setrow">
              <div className="k">Currencies</div>
              <span className="mono-val">{(deepDive.currencies || []).join(', ')}</span>
            </div>
            <div className="setrow">
              <div className="k">Status</div>
              <span className={`pill ${deepDive.status === 'live' ? 'ok' : 'no'}`}>
                {deepDive.status}
              </span>
            </div>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setDeepDive(null)}>Close</button>
              <button className="btn" onClick={() => openFeeEdit(deepDive)}>Edit platform fee</button>
            </div>
          </>
        )}
      </Modal>

      {/* Fee edit modal */}
      <Modal open={!!feeModal} onClose={() => setFeeModal(null)}>
        {feeModal && (
          <>
            <h3>Edit platform fee</h3>
            <p className="sub">{feeModal.name} &middot; {feeModal.mid}</p>
            <div className="field">
              <label>PSP rate (%)</label>
              <input type="number" value={feePsp} min={0} step={0.1}
                onChange={e => setFeePsp(e.target.value)} style={{ width: 120 }} />
            </div>
            <div className="field">
              <label>HigherPays margin (%)</label>
              <input type="number" value={feeMargin} min={0} step={0.1}
                onChange={e => setFeeMargin(e.target.value)} style={{ width: 120 }} />
            </div>
            <div className="field">
              <label>Blended</label>
              <span className="mono-val">{(+feePsp || 0) + (+feeMargin || 0)}%</span>
            </div>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setFeeModal(null)}>Cancel</button>
              <button className="btn" onClick={saveFee}>Save fee</button>
            </div>
          </>
        )}
      </Modal>

      {/* New workspace modal */}
      <Modal open={newWsModal} onClose={() => setNewWsModal(false)}>
        <h3>New workspace</h3>
        <p className="sub">Create a workspace for a new agency.</p>
        <div className="field">
          <label>Workspace name</label>
          <input type="text" placeholder="e.g. Aurora Media" value={wsName}
            onChange={e => { setWsName(e.target.value); setWsErrors(p => ({ ...p, name: false })); }}
            style={wsErrors.name ? { borderColor: 'var(--red)' } : undefined} />
        </div>
        <div className="field">
          <label>Client / company</label>
          <input type="text" placeholder="Legal entity name" value={wsClient}
            onChange={e => setWsClient(e.target.value)} />
        </div>
        <div className="field">
          <label>MID (optional)</label>
          <input type="text" placeholder="Auto-generated if empty" value={wsMid}
            onChange={e => setWsMid(e.target.value)} />
        </div>
        <div className="modal-actions">
          <button className="btn ghost" onClick={() => setNewWsModal(false)}>Cancel</button>
          <button className="btn" onClick={addWorkspace}>Create workspace</button>
        </div>
      </Modal>
    </div>
  );
}
