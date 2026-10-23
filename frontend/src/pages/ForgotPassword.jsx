import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../lib/api.js';
import Icon from '../components/Icon.jsx';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await apiFetch('/api/auth/forgot-password', {
        method: 'POST',
        body: { email },
      });
    } catch {
      // Always show success regardless of result
    } finally {
      setLoading(false);
      setSubmitted(true);
    }
  };

  return (
    <div className="auth">
      <div className="card auth-card">
        <div className="auth-brand">
          <img src="/logo.png" alt="Mako IT Lab" className="brand-mark" /> ProjectDelivery
        </div>
        <h1 className="auth-title">Forgot password</h1>
        <p className="auth-subtitle">Enter your email and we&apos;ll send a reset link.</p>

        {submitted ? (
          <div className="alert alert-success" role="status">
            <Icon name="checkCircle" />
            <div>
              <div className="fw-600">Check your email!</div>
              If an account exists for <strong>{email}</strong>, you will receive a password reset link shortly.
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label className="label" htmlFor="forgot-email">Email address</label>
              <div className="input-group">
                <Icon name="mail" />
                <input
                  id="forgot-email"
                  className="input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  autoFocus
                />
              </div>
            </div>
            <button type="submit" className="btn btn-primary btn-lg btn-block mt-8" disabled={loading}>
              {loading ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
        )}

        <div className="auth-footer">
          <Link to="/login" className="row" style={{ display: 'inline-flex', gap: 4 }}>
            <Icon name="chevronLeft" size={14} /> Back to login
          </Link>
        </div>
      </div>
    </div>
  );
}
