(() => {
  'use strict';
  const form = document.getElementById('verify-email-form') || document.getElementById('reset-password-form');
  if (!form) return;

  const verify = form.id === 'verify-email-form';
  const status = document.getElementById(verify ? 'verify-email-status' : 'reset-password-status');
  const submit = form.querySelector('button[type="submit"]');
  const apiBase = document.querySelector('meta[name="glasschat-api-base"]')?.content?.trim() || '';
  const token = new URLSearchParams(window.location.hash.slice(1)).get('token') || '';
  let addressBarTokenCleared = false;

  function setStatus(message, state = 'info') {
    if (status) {
      status.textContent = message;
      status.dataset.state = state;
    }
  }
  function clearTokenFromAddressBar() {
    if (addressBarTokenCleared) return;
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    addressBarTokenCleared = true;
  }
  if (!token) {
    if (submit) submit.disabled = true;
    setStatus('This link is missing, expired, or already used. Request a fresh link from the GlassChat desktop app.', 'error');
    return;
  }
  if (!apiBase) {
    if (submit) submit.disabled = true;
    setStatus('The GlassChat account service is not configured for this page yet. Do not share this link; contact support or request another link later.', 'error');
    return;
  }

  async function post(route, payload) {
    const response = await fetch(new URL(`/api/auth${route}`, apiBase), {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data.error === 'INVALID_OR_EXPIRED_TOKEN' || data.error === 'INVALID_OR_EXPIRED_TOKEN_OR_PASSWORD'
        ? 'This link is expired or already used. Request a fresh link from the GlassChat desktop app.'
        : 'The request could not be completed. Try again, or contact support if the problem continues.';
      throw new Error(message);
    }
    return data;
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    if (verify) {
      clearTokenFromAddressBar();
      if (submit) submit.disabled = true;
      setStatus('Verifying your email…');
      try {
        await post('/verify-email', { token });
        setStatus('Email verified. Return to the GlassChat desktop app and sign in.', 'success');
      } catch (error) {
        if (submit) submit.disabled = false;
        setStatus(error.message || 'The request could not be completed. Try again.', 'error');
      }
      return;
    }

    const password = document.getElementById('new-password')?.value || '';
    const confirmation = document.getElementById('confirm-password')?.value || '';
    if (password !== confirmation) {
      setStatus('The passwords do not match.', 'error');
      return;
    }
    if (Array.from(password).length < 12 || Array.from(password).length > 128 || new TextEncoder().encode(password).length > 512) {
      setStatus('Use a password between 12 and 128 characters.', 'error');
      return;
    }

    clearTokenFromAddressBar();
    if (submit) submit.disabled = true;
    setStatus('Resetting your password…');
    try {
      await post('/password/reset', { token, password });
      form.reset();
      setStatus('Password reset. Return to the GlassChat desktop app and sign in with your new password.', 'success');
    } catch (error) {
      if (submit) submit.disabled = false;
      setStatus(error.message || 'The request could not be completed. Try again.', 'error');
    }
  });
})();
