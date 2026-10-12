/* Modal de autenticación del modo invitado de ByGether.
   Usa el cliente Supabase existente; no crea tablas ni objetos nuevos. */
(function () {
  'use strict';

  const ALLOWED_GUEST_INTERACTIONS = Object.freeze([
    '#guestAuthGoogle',
    '#guestAuthLogin',
    '#guestAuthSignup',
    '#guestAuthModal',
    '#guestAuthModal *'
  ]);
  const MODAL_ID = 'guestAuthModal';
  let mode = 'signup';
  let signupStep = 1;
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
    signupStep = 1;
    const modal = getModal();
    if (!modal) return;
    const signup = mode === 'signup';
    modal.querySelector('[data-auth-title]').textContent = signup ? 'Regístrate' : 'Inicia sesión';
    modal.querySelector('[data-auth-title]').classList.remove('pl-8');
    modal.querySelector('[data-auth-google]').classList.remove('hidden');
    modal.querySelector('[data-auth-terms]').classList.remove('hidden');
    modal.querySelector('[data-auth-step1]').classList.toggle('hidden', !signup);
    modal.querySelector('[data-auth-step2]').classList.add('hidden');
    modal.querySelector('[data-auth-step3]').classList.add('hidden');
    modal.querySelector('[data-auth-login-fields]').classList.toggle('hidden', signup);
    modal.querySelector('[data-auth-divider]').classList.remove('hidden');
    modal.querySelector('[data-auth-back]').classList.add('hidden');
    modal.querySelector('[data-auth-switch]').classList.remove('hidden');
    modal.querySelector('[data-auth-switch]').innerHTML = signup
      ? '¿Ya eres ByGer? <button type="button" data-switch-auth="login" class="font-semibold text-blue-400 hover:text-blue-300 underline underline-offset-2">Inicia sesión</button>'
      : '¿No tienes cuenta? <button type="button" data-switch-auth="signup" class="font-semibold text-blue-400 hover:text-blue-300 underline underline-offset-2">Regístrate</button>';
    modal.querySelector('[data-auth-error]').textContent = '';
    modal.querySelector('[data-auth-login-error]').textContent = '';
    modal.querySelector('#guestAuthLoginEmail').required = !signup;
    modal.querySelector('#guestAuthLoginPassword').required = !signup;
    modal.querySelector('#guestAuthLoginPassword').autocomplete = 'current-password';
    modal.querySelector('[data-auth-submit]').textContent = 'Iniciar sesión';
    updateSignupButtons();
  }

  function open(nextMode) {
    const modal = getModal();
    if (!modal) return;
    setMode(nextMode);
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.body.style.overflow = 'hidden';
    window.setTimeout(() => {
      const isMobile = window.matchMedia('(pointer: coarse)').matches;
      if (isMobile) return;
      const field = modal.querySelector(mode === 'signup' ? '#guestAuthEmail' : '#guestAuthLoginEmail');
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

  function updateSignupButtons() {
    const modal = getModal();
    if (!modal) return;
    const email = modal.querySelector('#guestAuthEmail');
    const username = modal.querySelector('#guestAuthName');
    const password = modal.querySelector('#guestAuthPassword');
    const first = modal.querySelector('[data-auth-step1-submit]');
    const second = modal.querySelector('[data-auth-step2-submit]');
    if (first) {
      first.disabled = !email.value.trim();
      first.classList.toggle('opacity-40', first.disabled);
      first.classList.toggle('cursor-not-allowed', first.disabled);
    }
    if (second) {
      second.disabled = !username.value.trim() || !password.value;
      second.classList.toggle('opacity-40', second.disabled);
      second.classList.toggle('cursor-not-allowed', second.disabled);
    }
  }

  function showSignupStep(step) {
    signupStep = step;
    const modal = getModal();
    if (!modal) return;
    modal.querySelector('[data-auth-title]').textContent =
      step === 1 ? 'Regístrate' : step === 2 ? 'Crea tu nombre de usuario y contraseña' : 'Verifica tu correo';
    modal.querySelector('[data-auth-title]').classList.toggle('pl-8', step === 2);
    modal.querySelector('[data-auth-google]').classList.toggle('hidden', step !== 1);
    modal.querySelector('[data-auth-terms]').classList.toggle('hidden', step !== 1);
    modal.querySelector('[data-auth-divider]').classList.toggle('hidden', step !== 1);
    modal.querySelector('[data-auth-step1]').classList.toggle('hidden', step !== 1);
    modal.querySelector('[data-auth-step2]').classList.toggle('hidden', step !== 2);
    modal.querySelector('[data-auth-step3]').classList.toggle('hidden', step !== 3);
    modal.querySelector('[data-auth-back]').classList.toggle('hidden', step !== 2);
    modal.querySelector('[data-auth-switch]').classList.toggle('hidden', step === 3);
    modal.querySelector('[data-auth-error]').textContent = '';
    modal.querySelector('[data-auth-step2-error]').textContent = '';
    updateSignupButtons();
    if (step === 2) modal.querySelector('#guestAuthName').focus({preventScroll:true});
  }

  async function submitAuth(event) {
    event.preventDefault();
    if (busy) return;
    const modal = getModal();
    const name = modal.querySelector('#guestAuthName').value.trim();
    const email = (mode === 'login' ? modal.querySelector('#guestAuthLoginEmail') : modal.querySelector('#guestAuthEmail')).value.trim();
    const password = (mode === 'login' ? modal.querySelector('#guestAuthLoginPassword') : modal.querySelector('#guestAuthPassword')).value;
    const submit = mode === 'signup'
      ? modal.querySelector(signupStep === 1 ? '[data-auth-step1-submit]' : '[data-auth-step2-submit]')
      : modal.querySelector('[data-auth-submit]');
    const errorBox = modal.querySelector(mode === 'login' ? '[data-auth-login-error]' : (signupStep === 2 ? '[data-auth-step2-error]' : '[data-auth-error]'));
    errorBox.textContent = '';

    if (mode === 'signup' && signupStep === 1) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errorBox.textContent = 'Escribe un correo electrónico válido.';
        modal.querySelector('#guestAuthEmail').focus();
        return;
      }
      showSignupStep(2);
      return;
    }
    if (mode === 'signup' && signupStep === 2 && password.length < 6) {
      errorBox.textContent = 'La contraseña debe tener al menos 6 caracteres.';
      modal.querySelector('#guestAuthPassword').focus();
      return;
    }

    busy = true;
    if (submit) { submit.disabled = true; submit.textContent = 'Procesando…'; }
    try {
      await window.byGetherAuthReady;
      if (mode === 'signup') {
        const { data, error } = await window.ByGetherAuth.signUp(supabaseClient, {
          name, email, password,
          redirectTo: window.location.origin + '/dashboard.html'
        });
        if (error) throw error;
        if (data && data.session) {
          window.location.replace('dashboard.html');
          return;
        }
        modal.querySelector('[data-auth-confirm-email]').textContent =
          'Te enviamos un enlace de confirmación a ' + email + '. Ábrelo para activar tu cuenta y luego inicia sesión.';
        showSignupStep(3);
      } else {
        const { error } = await window.ByGetherAuth.signIn(supabaseClient, { email, password });
        if (error) throw error;
        window.location.replace('dashboard.html');
        return;
      }
    } catch (error) {
      errorBox.textContent = error && error.message ? error.message : 'No se pudo completar la operación. Inténtalo de nuevo.';
    } finally {
      busy = false;
      if (submit && isOpen()) {
        submit.textContent = mode === 'signup' ? 'Continuar' : 'Iniciar sesión';
        updateSignupButtons();
        if (mode === 'login') submit.disabled = false;
      }
    }
  }

  async function googleAuth() {
    const errorBox = getModal()?.querySelector('[data-auth-error]');
    if (errorBox) errorBox.textContent = '';
    try {
      await window.byGetherAuthReady;
      const { error } = await window.ByGetherAuth.google(supabaseClient, window.location.origin + '/dashboard.html');
      if (error) throw error;
    } catch (error) {
      const message = error && error.message ? error.message : 'No se pudo iniciar sesión con Google.';
      if (errorBox) errorBox.textContent = message;
      else window.alert(message);
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
        <button type="button" data-auth-back aria-label="Volver al paso anterior" class="hidden absolute left-4 top-3 rounded-lg p-1 text-xl leading-none text-slate-400 hover:bg-slate-800 hover:text-white">←</button>
        <h2 id="guestAuthTitle" data-auth-title class="pr-9 text-2xl font-bold tracking-tight">Regístrate</h2>
        <p data-auth-terms class="mt-3 text-sm leading-6 text-slate-400">Al continuar, aceptas nuestros <a class="text-slate-200 underline underline-offset-2 hover:text-white" href="terminos.html?lang=es" target="_blank" rel="noopener noreferrer">Términos</a> y confirmas que has entendido la <a class="text-slate-200 underline underline-offset-2 hover:text-white" href="privacidad.html?lang=es" target="_blank" rel="noopener noreferrer">Política de privacidad</a>.</p>
        <button type="button" data-auth-google class="mt-5 flex min-h-12 w-full items-center justify-center gap-3 rounded-full border border-slate-300 bg-white px-4 py-3 font-semibold text-slate-900 transition hover:bg-slate-100">
          <svg class="h-5 w-5 flex-none" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.35 12.23c0-.79-.07-1.56-.22-2.29H12v4.34h5.23a4.47 4.47 0 0 1-1.94 2.93v2.43h3.14c1.84-1.69 2.92-4.18 2.92-7.41z"/><path fill="#34A853" d="M12 21.6c2.63 0 4.84-.87 6.45-2.36l-3.14-2.43c-.87.58-1.98.92-3.31.92-2.54 0-4.69-1.72-5.46-4.03H3.29v2.51A9.75 9.75 0 0 0 12 21.6z"/><path fill="#FBBC05" d="M6.54 13.7A5.86 5.86 0 0 1 6.23 12c0-.59.1-1.17.31-1.7V7.79H3.29A9.75 9.75 0 0 0 2.25 12c0 1.57.38 3.05 1.04 4.21l3.25-2.51z"/><path fill="#EA4335" d="M12 6.27c1.43 0 2.71.49 3.72 1.46l2.79-2.79C16.84 3.29 14.63 2.4 12 2.4a9.75 9.75 0 0 0-8.71 5.39l3.25 2.51C7.31 7.99 9.46 6.27 12 6.27z"/></svg>
          Continuar con Google
        </button>
        <div data-auth-divider class="my-4 flex items-center gap-3 text-xs font-semibold uppercase tracking-widest text-slate-500"><span class="h-px flex-1 bg-slate-800"></span><span>o</span><span class="h-px flex-1 bg-slate-800"></span></div>
        <form data-auth-form class="space-y-3">
          <div data-auth-step1>
            <label class="block"><span class="mb-1.5 block text-sm text-slate-300">Correo electrónico</span><input id="guestAuthEmail" type="email" autocomplete="email" class="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base text-white outline-none transition placeholder:text-slate-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20" placeholder="Correo electrónico"></label>
            <p data-auth-error role="alert" aria-live="polite" class="mt-1 min-h-0 text-sm text-red-400"></p>
            <button data-auth-step1-submit type="button" class="mt-3 w-full rounded-xl bg-emerald-600 px-4 py-3 font-bold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40">Continuar</button>
          </div>
          <div data-auth-step2 class="hidden space-y-3">
            <label class="block"><span class="mb-1.5 block text-sm text-slate-300">Nombre de usuario</span><input id="guestAuthName" type="text" autocomplete="username" class="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base text-white outline-none transition placeholder:text-slate-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20" placeholder="Nombre de usuario"></label>
            <label class="block"><span class="mb-1.5 block text-sm text-slate-300">Contraseña</span><span class="relative block"><input id="guestAuthPassword" type="password" autocomplete="new-password" class="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 pr-12 text-base text-white outline-none transition placeholder:text-slate-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20" placeholder="Contraseña"><button type="button" data-auth-toggle-password aria-label="Mostrar contraseña" class="absolute inset-y-0 right-2 flex items-center justify-center rounded-md px-2 text-slate-400 hover:text-white"><svg data-eye-open class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg><svg data-eye-closed class="hidden h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.1 3.8M6.2 6.2C3.5 8 2 12 2 12s3.5 7 10 7c1.5 0 2.8-.4 4-1"/></svg></button></span></label>
            <p data-auth-step2-error role="alert" aria-live="polite" class="min-h-0 text-sm text-red-400"></p>
            <button data-auth-step2-submit type="submit" class="w-full rounded-xl bg-emerald-600 px-4 py-3 font-bold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40">Continuar</button>
          </div>
          <div data-auth-step3 class="hidden"><p data-auth-confirm-email class="mt-3 text-sm leading-6 text-slate-300"></p></div>
          <div data-auth-login-fields class="hidden space-y-3">
            <label class="block"><span class="mb-1.5 block text-sm text-slate-300">Correo electrónico</span><input id="guestAuthLoginEmail" type="email" autocomplete="email" class="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base text-white outline-none transition placeholder:text-slate-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20" placeholder="Email address"></label>
            <label class="block"><span class="mb-1.5 block text-sm text-slate-300">Contraseña</span><input id="guestAuthLoginPassword" type="password" autocomplete="current-password" class="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base text-white outline-none transition placeholder:text-slate-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20" placeholder="Tu contraseña"></label>
            <p data-auth-login-error role="alert" aria-live="polite" class="min-h-0 text-sm text-red-400"></p>
            <button data-auth-submit type="submit" class="w-full rounded-xl bg-blue-600 px-4 py-3 font-bold text-white transition hover:bg-blue-500 disabled:cursor-wait disabled:opacity-60">Iniciar sesión</button>
          </div>
        </form>
        <p data-auth-switch class="mt-5 text-center text-sm text-slate-400">¿Ya eres ByGer? <button type="button" data-switch-auth="login" class="font-semibold text-blue-400 underline underline-offset-2">Inicia sesión</button></p>
      </section>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', event => { if (event.target === modal) close(); });
    modal.querySelector('[data-auth-close]').addEventListener('click', close);
    modal.querySelector('[data-auth-back]').addEventListener('click', () => showSignupStep(1));
    modal.querySelector('[data-auth-google]').addEventListener('click', googleAuth);
    modal.querySelector('[data-auth-form]').addEventListener('submit', submitAuth);
    modal.querySelector('[data-auth-step1-submit]').addEventListener('click', submitAuth);
    modal.querySelector('[data-auth-toggle-password]').addEventListener('click', () => {
      const input = modal.querySelector('#guestAuthPassword');
      const visible = input.type === 'password';
      input.type = visible ? 'text' : 'password';
      modal.querySelector('[data-eye-open]').classList.toggle('hidden', visible);
      modal.querySelector('[data-eye-closed]').classList.toggle('hidden', !visible);
      modal.querySelector('[data-auth-toggle-password]').setAttribute('aria-label', visible ? 'Ocultar contraseña' : 'Mostrar contraseña');
    });
    modal.querySelector('[data-auth-switch]').addEventListener('click', event => {
      const button = event.target.closest('[data-switch-auth]');
      if (button) setMode(button.dataset.switchAuth);
    });
    ['#guestAuthEmail','#guestAuthName','#guestAuthPassword'].forEach(selector => {
      modal.querySelector(selector).addEventListener('input', () => {
        modal.querySelector('[data-auth-error]').textContent = '';
        modal.querySelector('[data-auth-step2-error]').textContent = '';
        updateSignupButtons();
      });
    });
  }

  function attachHeaderButtons() {
    const actions = document.getElementById('guestAuthActions');
    if (!actions) return;
    const google = actions.querySelector('#guestAuthGoogle');
    const login = actions.querySelector('#guestAuthLogin');
    const signup = actions.querySelector('#guestAuthSignup');
    if (google) {
      google.href = '#';
      google.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        googleAuth();
      });
    }
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