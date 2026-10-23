import React, { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api.js';
import Icon from '../components/Icon.jsx';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const tokenHash = params.get('token_hash') || '';

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (newPassword.length < 10) {
      setError('Password must be at least 10 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (!tokenHash) {
      setError('Invalid or missing reset token. Please request a new link.');
      return;
    }

    setLoading(true);
    try {
      await apiFetch('/api/auth/reset-password', {
        method: 'POST',
        body: { token_hash: tokenHash, password: newPassword },
      });
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err.error || 'Failed to reset password. The link may be expired.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth">
      <div className="card auth-card">
        <div className="auth-brand">
          <img src="/logo.png" alt="Mako IT Lab" className="brand-mark" /> ProjectDelivery
        </div>
        <h1 className="auth-title">Reset password</h1>
        <p className="auth-subtitle">Enter your new password below.</p>

        {!tokenHash && (
          <div className="alert alert-error" role="alert">
            <Icon name="alert" />
            <span>Invalid reset link. Please request a new password reset.</span>
          </div>
        )}

        {error && (
          <div className="alert alert-error" role="alert">
            <Icon name="alert" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label className="label" htmlFor="reset-new">New password</label>
            <div className="input-group">
              <Icon name="lock" />
              <input
                id="reset-new"
                className="input"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Minimum 10 characters"
                required
                minLength={10}
                autoFocus
              />
            </div>
          </div>
          <div className="field">
            <label className="label" htmlFor="reset-confirm">Confirm new password</label>
            <div className="input-group">
              <Icon name="key" />
              <input
                id="reset-confirm"
                className="input"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat new password"
                required
                minLength={10}
              />
            </div>
          </div>
          <button type="submit" className="btn btn-primary btn-lg btn-block mt-8" disabled={loading || !tokenHash}>
            {loading ? 'Resetting…' : 'Reset password'}
          </button>
        </form>
      </div>
    </div>
  );
}
