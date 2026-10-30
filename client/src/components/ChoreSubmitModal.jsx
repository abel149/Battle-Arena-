import { useState } from 'react';
import { API } from '../socket.js';

export default function ChoreSubmitModal({ skin, kidAddress, onClose, onSuccess }) {
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!notes.trim()) {
      setError('Please write a note telling your parents what you did!');
      return;
    }
    setSubmitting(true);
    setError(null);

    try {
      // Find the chore for this skin
      const choresRes = await fetch(`${API}/api/chores/${kidAddress}`);
      const data = await choresRes.json();
      const chores = data.chores || [];
      const chore =
        chores.find((c) => c.id === skin.choreId || c.category === skin.choreCategory) || chores[0];

      if (!chore) {
        throw new Error('Chore not found for this skin');
      }

      const res = await fetch(`${API}/api/chores/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kidAddress,
          choreId: chore.id,
          notes: notes.trim(),
        }),
      });
      const result = await res.json();
      if (result.error) throw new Error(result.error);

      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to submit chore');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="skin-modal-overlay" onClick={onClose}>
      <div className="skin-modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="skin-modal-header">
          <div
            className="skin-modal-badge"
            style={{ borderColor: skin.primaryColor, color: skin.primaryColor }}
          >
            ⚡ Chore Unlock Request
          </div>
          <button type="button" className="skin-modal-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="chore-submit-body">
          <div className="chore-skin-target">
            <span className="target-label">Unlocks Skin:</span>
            <span className="target-name" style={{ color: skin.primaryColor }}>
              {skin.name}
            </span>
          </div>

          <div className="chore-target-box">
            <div className="chore-target-title">📋 {skin.choreTitle}</div>
            <div className="chore-target-desc">{skin.choreDescription}</div>
          </div>

          <form onSubmit={handleSubmit}>
            <label className="chore-label">
              <span>Tell your parents what you did (Proof Note):</span>
              <textarea
                className="chore-textarea"
                rows={3}
                placeholder="e.g., I vacuumed the floor, made my bed neatly, and put my toys in the bin!"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                autoFocus
              />
            </label>

            {error && <div className="chore-error">{error}</div>}

            <div className="chore-actions">
              <button
                type="submit"
                className="btn-submit-chore"
                style={{
                  background: `linear-gradient(135deg, ${skin.primaryColor}, ${skin.accentColor})`,
                }}
                disabled={submitting}
              >
                {submitting ? 'Submitting...' : '🚀 Submit to Parents for Approval'}
              </button>
              <button type="button" className="btn-cancel-chore" onClick={onClose}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
