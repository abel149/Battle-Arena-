import { useEffect, useState } from 'react';
import { API, socket } from '../socket.js';

export default function ParentApprovalModal({ parentAddress, onClose, onChoreApproved }) {
  const [pin, setPin] = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [pinError, setPinError] = useState(null);
  const [chores, setChores] = useState([]);
  const [loading, setLoading] = useState(false);
  const [approvingId, setApprovingId] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [showPinChange, setShowPinChange] = useState(false);
  const [newPin, setNewPin] = useState('');
  const [pinChangeMsg, setPinChangeMsg] = useState(null);

  // Authenticate parent with PIN
  async function handlePinSubmit(e) {
    e.preventDefault();
    setPinError(null);
    try {
      const res = await fetch(`${API}/api/parent/verify-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: parentAddress || 'default', pin: pin.trim() }),
      });
      const data = await res.json();
      if (data.ok) {
        setAuthenticated(true);
        loadPendingChores();
      } else {
        setPinError('Incorrect Parent PIN. (Default PIN is 1234)');
      }
    } catch {
      setPinError('Failed to verify PIN. Try again.');
    }
  }

  async function loadPendingChores() {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/parent/${parentAddress || 'default'}/dashboard`);
      const data = await res.json();
      setChores(data.pendingChores || []);
    } catch (err) {
      console.warn('Failed to load pending chores:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleApprove(chore) {
    setApprovingId(chore.id);
    setSuccessMsg(null);
    try {
      const res = await fetch(`${API}/api/chores/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          choreId: chore.id,
          parentAddress: parentAddress || '0xParentDefaultOracle0000000000000000',
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      setSuccessMsg(`🎉 Approved! Granted ${chore.energyReward} Energy, ${chore.xpReward} XP${data.unlockedSkin ? ` and unlocked '${data.unlockedSkin.name}' skin!` : '!'}`);
      if (onChoreApproved) onChoreApproved(data);
      loadPendingChores();
    } catch (err) {
      alert(err.message || 'Approval failed');
    } finally {
      setApprovingId(null);
    }
  }

  async function handleSaveNewPin(e) {
    e.preventDefault();
    setPinChangeMsg(null);
    if (!/^\d{4,6}$/.test(newPin.trim())) {
      setPinChangeMsg({ error: 'PIN must be 4 to 6 digits' });
      return;
    }
    try {
      const res = await fetch(`${API}/api/parent/set-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: parentAddress || 'default', pin: newPin.trim() }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setPinChangeMsg({ success: 'Parent PIN updated successfully!' });
      setNewPin('');
    } catch (err) {
      setPinChangeMsg({ error: err.message || 'Failed to update PIN' });
    }
  }

  return (
    <div className="skin-modal-overlay" onClick={onClose}>
      <div className="skin-modal-dialog parent-dialog" onClick={e => e.stopPropagation()}>
        <div className="skin-modal-header">
          <div className="skin-modal-badge parent-badge">
            🛡️ Parent Approval Portal
          </div>
          <button type="button" className="skin-modal-close" onClick={onClose}>×</button>
        </div>

        {!authenticated ? (
          <div className="parent-pin-gate">
            <div className="parent-gate-icon">🔒</div>
            <h3>Enter Parent PIN</h3>
            <p>Protected area for parents to approve chores and unlock arena skins.</p>
            <form onSubmit={handlePinSubmit} className="parent-pin-form">
              <input
                type="password"
                maxLength={6}
                pattern="[0-9]*"
                inputMode="numeric"
                className="parent-pin-input"
                placeholder="1234"
                value={pin}
                onChange={e => setPin(e.target.value)}
                autoFocus
              />
              {pinError && <div className="pin-error-text">{pinError}</div>}
              <button type="submit" className="btn-pin-submit">
                Unlock Parent Portal →
              </button>
            </form>
            <div className="pin-hint">💡 First time? Default family PIN is <strong>1234</strong>.</div>
          </div>
        ) : (
          <div className="parent-dashboard-body">
            <div className="parent-dashboard-header">
              <div>
                <h3>Pending Chore Approvals</h3>
                <p>Review your child's completed chores to grant Energy and unlock skins.</p>
              </div>
              <button
                type="button"
                className="btn-toggle-pin"
                onClick={() => setShowPinChange(!showPinChange)}
              >
                ⚙️ {showPinChange ? 'Hide Settings' : 'Change PIN'}
              </button>
            </div>

            {showPinChange && (
              <form onSubmit={handleSaveNewPin} className="pin-change-box">
                <h4>Change Parent PIN</h4>
                <div className="pin-change-row">
                  <input
                    type="password"
                    maxLength={6}
                    placeholder="New 4-6 digit PIN"
                    value={newPin}
                    onChange={e => setNewPin(e.target.value)}
                    className="pin-change-input"
                  />
                  <button type="submit" className="btn-save-pin">Save PIN</button>
                </div>
                {pinChangeMsg?.error && <div className="pin-error-text">{pinChangeMsg.error}</div>}
                {pinChangeMsg?.success && <div className="pin-success-text">{pinChangeMsg.success}</div>}
              </form>
            )}

            {successMsg && <div className="parent-success-alert">{successMsg}</div>}

            {loading ? (
              <div className="parent-loading">Loading pending chores...</div>
            ) : chores.length === 0 ? (
              <div className="parent-empty-state">
                <div className="empty-icon">✨</div>
                <h4>All Caught Up!</h4>
                <p>No chores are waiting for parent review right now. Tell your kids to submit chore proofs from the Skin Locker or Battle Pass!</p>
              </div>
            ) : (
              <div className="pending-chores-list">
                {chores.map(chore => (
                  <div key={chore.id} className="pending-chore-card">
                    <div className="chore-card-main">
                      <div className="chore-card-title">
                        <span className="chore-icon">📋</span>
                        <strong>{chore.title}</strong>
                        <span className="chore-cat-tag">{chore.category}</span>
                      </div>
                      {chore.notes && (
                        <div className="chore-card-proof">
                          <span className="proof-label">Kid's Note:</span>
                          <span className="proof-text">"{chore.notes}"</span>
                        </div>
                      )}
                      <div className="chore-card-meta">
                        <span>Submitted: {new Date(chore.submittedAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        <span>Rewards: +{chore.energyReward}⚡ Energy • +{chore.xpReward} XP</span>
                      </div>
                    </div>
                    <div className="chore-card-actions">
                      <button
                        type="button"
                        className="btn-approve-chore"
                        disabled={approvingId === chore.id}
                        onClick={() => handleApprove(chore)}
                      >
                        {approvingId === chore.id ? 'Approving...' : '✅ Approve & Unlock'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
