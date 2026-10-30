import React, { useState } from 'react';
import { short, exportKeystoreJson, restoreWalletFromInput, getOrCreateWallet, saveWallet, clearWalletSession } from '../lib/session.js';
import { signAndIdentify } from '../socket.js';
import './account-modal.css';

export default function AccountModal({ wallet, setWallet, profile, onClose }) {
  const [activeTab, setActiveTab] = useState('keys'); // 'keys' | 'restore' | 'new'
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [copiedWords, setCopiedWords] = useState(false);
  
  // Restore form
  const [importInput, setImportInput] = useState('');
  const [importName, setImportName] = useState('');
  const [restoreError, setRestoreError] = useState(null);
  const [restoreSuccess, setRestoreSuccess] = useState(null);

  const isDemo = wallet?.source === 'demo' || wallet?.source === 'imported';
  const mnemonicWords = wallet?.mnemonic ? wallet.mnemonic.trim().split(/\s+/) : null;

  function copyText(text, setter) {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setter(true);
    setTimeout(() => setter(false), 2000);
  }

  function downloadBackup() {
    const jsonStr = exportKeystoreJson(wallet);
    if (!jsonStr) return;
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `arena-vault-${wallet.address.slice(0, 8)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function handleRestore(e) {
    e.preventDefault();
    setRestoreError(null);
    setRestoreSuccess(null);
    try {
      const restored = restoreWalletFromInput(importInput, importName || profile?.name);
      setWallet(restored);
      signAndIdentify(restored);
      setRestoreSuccess(`Successfully restored identity: ${short(restored.address)}`);
      setImportInput('');
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err) {
      setRestoreError(err.message);
    }
  }

  function handleCreateNew() {
    if (confirm('Create a new guest account? Any unsaved tokens or skins on this account will be lost unless you have backed up your secret key.')) {
      clearWalletSession();
      const fresh = getOrCreateWallet();
      setWallet(fresh);
      signAndIdentify(fresh);
      onClose();
    }
  }

  return (
    <div className="account-modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="account-modal" onClick={e => e.stopPropagation()}>
        <div className="account-modal-header">
          <div className="account-modal-title">
            <span className="key-icon">🛡️</span>
            <h3>Web3 Identity & Key Vault</h3>
          </div>
          <button type="button" className="account-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="account-tabs">
          <button
            type="button"
            className={`account-tab ${activeTab === 'keys' ? 'active' : ''}`}
            onClick={() => setActiveTab('keys')}
          >
            🔑 My Account Keys
          </button>
          <button
            type="button"
            className={`account-tab ${activeTab === 'restore' ? 'active' : ''}`}
            onClick={() => setActiveTab('restore')}
          >
            📥 Restore Account
          </button>
          <button
            type="button"
            className={`account-tab ${activeTab === 'new' ? 'active' : ''}`}
            onClick={() => setActiveTab('new')}
          >
            ✨ Switch / New
          </button>
        </div>

        <div className="account-modal-body">
          {activeTab === 'keys' && (
            <div className="tab-pane">
              <div className="identity-card">
                <div className="identity-row">
                  <span className="identity-label">Player Name:</span>
                  <span className="identity-val">{profile?.name || wallet.name}</span>
                </div>
                <div className="identity-row">
                  <span className="identity-label">Account Address:</span>
                  <div className="address-copy-box">
                    <span className="address-val" title={wallet.address}>{wallet.address}</span>
                    <button
                      type="button"
                      className="btn-copy-chip"
                      onClick={() => copyText(wallet.address, setCopiedAddress)}
                    >
                      {copiedAddress ? '✓ Copied' : '📋 Copy'}
                    </button>
                  </div>
                </div>
                <div className="identity-row">
                  <span className="identity-label">Identity Type:</span>
                  <span className={`identity-badge ${isDemo ? 'demo' : 'metamask'}`}>
                    {isDemo ? 'Embedded Burner Key (EIP-191)' : 'MetaMask Hardware/Extension'}
                  </span>
                </div>
              </div>

              {isDemo && (
                <>
                  <div className="security-notice">
                    <span className="shield-icon">🛡️</span>
                    <p>
                      <strong>Parent / Player Backup:</strong> Your burner key is stored safely on this device in dual local storage. Back up your 12-word phrase or private key so you can play on other devices or restore your account if your browser data is cleared.
                    </p>
                  </div>

                  {mnemonicWords && (
                    <div className="mnemonic-section">
                      <div className="mnemonic-header">
                        <span className="mnemonic-title">📜 12-Word Secret Recovery Phrase:</span>
                        <button
                          type="button"
                          className="btn-copy-chip"
                          onClick={() => copyText(wallet.mnemonic, setCopiedWords)}
                        >
                          {copiedWords ? '✓ 12 Words Copied' : '📋 Copy 12 Words'}
                        </button>
                      </div>
                      <div className="mnemonic-grid">
                        {mnemonicWords.map((word, idx) => (
                          <div key={idx} className="mnemonic-chip">
                            <span className="chip-idx">{idx + 1}</span>
                            <span className="chip-word">{word}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="private-key-section">
                    <div className="pk-header">
                      <span>Secret Private Key (Hex):</span>
                      <div className="pk-actions">
                        <button
                          type="button"
                          className="btn-toggle-pk"
                          onClick={() => setShowPrivateKey(!showPrivateKey)}
                        >
                          {showPrivateKey ? '🙈 Hide' : '👁 Reveal'}
                        </button>
                        <button
                          type="button"
                          className="btn-copy-chip"
                          onClick={() => copyText(wallet.privateKey, setCopiedKey)}
                        >
                          {copiedKey ? '✓ Copied' : '📋 Copy Key'}
                        </button>
                      </div>
                    </div>
                    <div className="pk-display">
                      {showPrivateKey
                        ? wallet.privateKey
                        : '••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••'}
                    </div>
                  </div>

                  <div className="backup-download-box">
                    <button type="button" className="btn-download-keystore" onClick={downloadBackup}>
                      💾 Download Account Backup File (.json)
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === 'restore' && (
            <form className="tab-pane" onSubmit={handleRestore}>
              <p className="restore-desc">
                Switching to a new tablet, school computer, or restoring after clearing cookies? Enter your 12-word recovery phrase or 64-character private key below.
              </p>

              {restoreError && <div className="vault-error-alert">{restoreError}</div>}
              {restoreSuccess && <div className="vault-success-alert">{restoreSuccess}</div>}

              <div className="form-group">
                <label>Secret Phrase or Private Key:</label>
                <textarea
                  className="vault-input textarea"
                  rows={3}
                  placeholder="e.g. apple banana chair dog ... OR 0xac0974bec39..."
                  value={importInput}
                  onChange={e => setImportInput(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label>Player Name (optional):</label>
                <input
                  type="text"
                  className="vault-input"
                  placeholder="Keep current or enter custom nickname"
                  value={importName}
                  onChange={e => setImportName(e.target.value)}
                />
              </div>

              <button type="submit" className="btn-submit-restore">
                📥 Restore & Load Account
              </button>
            </form>
          )}

          {activeTab === 'new' && (
            <div className="tab-pane">
              <div className="new-account-box">
                <h4>Generate a Brand-New Account</h4>
                <p>
                  Need to start fresh as a guest or let a sibling play on this browser?
                  Click below to generate a new embedded burner wallet.
                </p>
                <div className="warning-box">
                  ⚠️ Make sure you have copied your current account's 12-word phrase or downloaded the backup file first, or your current stats and tokens will be inaccessible on this device!
                </div>
                <button type="button" className="btn-create-new-wallet" onClick={handleCreateNew}>
                  ✨ Create Fresh Account
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
