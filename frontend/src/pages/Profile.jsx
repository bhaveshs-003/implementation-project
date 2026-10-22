import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { apiFetch } from '../lib/api.js';
import { roleLabel } from '../lib/format.js';
import Icon, { Avatar } from '../components/Icon.jsx';

const footerStyle = { display: 'flex', justifyContent: 'flex-end' };

const COMMON_PASSWORDS = ['password', 'qwerty', '123456', '12345678', 'letmein', 'welcome', 'admin', 'iloveyou', 'abc123', 'passw0rd'];

const STRENGTH_LEVELS = [
  { label: 'Too short', color: 'var(--danger)' },
  { label: 'Weak', color: 'var(--danger)' },
  { label: 'Fair', color: 'var(--warning)' },
  { label: 'Good', color: 'var(--primary)' },
  { label: 'Strong', color: 'var(--success)' },
];

function scorePassword(pw, personalWords = []) {
  const checks = {
    length: pw.length >= 10,
    mixedCase: /[a-z]/.test(pw) && /[A-Z]/.test(pw),
    number: /\d/.test(pw),
    symbol: /[^A-Za-z0-9]/.test(pw),
  };
  if (!checks.length) return { score: 0, checks };

  let score = 1 + [checks.mixedCase, checks.number, checks.symbol].filter(Boolean).length;
  if (pw.length >= 14) score += 1;

  const lower = pw.toLowerCase();
  const personal = personalWords.map(w => (w || '').toLowerCase()).filter(w => w.length >= 3);
  if (COMMON_PASSWORDS.some(c => lower.includes(c)) || personal.some(w => lower.includes(w))) score -= 2;
  if (/(.)\1{3,}/.test(pw)) score -= 1;

  return { score: Math.max(1, Math.min(4, score)), checks };
}

const STRENGTH_CHECKS = [
  ['length', 'At least 10 characters'],
  ['mixedCase', 'Upper and lower case'],
  ['number', 'A number'],
  ['symbol', 'A symbol'],
];

