import { useState } from 'react';
import { supabase } from '../lib/data/store';

type Mode = 'signin' | 'signup' | 'reset';

export function AuthScreen() {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const sb = supabase();
    if (!sb) return;
    setBusy(true);
    setMessage(null);
    try {
      if (mode === 'signin') {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === 'signup') {
        const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: window.location.href.split('#')[0] } });
        if (error) throw error;
        if (!data.session) setMessage({ text: 'Check your email and tap the confirmation link, then sign in here.', error: false });
      } else {
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.href.split('#')[0] });
        if (error) throw error;
        setMessage({ text: 'If that email has an account, a reset link is on its way.', error: false });
      }
    } catch (err) {
      setMessage({ text: (err as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>
          <span className="logo">⌖</span> Hunt Forecast
        </h1>
      </header>
      <div className="intro">
        <h2>{mode === 'signup' ? 'Create your account' : mode === 'reset' ? 'Reset your password' : 'Sign in'}</h2>
        <p>Your hunting places, stands, trail cameras, and target bucks are saved to your account and sync across your devices.</p>
      </div>
      <form className="card auth" onSubmit={submit}>
        <label className="field">
          <span>Email</span>
          <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {mode !== 'reset' && (
          <label className="field">
            <span>Password</span>
            <input
              className="input"
              type="password"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              minLength={8}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {mode === 'signup' && <span className="small muted">At least 8 characters.</span>}
          </label>
        )}
        <button className="btn primary block" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : mode === 'reset' ? 'Send reset link' : 'Sign in'}
        </button>
        {message && <p className={message.error ? 'error' : 'small'}>{message.text}</p>}
        <div className="auth-links">
          {mode !== 'signin' && (
            <button type="button" className="link" onClick={() => setMode('signin')}>
              Have an account? Sign in
            </button>
          )}
          {mode !== 'signup' && (
            <button type="button" className="link" onClick={() => setMode('signup')}>
              New here? Create an account
            </button>
          )}
          {mode === 'signin' && (
            <button type="button" className="link" onClick={() => setMode('reset')}>
              Forgot password?
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

/** Shown after following a password-reset email link. */
export function NewPasswordForm({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="card auth"
      onSubmit={async (e) => {
        e.preventDefault();
        const { error } = (await supabase()?.auth.updateUser({ password })) ?? { error: null };
        if (error) setError(error.message);
        else onDone();
      }}
    >
      <h3>Choose a new password</h3>
      <input className="input" type="password" minLength={8} required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <button className="btn primary block">Save password</button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
