import { useEffect, useState } from 'react';
import { API, socket } from '../socket.js';
import ChoreSubmitModal from './ChoreSubmitModal.jsx';
import ParentApprovalModal from './ParentApprovalModal.jsx';
import './skinlocker.css';

export default function SkinLockerModal({ kidAddress, parentAddress, onClose, onSkinEquipped }) {
  const [skins, setSkins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedChoreSkin, setSelectedChoreSkin] = useState(null);
  const [showParentModal, setShowParentModal] = useState(false);
  const [equippingId, setEquippingId] = useState(null);
  const [celebration, setCelebration] = useState(null);

  async function loadSkins() {
    try {
      const res = await fetch(`${API}/api/skins/${kidAddress || 'default'}`);
      const data = await res.json();
      setSkins(data || []);
    } catch (err) {
      console.warn('Failed to load skins:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSkins();

    const handleSkinUnlocked = ({ skin, message }) => {
      setCelebration(message || `🎉 Unlocked ${skin.name}!`);
      loadSkins();
    };

    socket.on('skin:unlocked', handleSkinUnlocked);
    return () => {
      socket.off('skin:unlocked', handleSkinUnlocked);
    };
  }, [kidAddress]);

  async function handleEquip(skinId) {
    setEquippingId(skinId);
    try {
      const res = await fetch(`${API}/api/skins/equip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: kidAddress, skinId }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      setSkins(prev => prev.map(s => ({ ...s, equipped: s.id === skinId })));
      if (onSkinEquipped) onSkinEquipped(skinId);
    } catch (err) {
      alert(err.message || 'Failed to equip skin');
    } finally {
      setEquippingId(null);
    }
  }

  return (
    <div className="skin-modal-overlay" onClick={onClose}>
      <div className="skin-modal-dialog skin-locker-dialog" onClick={e => e.stopPropagation()}>
        <div className="skin-modal-header">
          <div>
            <div className="skin-modal-badge">🚀 Cyber Ship Armory & Skins</div>
            <p className="skin-modal-subtitle">
              Skins cannot be bought with money! Complete real-world chores and get parent approval to unlock them.
            </p>
          </div>
          <div className="header-actions">
            <button
              type="button"
              className="btn-open-parent"
              onClick={() => setShowParentModal(true)}
              title="Open Parent PIN dashboard to approve chores"
            >
              🛡️ Parent Approval Portal
            </button>
            <button type="button" className="skin-modal-close" onClick={onClose}>×</button>
          </div>
        </div>

        {celebration && (
          <div className="skin-celebration-toast">
            {celebration}
            <button type="button" onClick={() => setCelebration(null)}>✕</button>
          </div>
        )}

        {loading ? (
          <div className="skin-loading">Loading armory skins...</div>
        ) : (
          <div className="skins-grid">
            {skins.map(skin => (
              <div
                key={skin.id}
                className={`skin-card ${skin.equipped ? 'equipped' : ''} ${skin.unlocked ? 'unlocked' : 'locked'}`}
                style={{ '--skin-color': skin.primaryColor, '--skin-accent': skin.accentColor }}
              >
                <div className="skin-card-top">
                  <span className={`rarity-tag rarity-${skin.rarity.toLowerCase()}`}>
                    {skin.rarity}
                  </span>
                  {skin.equipped && <span className="equipped-tag">⚡ EQUIPPED</span>}
                </div>

                <div className="skin-ship-preview">
                  <ShipGraphic skin={skin} />
                  <div className="skin-glow-halo" style={{ background: skin.primaryColor }} />
                </div>

                <div className="skin-card-details">
                  <h4 className="skin-name" style={{ color: skin.primaryColor }}>{skin.name}</h4>
                  <div className="skin-bullet-type">
                    <span>Weapon:</span> <strong>{skin.bulletType.toUpperCase()} LASER</strong>
                  </div>

                  {!skin.unlocked ? (
                    <div className="skin-chore-requirement">
                      <div className="chore-req-title">
                        <span className="req-icon">🔒</span>
                        <span>{skin.choreTitle}</span>
                      </div>
                      <div className="chore-req-desc">{skin.choreDescription}</div>
                    </div>
                  ) : (
                    <div className="skin-unlocked-banner">
                      ✅ Unlocked & Battle Ready
                    </div>
                  )}
                </div>

                <div className="skin-card-footer">
                  {skin.equipped ? (
                    <button type="button" className="btn-skin-action active" disabled>
                      ✓ Selected
                    </button>
                  ) : skin.unlocked ? (
                    <button
                      type="button"
                      className="btn-skin-action equip"
                      disabled={equippingId === skin.id}
                      onClick={() => handleEquip(skin.id)}
                    >
                      {equippingId === skin.id ? 'Equipping...' : 'Equip Skin'}
                    </button>
                  ) : skin.choreStatus === 'pending_approval' ? (
                    <button
                      type="button"
                      className="btn-skin-action pending"
                      onClick={() => setShowParentModal(true)}
                    >
                      ⏳ Waiting for Parent Approval
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn-skin-action unlock"
                      onClick={() => setSelectedChoreSkin(skin)}
                    >
                      📝 Submit Chore Proof
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {selectedChoreSkin && (
          <ChoreSubmitModal
            skin={selectedChoreSkin}
            kidAddress={kidAddress}
            onClose={() => setSelectedChoreSkin(null)}
            onSuccess={() => {
              loadSkins();
              setCelebration(`Chore submitted for ${selectedChoreSkin.name}! Ask your parent to approve it in the Parent Portal.`);
            }}
          />
        )}

        {showParentModal && (
          <ParentApprovalModal
            parentAddress={parentAddress}
            onClose={() => setShowParentModal(false)}
            onChoreApproved={() => {
              loadSkins();
              if (onSkinEquipped) onSkinEquipped();
            }}
          />
        )}
      </div>
    </div>
  );
}

function ShipGraphic({ skin }) {
  return (
    <svg className="ship-svg" viewBox="0 0 100 100" width="100" height="100">
      <defs>
        <radialGradient id={`glow-${skin.id}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={skin.laserColor} stopOpacity="0.8" />
          <stop offset="100%" stopColor={skin.primaryColor} stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* Thruster exhaust flame */}
      <polygon points="50,75 42,94 50,86 58,94" fill={skin.trailColor} opacity="0.85" />
      <polygon points="50,77 46,90 50,84 54,90" fill="#ffffff" />

      {/* Main ship hull */}
      <polygon
        points="50,15 78,72 50,62 22,72"
        fill={skin.primaryColor}
        stroke={skin.accentColor}
        strokeWidth="3"
      />
      {/* Cockpit canopy */}
      <polygon points="50,28 62,55 50,49 38,55" fill="#ffffff" opacity="0.9" />
      {/* Wing blasters */}
      <line x1="22" y1="62" x2="22" y2="40" stroke={skin.laserColor} strokeWidth="3" strokeLinecap="round" />
      <line x1="78" y1="62" x2="78" y2="40" stroke={skin.laserColor} strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