function StrengthMeter({ password, personalWords }) {
  if (!password) return null;
  const { score, checks } = scorePassword(password, personalWords);
  const level = STRENGTH_LEVELS[score];
  return (
    <div className="strength" aria-live="polite">
      <div className="strength-bars" role="meter" aria-valuemin={0} aria-valuemax={4} aria-valuenow={score} aria-label="Password strength">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="strength-bar" style={i <= score ? { background: level.color } : undefined} />
        ))}
      </div>
      <div className="strength-meta">
        <span className="subtle">Password strength</span>
        <span className="fw-600" style={{ color: level.color }}>{level.label}</span>
      </div>
      <ul className="strength-checks">
        {STRENGTH_CHECKS.map(([key, text]) => (
          <li key={key} className={checks[key] ? 'met' : ''}>
            <Icon name={checks[key] ? 'checkCircle' : 'circle'} />
            {text}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Profile() {
  const { person, refreshMe } = useAuth();

  const [profileName, setProfileName] = useState(person?.name || '');
  const [profileEmail, setProfileEmail] = useState(person?.email || '');
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState(false);
  const [profileError, setProfileError] = useState('');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwLoading, setPwLoading] = useState(false);
  const [pwSuccess, setPwSuccess] = useState(false);
  const [pwError, setPwError] = useState('');

  const canEditEmail = person?.role !== 'resource';

  const handleProfileSave = async (e) => {
    e.preventDefault();
    setProfileError('');
    setProfileSuccess(false);

    const payload = {};
    if (profileName.trim() !== person?.name) payload.name = profileName.trim();
    if (canEditEmail && profileEmail !== person?.email) payload.email = profileEmail;
    if (!Object.keys(payload).length) { setProfileSuccess(true); return; }

    setProfileLoading(true);
    try {
      await apiFetch('/api/people/me', { method: 'PUT', body: payload });
      if (typeof refreshMe === 'function') await refreshMe();
      setProfileSuccess(true);
    } catch (err) {
      setProfileError(err.error || 'Failed to update profile.');
    } finally {
      setProfileLoading(false);
    }
  };

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    setPwError('');
    setPwSuccess(false);

    if (newPassword.length < 10) { setPwError('New password must be at least 10 characters.'); return; }
    if (newPassword !== confirmPassword) { setPwError('New passwords do not match.'); return; }
    if (newPassword === currentPassword) { setPwError('New password must differ from the current password.'); return; }

    setPwLoading(true);
    try {
      await apiFetch('/api/auth/change-password', {
        method: 'POST',
        body: { current_password: currentPassword, new_password: newPassword },
      });
      setPwSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setPwError(err.error || 'Failed to change password. Check your current password.');
    } finally {
      setPwLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 720 }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">My Profile</h1>
          <p className="page-subtitle">Manage your account details and security settings.</p>
        </div>
      </div>

      {/* Profile summary */}
      <div className="card mb-24">
        <div className="card-body row" style={{ gap: 16 }}>
          <Avatar name={person?.name} size="lg" />
          <div style={{ minWidth: 0 }}>
            <div className="fw-600 truncate" style={{ fontSize: 17 }}>{person?.name || '—'}</div>
            <div className="muted text-sm truncate">{person?.email}</div>
            <span className="badge badge-primary mt-8">{roleLabel(person?.role)}</span>
          </div>
        </div>
      </div>

      {/* Editable profile info */}
      <div className="card mb-24">
        <div className="card-header">
          <div>
            <div className="card-title">Account details</div>
            <div className="card-subtitle">Update your name and contact email.</div>
          </div>
        </div>
        <form onSubmit={handleProfileSave}>
          <div className="card-body">
            {profileSuccess && (
              <div className="alert alert-success" role="status">
                <Icon name="checkCircle" />
                <span>Profile updated successfully!</span>
              </div>
            )}
            {profileError && (
              <div className="alert alert-error" role="alert">
                <Icon name="alert" />
                <span>{profileError}</span>
              </div>
            )}

            <div className="field">
              <label className="label" htmlFor="profile-name">Name</label>
              <input
                id="profile-name"
                className="input"
                value={profileName}
                onChange={e => setProfileName(e.target.value)}
                placeholder="Your full name"
                required
                minLength={2}
              />
            </div>
            <div className="form-grid">
              <div className="field">
                <label className="label" htmlFor="profile-email">
                  Email {!canEditEmail && <span className="label-hint">(not editable for resources)</span>}
                </label>
                <input
                  id="profile-email"
                  className="input"
                  type="email"
                  value={profileEmail}
                  onChange={e => setProfileEmail(e.target.value)}
                  readOnly={!canEditEmail}
                  placeholder="your@email.com"
                />
              </div>
              <div className="field">
                <label className="label" htmlFor="profile-role">Role</label>
                <input id="profile-role" className="input" value={roleLabel(person?.role)} readOnly />
              </div>
            </div>
          </div>
          <div className="card-footer" style={footerStyle}>
            <button type="submit" className="btn btn-primary" disabled={profileLoading}>
              {profileLoading ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>

      {/* Change password — only for users with a login */}
      {person?.role !== 'resource' && (
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Change password</div>
              <div className="card-subtitle">Choose a strong password of at least 10 characters.</div>
            </div>
          </div>
          <form onSubmit={handlePasswordChange}>
            <div className="card-body">
              {pwSuccess && (
                <div className="alert alert-success" role="status">
                  <Icon name="checkCircle" />
                  <span>Password changed successfully!</span>
                </div>
              )}
              {pwError && (
                <div className="alert alert-error" role="alert">
                  <Icon name="alert" />
                  <span>{pwError}</span>
                </div>
              )}

              <div className="field">
                <label className="label" htmlFor="pw-current">Current Password</label>
                <div className="input-group">
                  <Icon name="lock" />
                  <input id="pw-current" className="input" type="password" value={currentPassword}
                    onChange={e => setCurrentPassword(e.target.value)}
                    required autoComplete="current-password" />
                </div>
              </div>
              <div className="form-grid">
                <div className="field">
                  <label className="label" htmlFor="pw-new">New Password</label>
                  <div className="input-group">
                    <Icon name="key" />
                    <input id="pw-new" className="input" type="password" value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      required minLength={10} placeholder="Minimum 10 characters"
                      autoComplete="new-password" />
                  </div>
                </div>
                <div className="field">
                  <label className="label" htmlFor="pw-confirm">Confirm New Password</label>
                  <div className="input-group">
                    <Icon name="key" />
                    <input id="pw-confirm" className="input" type="password" value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      required minLength={10} placeholder="Repeat new password"
                      autoComplete="new-password" />
                  </div>
                  {confirmPassword && (
                    <div className="help" style={{ color: confirmPassword === newPassword ? 'var(--success)' : 'var(--danger)' }}>
                      {confirmPassword === newPassword ? 'Passwords match' : 'Passwords do not match'}
                    </div>
                  )}
                </div>
              </div>
              <StrengthMeter
                password={newPassword}
                personalWords={[person?.name, ...(person?.name || '').split(/\s+/), (person?.email || '').split('@')[0]]}
              />
            </div>
            <div className="card-footer" style={footerStyle}>
              <button type="submit" className="btn btn-primary" disabled={pwLoading}>
                {pwLoading ? 'Updating…' : 'Update Password'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
