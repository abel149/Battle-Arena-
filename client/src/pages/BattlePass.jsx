import { useCallback, useEffect, useMemo, useState } from 'react';
import { API, socket, signAndIdentify } from '../socket.js';
import { navigate, useRoute } from '../lib/router.js';
import { short, useProfile } from '../lib/session.js';
import { ethers } from 'ethers';
import './battlepass.css';

// 5-Question Brain Quiz questions pool
const QUIZ_QUESTIONS_POOL = [
  {
    q: 'What is 15 × 6?',
    options: ['80', '90', '95', '85'],
    correct: 1,
    category: 'Math',
  },
  {
    q: 'Which planet is known as the Red Planet?',
    options: ['Jupiter', 'Venus', 'Mars', 'Mercury'],
    correct: 2,
    category: 'Science',
  },
  {
    q: 'How many sides does a hexagon have?',
    options: ['5', '6', '7', '8'],
    correct: 1,
    category: 'Geometry',
  },
  {
    q: 'What is the largest ocean on Earth?',
    options: ['Atlantic Ocean', 'Indian Ocean', 'Pacific Ocean', 'Arctic Ocean'],
    correct: 2,
    category: 'Geography',
  },
  {
    q: 'If a triangle has angles 90° and 45°, what is the third angle?',
    options: ['45°', '55°', '35°', '90°'],
    correct: 0,
    category: 'Math',
  },
  {
    q: 'Which gas do plants absorb during photosynthesis?',
    options: ['Oxygen', 'Nitrogen', 'Carbon Dioxide', 'Hydrogen'],
    correct: 2,
    category: 'Science',
  },
  {
    q: 'What is 250 ÷ 5?',
    options: ['40', '50', '60', '45'],
    correct: 1,
    category: 'Math',
  },
  {
    q: 'What is the capital city of France?',
    options: ['Berlin', 'Madrid', 'Rome', 'Paris'],
    correct: 3,
    category: 'Geography',
  },
];

