/* Métodos compartidos de autenticación ByGether: landing y modal invitado. */
(function () {
  'use strict';
  const TERMS_VERSION = '2026-10-02';
  window.ByGetherAuth = Object.freeze({
    google(client, redirectTo) {
      return client.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: redirectTo || (window.location.origin + '/dashboard.html') }
      });
    },
    signUp(client, { name, email, password, redirectTo, username }) {
      return client.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: name,
            username,
            terms_version: TERMS_VERSION,
            terms_accepted_at: new Date().toISOString()
          },
          emailRedirectTo: redirectTo || (window.location.origin + '/dashboard.html')
        }
      });
    },
    async usernameAvailable(client, username) {
      const value = String(username || '').trim().toLowerCase();
      if (!/^[a-z0-9_]{3,20}$/.test(value)) return false;
      const { data, error } = await client.rpc('username_disponible', { p_username: value });
      return !error && data === true;
    },
    signIn(client, { email, password }) {
      return client.auth.signInWithPassword({ email, password });
    },
    recover(client, { email, redirectTo }) {
      return client.auth.resetPasswordForEmail(email, {
        redirectTo: redirectTo || (window.location.origin + '/reset-password.html')
      });
    }
  });
  if (!window.byGetherAuthReady) window.byGetherAuthReady = Promise.resolve();
})();