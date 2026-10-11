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
    signUp(client, { name, email, password, redirectTo }) {
      return client.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: name,
            terms_version: TERMS_VERSION,
            terms_accepted_at: new Date().toISOString()
          },
          emailRedirectTo: redirectTo || (window.location.origin + '/dashboard.html')
        }
      });
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