/* Modal de autenticación del modo invitado de ByGether.
   Usa el cliente Supabase existente; no crea tablas ni objetos nuevos. */
(function () {
  'use strict';

  const ALLOWED_GUEST_INTERACTIONS = Object.freeze([
    '#guestAuthLogin',
    '#guestAuthSignup',
    '#guestAuthModal',
    '#guestAuthModal *'
  ]);
  const MODAL_ID = 'guestAuthModal';
  let mode = 'signup';
  let busy = false;

  function allowedSelector() {
    return ALLOWED_GUEST_INTERACTIONS.join(',');
  }

  function getModal() { return document.getElementById(MODAL_ID); }
  function isOpen() {
    const modal = getModal();
    return !!modal && !modal.classList.contains('hidden');
  }
  function isGuestWithoutSession() {
    return !!window.byGetherGuestMode && !window.currentUser;
  }
  function isInteractive(el) {
    if (!(el instanceof Element)) return false;
    return !!el.closest('a,button,input,textarea,select,summary,[role="button"],[role="link"],[tabindex], [onclick],label');
  }
  function isAllowed(el) {
    if (!(el instanceof Element)) return false;
    return !!el.closest(allowedSelector());
  }
  function stopEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
  }

  function setMode(nextMode) {
    mode = nextMode === 'login' ? 'login' : 'signup';
    const modal = getModal();
    if (!modal) return;
    const signup = mode === 'signup';
    modal.querySelector('[data-auth-title]').textContent = signup ? 'Regístrate' : 'Inicia sesión';
    modal.querySelector('[data-auth-submit]').textContent = signup ? 'Continuar' : 'Iniciar sesión';
    modal.querySelector('[data-auth-name-wrap]').classList.toggle('hidden', !signup);
    const name = modal.querySelector('#guestAuthName');
    name.required = signup;
    modal.querySelector('[data-auth-switch]').innerHTML = signup
      ? '¿Ya eres ByGer? <button type="button" data-switch-auth="login" class="font-semibold text-blue-400 hover:text-blue-300 underline underline-offset-2">Inicia sesión</button>'
      : '¿No tienes cuenta? <button type="button" data-switch-auth="signup" class="font-semibold text-blue-400 hover:text-blue-300 underline underline-offset-2">Regístrate</button>';
    modal.querySelector('[data-auth-error]').textContent = '';
    modal.querySelector('#guestAuthPassword').autocomplete = signup ? 'new-password' : 'current-password';
  }

  function open(nextMode) {
    const modal = getModal();
    if (!modal) return;
    setMode(nextMode);
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.body.style.overflow = 'hidden';
    window.setTimeout(() => {
      const field = modal.querySelector(mode === 'signup' ? '#guestAuthName' : '#guestAuthEmail');
      field && field.focus({ preventScroll: true });
    }, 0);
  }
  function close() {
    const modal = getModal();
    if (!modal) return;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    document.body.style.overflow = '';
  }

  async function submitAuth(event) {
    event.preventDefault();
    if (busy) return;
    const modal = getModal();
    const name = modal.querySelector('#guestAuthName').value.trim();
    const email = modal.querySelector('#guestAuthEmail').value.trim();
    const password = modal.querySelector('#guestAuthPassword').value;
    const submit = modal.querySelector('[data-auth-submit]');
    const errorBox = modal.querySelector('[data-auth-error]');
    errorBox.textContent = '';
    busy = true;
    submit.disabled = true;
    submit.textContent = 'Procesando…';
    try {
      if (mode === 'signup') {
        await window.byGetherAuthReady;
        const { data, error } = await window.ByGetherAuth.signUp(supabaseClient, {
          name, email, password,
          redirectTo: window.location.origin + '/dashboard.html'
        });
        if (error) throw error;
        if (data && data.session) {
          window.location.replace('dashboard.html');
          return;
        }
        errorBox.textContent = 'Registro iniciado. Revisa tu correo y confirma la cuenta para poder entrar.';
      } else {
        await window.byGetherAuthReady;
        const { error } = await window.ByGetherAuth.signIn(supabaseClient, { email, password });
        if (error) throw error;
        window.location.replace('dashboard.html');
        return;
      }
    } catch (error) {
      errorBox.textContent = error && error.message ? error.message : 'No se pudo completar la operación. Inténtalo de nuevo.';
    } finally {
      busy = false;
      submit.disabled = false;
      submit.textContent = mode === 'signup' ? 'Continuar' : 'Iniciar sesión';
    }
  }

  async function googleAuth() {
    const errorBox = getModal().querySelector('[data-auth-error]');
    errorBox.textContent = '';
    try {
      await window.byGetherAuthReady;
      const { error } = await window.ByGetherAuth.google(supabaseClient, window.location.origin + '/dashboard.html');
      if (error) throw error;
    } catch (error) {
      errorBox.textContent = error && error.message ? error.message : 'No se pudo iniciar sesión con Google.';
    }
  }

  function installGuard() {
    // El listener es global, único y en captura. Solo actúa cuando init()
    // confirmó que se está viendo el muro invitado sin una sesión.
    document.addEventListener('click', function (event) {
      if (!isGuestWithoutSession() || isAllowed(event.target)) {
        if (isGuestWithoutSession() && event.target.closest && event.target.closest('#guestAuthLogin')) {
          stopEvent(event); open('login');
        } else if (isGuestWithoutSession() && event.target.closest && event.target.closest('#guestAuthSignup')) {
          stopEvent(event); open('signup');
        }
        return;
      }
      if (!isInteractive(event.target)) return;
      stopEvent(event);
      open('signup');
    }, true);

    document.addEventListener('keydown', function (event) {
      if (!isGuestWithoutSession()) return;
      if (event.key === 'Escape' && isOpen()) {
        stopEvent(event); close(); return;
      }
      if ((event.key === 'Enter' || event.key === ' ') && isInteractive(event.target) && !isAllowed(event.target)) {
        stopEvent(event); open('signup');
      }
    }, true);

    document.addEventListener('focusin', function (event) {
      if (!isGuestWithoutSession() || isAllowed(event.target) || !isInteractive(event.target)) return;
      stopEvent(event);
      open('signup');
    }, true);
  }

  function buildModal() {
    if (getModal()) return;
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.className = 'hidden fixed inset-0 z-[250] items-center justify-center bg-black/75 backdrop-blur-sm p-3 sm:p-5 overflow-y-auto';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'guestAuthTitle');
    modal.innerHTML = `
      <section class="relative my-auto w-full max-w-md rounded-2xl border border-slate-700 bg-slate-950 text-slate-100 shadow-2xl p-5 sm:p-7">
        <button type="button" data-auth-close aria-label="Cerrar" class="absolute right-4 top-3 rounded-lg p-1 text-2xl leading-none text-slate-400 hover:bg-slate-800 hover:text-white">&times;</button>
        <h2 id="guestAuthTitle" data-auth-title class="pr-9 text-2xl font-bold tracking-tight">Regístrate</h2>
        <p class="mt-3 text-sm leading-6 text-slate-400">Al continuar, aceptas nuestros <a class="text-slate-200 underline underline-offset-2 hover:text-white" href="/terminos.html?lang=es" target="_blank" rel="noopener">Términos</a> y confirmas que has entendido la <a class="text-slate-200 underline underline-offset-2 hover:text-white" href="/privacidad.html?lang=es" target="_blank" rel="noopener">Política de privacidad</a>.</p>
        <button type="button" data-auth-google class="mt-5 flex min-h-12 w-full items-center justify-center gap-3 rounded-full border border-slate-300 bg-white px-4 py-3 font-semibold text-slate-900 transition hover:bg-slate-100">
          <svg class="h-5 w-5 flex-none" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.35 12.23c0-.79-.07-1.56-.22-2.29H12v4.34h5.23a4.47 4.47 0 0 1-1.94 2.93v2.43h3.14c1.84-1.69 2.92-4.18 2.92-7.41z"/><path fill="#34A853" d="M12 21.6c2.63 0 4.84-.87 6.45-2.36l-3.14-2.43c-.87.58-1.98.92-3.31.92-2.54 0-4.69-1.72-5.46-4.03H3.29v2.51A9.75 9.75 0 0 0 12 21.6z"/><path fill="#FBBC05" d="M6.54 13.7A5.86 5.86 0 0 1 6.23 12c0-.59.1-1.17.31-1.7V7.79H3.29A9.75 9.75 0 0 0 2.25 12c0 1.57.38 3.05 1.04 4.21l3.25-2.51z"/><path fill="#EA4335" d="M12 6.27c1.43 0 2.71.49 3.72 1.46l2.79-2.79C16.84 3.29 14.63 2.4 12 2.4a9.75 9.75 0 0 0-8.71 5.39l3.25 2.51C7.31 7.99 9.46 6.27 12 6.27z"/></svg>
          Continuar con Google
        </button>
        <div class="my-4 flex items-center gap-3 text-xs font-semibold uppercase tracking-widest text-slate-500"><span class="h-px flex-1 bg-slate-800"></span><span>O</span><span class="h-px flex-1 bg-slate-800"></span></div>
        <form data-auth-form class="space-y-3">
          <label data-auth-name-wrap class="block"><span class="mb-1.5 block text-sm text-slate-300">Nombre</span><input id="guestAuthName" type="text" autocomplete="name" required class="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base text-white outline-none transition placeholder:text-slate-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20" placeholder="Tu nombre"></label>
          <label class="block"><span class="mb-1.5 block text-sm text-slate-300">Correo electrónico</span><input id="guestAuthEmail" type="email" autocomplete="email" required class="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base text-white outline-none transition placeholder:text-slate-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20" placeholder="Email address"></label>
          <label class="block"><span class="mb-1.5 block text-sm text-slate-300">Contraseña</span><input id="guestAuthPassword" type="password" autocomplete="new-password" required minlength="6" class="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base text-white outline-none transition placeholder:text-slate-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20" placeholder="Tu contraseña"></label>
          <p data-auth-error role="alert" aria-live="polite" class="min-h-0 text-sm text-red-400"></p>
          <button data-auth-submit type="submit" class="w-full rounded-xl bg-blue-600 px-4 py-3 font-bold text-white transition hover:bg-blue-500 disabled:cursor-wait disabled:opacity-60">Continuar</button>
        </form>
        <p data-auth-switch class="mt-5 text-center text-sm text-slate-400">¿Ya eres ByGer? <button type="button" data-switch-auth="login" class="font-semibold text-blue-400 underline underline-offset-2">Inicia sesión</button></p>
      </section>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', event => {
      if (event.target === modal) close();
    });
    modal.querySelector('[data-auth-close]').addEventListener('click', close);
    modal.querySelector('[data-auth-google]').addEventListener('click', googleAuth);
    modal.querySelector('[data-auth-form]').addEventListener('submit', submitAuth);
    modal.querySelector('[data-auth-switch]').addEventListener('click', event => {
      const button = event.target.closest('[data-switch-auth]');
      if (button) setMode(button.dataset.switchAuth);
    });
  }

  function attachHeaderButtons() {
    const actions = document.getElementById('guestAuthActions');
    if (!actions) return;
    const login = actions.querySelector('#guestAuthLogin');
    const signup = actions.querySelector('#guestAuthSignup');
    if (login) login.href = '#';
    if (signup) signup.href = '#';
  }

  function start() {
    buildModal();
    attachHeaderButtons();
    installGuard();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();

  window.byGetherGuestAuth = { open, close, setMode, allowedInteractions: ALLOWED_GUEST_INTERACTIONS };
})();