export default function BattlePass() {
  const { path, params } = useRoute();
  const { wallet, profile } = useProfile();
  const initialView = path === 'parent' || params.get('view') === 'parent' ? 'parent' : 'kid';
  const [view, setView] = useState(initialView);
  const [data, setData] = useState(null);
  const [parentDashboard, setParentDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  // Modals & subviews
  const [showQuiz, setShowQuiz] = useState(false);
  const [submittingChore, setSubmittingChore] = useState(null);
  const [choreNote, setChoreNote] = useState('');
  const [showCustomChore, setShowCustomChore] = useState(false);
  const [newChore, setNewChore] = useState({
    title: '',
    category: 'study',
    energyReward: 2,
    xpReward: 50,
    allowanceReward: 2.0,
  });
  const [linkKidInput, setLinkKidInput] = useState('');
  const [activeKidTab, setActiveKidTab] = useState('chores'); // chores | roadmap | vouchers

  const showToast = useCallback((msg, type = 'info') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const loadKidData = useCallback(async (address) => {
    if (!address) return;
    try {
      const res = await fetch(`${API}/api/chores/${address}`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (err) {
      console.warn('Failed loading chore data:', err);
    }
  }, []);

  const loadParentDashboard = useCallback(async (parentAddr) => {
    if (!parentAddr) return;
    try {
      const res = await fetch(`${API}/api/parent/${parentAddr}/dashboard`);
      if (res.ok) {
        const json = await res.json();
        setParentDashboard(json);
      }
    } catch (err) {
      console.warn('Failed loading parent dashboard:', err);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([
      loadKidData(wallet.address),
      loadParentDashboard(wallet.address),
    ]);
    setLoading(false);
  }, [loadKidData, loadParentDashboard, wallet.address]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  // Real-time socket events for proof-of-chore & energy updates
  useEffect(() => {
    const onChoreVerified = (payload) => {
      showToast(`🎉 Chore verified on-chain! +${payload?.chore?.energyReward || 2} ⚡ Energy added!`, 'success');
      refreshAll();
    };
    const onChoreUpdated = () => refreshAll();
    const onChoreCreated = () => refreshAll();
    const onPlayerUpdate = () => refreshAll();
    const onParentLinked = ({ parentAddress }) => {
      showToast(`🎉 Verified Parent linked (${short(parentAddress)})!`, 'success');
      refreshAll();
    };

    socket.on('chore:verified', onChoreVerified);
    socket.on('chore:updated', onChoreUpdated);
    socket.on('chore:created', onChoreCreated);
    socket.on('player:update', onPlayerUpdate);
    socket.on('parent:linked', onParentLinked);

    return () => {
      socket.off('chore:verified', onChoreVerified);
      socket.off('chore:updated', onChoreUpdated);
      socket.off('chore:created', onChoreCreated);
      socket.off('player:update', onPlayerUpdate);
      socket.off('parent:linked', onParentLinked);
    };
  }, [refreshAll, showToast]);

  // Submit a chore (kid)
  async function handleSubmitChore(e) {
    e.preventDefault();
    if (!submittingChore) return;
    try {
      const res = await fetch(`${API}/api/chores/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kidAddress: wallet.address,
          choreId: submittingChore.id,
          notes: choreNote.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Submission failed');
      showToast('Chore submitted! Waiting for Parent Oracle verification ⏳', 'success');
      setSubmittingChore(null);
      setChoreNote('');
      refreshAll();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // Parent verifies a chore with cryptographic attestation
  async function handleVerifyChore(chore) {
    try {
      let signature = null;
      let message = null;

      // Create attestation message
      message = `Attest chore verified: ${chore.id} for ${chore.kidAddress} at ${Date.now()}`;

      if (wallet.source === 'metamask' && window.ethereum) {
        try {
          signature = await window.ethereum.request({
            method: 'personal_sign',
            params: [message, wallet.address],
          });
        } catch {
          // If MetaMask rejected signature, notify
          showToast('MetaMask signature cancelled. Attestation will proceed via server oracle.', 'info');
        }
      } else if (wallet.privateKey) {
        // Sign with local wallet key
        const signer = new ethers.Wallet(wallet.privateKey);
        signature = await signer.signMessage(message);
      }

      const res = await fetch(`${API}/api/chores/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          choreId: chore.id,
          parentAddress: wallet.address,
          signature,
          message,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Verification failed');
      showToast(`Verified! Recorded on-chain (${json.onchainRecord?.txHash?.slice(0, 10) || 'simulated'}...). Kid received ⚡ energy & allowance.`, 'success');
      refreshAll();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // Parent creates custom chore
  async function handleCreateChore(e) {
    e.preventDefault();
    if (!newChore.title.trim()) return;
    const targetKid = parentDashboard?.kids?.[0]?.address || wallet.address;
    try {
      const res = await fetch(`${API}/api/chores/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kidAddress: targetKid,
          parentAddress: wallet.address,
          title: newChore.title.trim(),
          category: newChore.category,
          energyReward: Number(newChore.energyReward),
          xpReward: Number(newChore.xpReward),
          allowanceReward: Number(newChore.allowanceReward),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to create chore');
      showToast('Custom chore bounty created!', 'success');
      setShowCustomChore(false);
      setNewChore({ title: '', category: 'study', energyReward: 2, xpReward: 50, allowanceReward: 2.0 });
      refreshAll();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // Link Kid wallet (parent)
  async function handleLinkKid(e) {
    e.preventDefault();
    if (!linkKidInput.trim()) return;
    try {
      const res = await fetch(`${API}/api/parent/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kidAddress: linkKidInput.trim(),
          parentAddress: wallet.address,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Linking failed');
      showToast(`Linked kid ${json.name || short(json.address)}!`, 'success');
      setLinkKidInput('');
      refreshAll();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // Redeem Voucher (parent)
  async function handleRedeemVoucher(voucherId) {
    try {
      const res = await fetch(`${API}/api/vouchers/redeem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voucherId, parentAddress: wallet.address }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Redemption failed');
      showToast('Voucher marked as redeemed in real life!', 'success');
      refreshAll();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  const currentEnergy = data?.energy ?? profile?.energy ?? 5;
  const currentTier = data?.battlePassTier ?? profile?.battlePassTier ?? 1;
  const currentXp = data?.battlePassXp ?? profile?.battlePassXp ?? 0;
  const allowance = data?.allowanceBalance ?? profile?.allowanceBalance ?? 0;
  const tiers = data?.tiers || [];
  const nextTierObj = tiers.find(t => t.tier === currentTier + 1);
  const nextTierXp = nextTierObj ? nextTierObj.xpRequired : 5000;
  const xpProgressPercent = Math.min(100, Math.round((currentXp / nextTierXp) * 100));

  const pendingParentApprovals = parentDashboard?.pendingChores || [];

  return (
    <div className="battlepass-page">
      <div className="bp-glow" aria-hidden="true" />

      {/* Toast Alert */}
      {toast && (
        <div className={`bp-toast toast-${toast.type}`}>
          {toast.msg}
        </div>
      )}

      {/* Top Navbar */}
      <header className="bp-topbar">
        <div className="bp-brand" onClick={() => navigate('hub')}>
          <span className="bp-logo">⚡</span>
          <span className="bp-title">Battle Pass Arena</span>
        </div>

        <div className="bp-top-actions">
          {/* Mode Switcher */}
          <div className="mode-toggle-group">
            <button
              type="button"
              className={`mode-btn ${view === 'kid' ? 'active' : ''}`}
              onClick={() => setView('kid')}
            >
              🎮 Kid Arena
            </button>
            <button
              type="button"
              className={`mode-btn ${view === 'parent' ? 'active' : ''}`}
              onClick={() => setView('parent')}
            >
              👨‍👩‍👧 Parent Oracle
              {pendingParentApprovals.length > 0 && (
                <span className="badge-pending-count">{pendingParentApprovals.length}</span>
              )}
            </button>
          </div>

          <button type="button" className="bp-back-btn" onClick={() => navigate('hub')}>
            ← Back to Hub
          </button>
        </div>
      </header>

      {/* Quests & Energy Banner */}
      <div className="bp-marketing-banner">
        <div className="hook-icon">⚡</div>
        <div className="hook-content">
          <div className="hook-headline">Earn Energy & Quests</div>
          <div className="hook-sub">
            Finish real-world chores or answer quick quiz questions to earn Energy, unlock season tiers, and save allowance tokens.
          </div>
        </div>
        <div className="hook-cta">
          <button type="button" className="btn-take-quiz" onClick={() => setShowQuiz(true)}>
            Take 5-Question Quiz (+2 ⚡)
          </button>
        </div>
      </div>

      {/* Stats Summary Bar */}
      <div className="bp-stats-bar">
        <div className="stat-card energy-stat">
          <div className="stat-icon">⚡</div>
          <div className="stat-details">
            <div className="stat-num">{currentEnergy}</div>
            <div className="stat-name">Arena Energy</div>
          </div>
          <div className="stat-note">1 ⚡ consumed per match</div>
        </div>

        <div className="stat-card tier-stat">
          <div className="stat-icon">🏆</div>
          <div className="stat-details">
            <div className="stat-num">Tier {currentTier}</div>
            <div className="stat-name">{currentXp} / {nextTierXp} XP</div>
          </div>
          <div className="xp-bar-outer">
            <div className="xp-bar-inner" style={{ width: `${xpProgressPercent}%` }} />
          </div>
        </div>

        <div className="stat-card allowance-stat">
          <div className="stat-icon">💵</div>
          <div className="stat-details">
            <div className="stat-num">${allowance.toFixed(2)}</div>
            <div className="stat-name">Allowance Vault</div>
          </div>
          <div className="stat-note">Parent-backed & redeemable</div>
        </div>

        <div className="stat-card parent-link-stat">
          <div className="stat-icon">🔗</div>
          <div className="stat-details">
            <div className="stat-num">{data?.parentAddress ? short(data.parentAddress) : 'Unlinked'}</div>
            <div className="stat-name">Parent Oracle</div>
          </div>
          <div className="stat-note">
            {data?.parentAddress ? '✅ Verified Parent linked' : '⚠️ Switch to Parent mode to link'}
          </div>
        </div>
      </div>

      {/* ================= KID VIEW ================= */}
      {view === 'kid' && (
        <main className="kid-view">
          {/* Sub Navigation */}
          <div className="kid-tabs">
            <button
              type="button"
              className={`tab-btn ${activeKidTab === 'chores' ? 'active' : ''}`}
              onClick={() => setActiveKidTab('chores')}
            >
              📋 Chore Bounty Board
            </button>
            <button
              type="button"
              className={`tab-btn ${activeKidTab === 'roadmap' ? 'active' : ''}`}
              onClick={() => setActiveKidTab('roadmap')}
            >
              🎖️ Battle Pass Roadmap
            </button>
            <button
              type="button"
              className={`tab-btn ${activeKidTab === 'vouchers' ? 'active' : ''}`}
              onClick={() => setActiveKidTab('vouchers')}
            >
              🎟️ Unlocked Vouchers ({data?.vouchers?.length || 0})
            </button>
          </div>

          {/* TAB 1: Chore Bounty Board */}
          {activeKidTab === 'chores' && (
            <section className="chore-board-section">
              <div className="section-head">
                <div>
                  <h2 className="section-title">Daily Chore Bounties</h2>
                  <p className="section-sub">
                    Pick a chore, complete it in the real world, and click "I Did This!" for your parent to verify on-chain.
                  </p>
                </div>
                <button type="button" className="btn-take-quiz-pill" onClick={() => setShowQuiz(true)}>
                  🧠 Instant Energy: Brain Quiz
                </button>
              </div>

              <div className="chores-grid">
                {(data?.chores || []).map((c) => {
                  const isVerified = c.status === 'verified';
                  const isPending = c.status === 'pending_approval';
                  return (
                    <div key={c.id} className={`chore-card status-${c.status}`}>
                      <div className="chore-card-top">
                        <span className="category-chip">{categoryIcon(c.category)} {c.category}</span>
                        <span className={`status-chip status-${c.status}`}>
                          {isVerified ? '✅ Verified On-Chain' : isPending ? '⏳ Pending Approval' : 'Ready'}
                        </span>
                      </div>

                      <h3 className="chore-title">{c.title}</h3>

                      <div className="chore-bounties">
                        <span className="bounty-item energy">
                          ⚡ +{c.energyReward} Energy
                        </span>
                        <span className="bounty-item xp">
                          ⭐ +{c.xpReward} XP
                        </span>
                        <span className="bounty-item allowance">
                          💵 +${c.allowanceReward?.toFixed(2)}
                        </span>
                      </div>

                      <div className="chore-footer">
                        {isVerified ? (
                          <div className="verified-note">
                            Verified by Parent Oracle! Rewards claimed.
                          </div>
                        ) : isPending ? (
                          <div className="pending-note">
                            Waiting for parent attestation...
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="btn-submit-chore"
                            onClick={() => {
                              setSubmittingChore(c);
                              setChoreNote('');
                            }}
                          >
                            ✓ I Did This! (Submit)
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* TAB 2: Battle Pass Roadmap */}
          {activeKidTab === 'roadmap' && (
            <section className="roadmap-section">
              <div className="section-head">
                <div>
                  <h2 className="section-title">Season 1 Battle Pass Track</h2>
                  <p className="section-sub">
                    Earn Battle Pass XP from Chores and Arena Matches to unlock exclusive vouchers & ARENA tokens!
                  </p>
                </div>
                <div className="roadmap-progress-badge">
                  Tier {currentTier} / 10 · {currentXp} Total XP
                </div>
              </div>

              <div className="tiers-track">
                {tiers.map((t) => {
                  const isUnlocked = currentTier >= t.tier;
                  const isCurrent = currentTier === t.tier;
                  return (
                    <div
                      key={t.tier}
                      className={`tier-card ${isUnlocked ? 'unlocked' : 'locked'} ${isCurrent ? 'current' : ''}`}
                    >
                      <div className="tier-num-badge">
                        {isUnlocked ? '✓' : `T${t.tier}`}
                      </div>
                      <div className="tier-xp-req">{t.xpRequired} XP</div>
                      <div className="tier-title">{t.title}</div>

                      <div className="tier-reward-box">
                        <div className="reward-tokens">🪙 {t.tokenReward} ARENA</div>
                        {t.energyReward > 0 && (
                          <div className="reward-energy">⚡ +{t.energyReward} Energy</div>
                        )}
                        {t.voucherReward && (
                          <div className="reward-voucher">
                            🎟️ <strong>{t.voucherReward.title}</strong>
                            <div className="voucher-desc">{t.voucherReward.description}</div>
                          </div>
                        )}
                      </div>

                      <div className="tier-status-label">
                        {isUnlocked ? '✨ Unlocked' : '🔒 Locked'}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* TAB 3: Unlocked Vouchers */}
          {activeKidTab === 'vouchers' && (
            <section className="vouchers-section">
              <div className="section-head">
                <div>
                  <h2 className="section-title">My Real-World Vouchers</h2>
                  <p className="section-sub">
                    Show these vouchers to your parent in real life to claim your screen time, pizza party, or toy store reward!
                  </p>
                </div>
              </div>

              {(!data?.vouchers || data.vouchers.length === 0) ? (
                <div className="no-vouchers-card">
                  <div className="no-icon">🎟️</div>
                  <h3>No vouchers unlocked yet</h3>
                  <p>Reach higher Battle Pass tiers by completing chores and winning arena matches!</p>
                  <button type="button" className="btn-take-quiz" onClick={() => setActiveKidTab('chores')}>
                    Go to Chore Board
                  </button>
                </div>
              ) : (
                <div className="vouchers-grid">
                  {data.vouchers.map((v) => {
                    const isRedeemed = v.status === 'redeemed';
                    return (
                      <div key={v.id} className={`voucher-card ${isRedeemed ? 'redeemed' : 'active'}`}>
                        <div className="voucher-header">
                          <span className="voucher-tier">Tier {v.tier} Reward</span>
                          <span className={`voucher-status-chip ${v.status}`}>
                            {isRedeemed ? '✅ Redeemed' : '✨ Ready to Redeem'}
                          </span>
                        </div>
                        <h3 className="voucher-title">{v.title}</h3>
                        <p className="voucher-desc">{v.description}</p>
                        <div className="voucher-footer">
                          {isRedeemed ? (
                            <span className="redeemed-label">Redeemed by parent on {new Date(v.redeemedAt).toLocaleDateString()}</span>
                          ) : (
                            <span className="claim-prompt">Show to Mom or Dad to claim!</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}
        </main>
      )}

      {/* ================= PARENT ORACLE VIEW ================= */}
      {view === 'parent' && (
        <main className="parent-view">
          <div className="parent-banner">
            <div className="oracle-badge">
              <span className="oracle-dot" /> Verified Parent Oracle Dashboard
            </div>
            <h2>Parent Verification & Allowance Hub</h2>
            <p>
              Verify your child's real-world tasks on-chain, issue custom chore bounties, and manage allowance rewards.
            </p>
            <div className="parent-wallet-info">
              Connected Oracle Wallet: <code>{wallet.address}</code>
            </div>
          </div>

          <div className="parent-grid">
            {/* Left Column: Pending Verifications */}
            <div className="parent-col left">
              <div className="panel-box">
                <div className="panel-head">
                  <h3>⏳ Pending Chore Approvals ({pendingParentApprovals.length})</h3>
                  <button type="button" className="btn-refresh sm" onClick={refreshAll}>
                    Refresh
                  </button>
                </div>

                {pendingParentApprovals.length === 0 ? (
                  <div className="empty-pending">
                    <p>🎉 All caught up! No chores pending your approval right now.</p>
                  </div>
                ) : (
                  <div className="pending-list">
                    {pendingParentApprovals.map((p) => (
                      <div key={p.id} className="pending-card">
                        <div className="pending-top">
                          <span className="kid-tag">👤 {short(p.kidAddress)}</span>
                          <span className="category-chip">{categoryIcon(p.category)} {p.category}</span>
                        </div>
                        <h4 className="pending-chore-title">{p.title}</h4>
                        {p.notes && (
                          <div className="kid-note-box">
                            <strong>Kid's note:</strong> "{p.notes}"
                          </div>
                        )}
                        <div className="pending-bounties">
                          <span>⚡ +{p.energyReward} Energy</span>
                          <span>⭐ +{p.xpReward} XP</span>
                          <span>💵 +${p.allowanceReward?.toFixed(2)}</span>
                        </div>
                        <button
                          type="button"
                          className="btn-approve-onchain"
                          onClick={() => handleVerifyChore(p)}
                        >
                          🔐 Attest & Approve On-Chain
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Unlocked Vouchers to Redeem */}
              <div className="panel-box vouchers-mgmt">
                <div className="panel-head">
                  <h3>🎟️ Child Vouchers to Redeem</h3>
                </div>
                {(!parentDashboard?.kids || parentDashboard.kids.length === 0) ? (
                  <p className="empty-text">No kids linked yet.</p>
                ) : (
                  <div className="kids-vouchers-list">
                    {parentDashboard.kids.map(kid => (
                      <div key={kid.address} className="kid-vouchers-group">
                        <div className="kid-subhead">
                          <strong>{kid.name || short(kid.address)}</strong> — Allowance: ${kid.allowanceBalance?.toFixed(2) || '0.00'}
                        </div>
                        {(!kid.vouchers || kid.vouchers.filter(v => v.status === 'active').length === 0) ? (
                          <div className="no-active-vouchers">No pending active vouchers</div>
                        ) : (
                          kid.vouchers.filter(v => v.status === 'active').map(v => (
                            <div key={v.id} className="parent-voucher-row">
                              <div>
                                <strong>{v.title}</strong>
                                <div className="sm-desc">{v.description}</div>
                              </div>
                              <button
                                type="button"
                                className="btn-redeem-sm"
                                onClick={() => handleRedeemVoucher(v.id)}
                              >
                                Mark Redeemed
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Actions */}
            <div className="parent-col right">
              {/* Link Kid Box */}
              <div className="panel-box link-kid-box">
                <div className="panel-head">
                  <h3>🔗 Link Child Wallet</h3>
                </div>
                <form onSubmit={handleLinkKid} className="link-form">
                  <label htmlFor="kid-input">Child's Wallet Address</label>
                  <input
                    id="kid-input"
                    type="text"
                    placeholder="0x... or child username"
                    value={linkKidInput}
                    onChange={(e) => setLinkKidInput(e.target.value)}
                  />
                  <button type="submit" className="btn-link">
                    Link Child
                  </button>
                </form>

                {parentDashboard?.kids && parentDashboard.kids.length > 0 && (
                  <div className="linked-kids-list">
                    <h4>Linked Children:</h4>
                    <ul>
                      {parentDashboard.kids.map(k => (
                        <li key={k.address}>
                          <span>{k.name || short(k.address)}</span>
                          <span className="kid-stat-mini">⚡ {k.energy ?? 5} | ${k.allowanceBalance?.toFixed(2) || '0.00'}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Create Custom Chore Bounty */}
              <div className="panel-box create-chore-box">
                <div className="panel-head">
                  <h3>✨ Create Custom Chore Bounty</h3>
                </div>
                <form onSubmit={handleCreateChore} className="create-chore-form">
                  <label>Chore Title</label>
                  <input
                    type="text"
                    placeholder="e.g. Practice piano for 20 mins"
                    value={newChore.title}
                    onChange={e => setNewChore({ ...newChore, title: e.target.value })}
                    required
                  />

                  <div className="form-row">
                    <div>
                      <label>Category</label>
                      <select
                        value={newChore.category}
                        onChange={e => setNewChore({ ...newChore, category: e.target.value })}
                      >
                        <option value="cleaning">🧹 Cleaning</option>
                        <option value="homework">📝 Homework</option>
                        <option value="reading">📚 Reading</option>
                        <option value="study">🧠 Study / Music</option>
                        <option value="fitness">🏃 Fitness / Sports</option>
                        <option value="pets">🐕 Pet Care</option>
                      </select>
                    </div>

                    <div>
                      <label>⚡ Energy Reward</label>
                      <input
                        type="number"
                        min="1"
                        max="10"
                        value={newChore.energyReward}
                        onChange={e => setNewChore({ ...newChore, energyReward: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="form-row">
                    <div>
                      <label>⭐ Battle Pass XP</label>
                      <input
                        type="number"
                        min="10"
                        max="200"
                        value={newChore.xpReward}
                        onChange={e => setNewChore({ ...newChore, xpReward: e.target.value })}
                      />
                    </div>

                    <div>
                      <label>💵 Allowance Bounty ($)</label>
                      <input
                        type="number"
                        step="0.50"
                        min="0"
                        max="50"
                        value={newChore.allowanceReward}
                        onChange={e => setNewChore({ ...newChore, allowanceReward: e.target.value })}
                      />
                    </div>
                  </div>

                  <button type="submit" className="btn-create-bounty">
                    + Add Chore Bounty
                  </button>
                </form>
              </div>
            </div>
          </div>
        </main>
      )}

      {/* ================= MODAL: SUBMIT CHORE ================= */}
      {submittingChore && (
        <div className="modal-overlay" onClick={() => setSubmittingChore(null)}>
          <div className="bp-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Submit Chore for Proof</h3>
              <button type="button" className="close-btn" onClick={() => setSubmittingChore(null)}>×</button>
            </div>
            <form onSubmit={handleSubmitChore} className="submit-chore-form">
              <div className="modal-chore-summary">
                <h4>{submittingChore.title}</h4>
                <div className="bounty-pills">
                  <span>⚡ +{submittingChore.energyReward} Energy</span>
                  <span>💵 +${submittingChore.allowanceReward?.toFixed(2)}</span>
                </div>
              </div>

              <label htmlFor="chore-notes">Add a quick note or message for Mom/Dad:</label>
              <textarea
                id="chore-notes"
                rows="3"
                placeholder="e.g. Put all toys away and vacuumed the rug!"
                value={choreNote}
                onChange={e => setChoreNote(e.target.value)}
              />

              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setSubmittingChore(null)}>
                  Cancel
                </button>
                <button type="submit" className="btn-submit-confirm">
                  Submit to Parent Oracle
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= MODAL: 5-QUESTION BRAIN QUIZ ================= */}
      {showQuiz && (
        <BrainQuizModal
          onClose={() => setShowQuiz(false)}
          wallet={wallet}
          onSuccess={() => {
            setShowQuiz(false);
            showToast('🎉 Brain Quiz Passed! +2 ⚡ Arena Energy awarded!', 'success');
            refreshAll();
          }}
        />
      )}
    </div>
  );
}

// ----------------- BRAIN QUIZ MODAL COMPONENT -----------------
function BrainQuizModal({ onClose, wallet, onSuccess }) {
  const questions = useMemo(() => {
    // Pick 5 random questions from the pool
    const shuffled = [...QUIZ_QUESTIONS_POOL].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, 5);
  }, []);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const currentQ = questions[currentIndex];

  function handleSelect(optionIndex) {
    if (submitted) return;
    setSelectedAnswers({ ...selectedAnswers, [currentIndex]: optionIndex });
  }

  function handleNext() {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  }

  function handlePrev() {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  }

  async function handleFinish() {
    // Calculate score
    let score = 0;
    questions.forEach((q, idx) => {
      if (selectedAnswers[idx] === q.correct) score++;
    });

    setSubmitted(true);

    if (score >= 4) {
      setLoading(true);
      try {
        const res = await fetch(`${API}/api/chores/quiz-complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kidAddress: wallet.address, score }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Quiz submission failed');
        onSuccess();
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
  }

  let finalScore = 0;
  if (submitted) {
    questions.forEach((q, idx) => {
      if (selectedAnswers[idx] === q.correct) finalScore++;
    });
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="bp-modal quiz-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>🧠 5-Question Brain Quiz</h3>
          <button type="button" className="close-btn" onClick={onClose}>×</button>
        </div>

        {!submitted ? (
          <div className="quiz-body">
            <div className="quiz-progress-bar">
              <span className="quiz-badge">Question {currentIndex + 1} of {questions.length}</span>
              <span className="quiz-rule">Score 4/5 or 5/5 to earn +2 ⚡ Energy</span>
            </div>

            <div className="question-box">
              <div className="question-cat">{currentQ.category}</div>
              <h4 className="question-text">{currentQ.q}</h4>
            </div>

            <div className="options-grid">
              {currentQ.options.map((opt, optIdx) => {
                const isSelected = selectedAnswers[currentIndex] === optIdx;
                return (
                  <button
                    key={optIdx}
                    type="button"
                    className={`quiz-opt-btn ${isSelected ? 'selected' : ''}`}
                    onClick={() => handleSelect(optIdx)}
                  >
                    <span className="opt-letter">{['A', 'B', 'C', 'D'][optIdx]}</span>
                    <span className="opt-text">{opt}</span>
                  </button>
                );
              })}
            </div>

            <div className="quiz-nav">
              <button
                type="button"
                className="btn-prev"
                onClick={handlePrev}
                disabled={currentIndex === 0}
              >
                ← Back
              </button>

              {currentIndex < questions.length - 1 ? (
                <button
                  type="button"
                  className="btn-next"
                  onClick={handleNext}
                  disabled={selectedAnswers[currentIndex] === undefined}
                >
                  Next →
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-finish-quiz"
                  onClick={handleFinish}
                  disabled={Object.keys(selectedAnswers).length < questions.length || loading}
                >
                  {loading ? 'Submitting…' : 'Submit Quiz 🚀'}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="quiz-result">
            {finalScore >= 4 ? (
              <div className="result-pass">
                <div className="result-icon">🏆</div>
                <h3>Quiz Passed!</h3>
                <p>You scored <strong>{finalScore} / {questions.length}</strong>!</p>
                <div className="energy-reward-badge">+2 ⚡ Arena Energy Unlocked</div>
              </div>
            ) : (
              <div className="result-fail">
                <div className="result-icon">💪</div>
                <h3>Nice Try!</h3>
                <p>You scored <strong>{finalScore} / {questions.length}</strong> (need 4 to pass).</p>
                <p>Try again or complete a real-world chore to earn Energy!</p>
                <button
                  type="button"
                  className="btn-retry"
                  onClick={() => {
                    setSelectedAnswers({});
                    setCurrentIndex(0);
                    setSubmitted(false);
                  }}
                >
                  Retry Quiz
                </button>
              </div>
            )}
            {error && <div className="quiz-error">{error}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

function categoryIcon(cat) {
  switch (cat) {
    case 'cleaning': return '🧹';
    case 'homework': return '📝';
    case 'reading': return '📚';
    case 'study': return '🧠';
    case 'fitness': return '🏃';
    case 'pets': return '🐕';
    default: return '⭐';
  }
}
