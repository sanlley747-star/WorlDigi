// ===== NAVEGACIÓN MÓVIL DE BYGETHER =====
// En pantallas menores a 1024 px (donde el menú lateral está oculto):
//  1) Al presionar el logo de ByGether del header se expande, desde la derecha,
//     un panel a pantalla completa con el avatar y el nombre del usuario y todas
//     las herramientas (Inicio, Mi perfil, Notificaciones, Conexiones, Ajustes, Publicar).
//     Se cierra con la X (arriba a la derecha) o con Escape, y colapsa hacia la derecha.
//  2) Botón flotante azul de "Publicar": se vuelve semitransparente al bajar el
//     scroll y totalmente visible al subirlo. Funciona en ambos estados.
// En computadora (>= 1024 px) no se muestra nada de esto y el logo sigue siendo un enlace normal.
// Se carga al final del <body>; usa `supabaseClient` si la página ya lo definió.

(function () {
  'use strict';

  var mq = window.matchMedia('(max-width: 1023px)');

  // ---------- Estilos ----------
  var css = [
    '.gm-panel,.gm-fab,.gm-bottom{display:none}',
    '@media (max-width:1023px){',
    '  .gm-panel{display:flex;flex-direction:column;position:fixed;top:0;right:0;bottom:0;left:0;height:100vh;height:100dvh;z-index:100;',
    '    background:#020617;color:#e5e7eb;overflow:hidden;transform:translateX(100%);visibility:hidden;',
    '    transition:transform .3s ease,visibility 0s linear .3s}',
    '  html:not(.dark) .gm-panel{background:#ffffff;color:#111827}',
    '  .gm-panel.gm-open{transform:translateX(0);visibility:visible;transition:transform .3s ease,visibility 0s}',
    '  .gm-top{flex:none;display:flex;justify-content:flex-end;padding:14px 16px 0}',
    '  .gm-close{width:44px;height:44px;border:0;border-radius:9999px;background:transparent;color:inherit;display:flex;align-items:center;justify-content:center;cursor:pointer;-webkit-tap-highlight-color:transparent}',
    '  .gm-close:active{background:rgba(148,163,184,.2)}',
    '  .gm-body{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:4px 24px calc(32px + env(safe-area-inset-bottom))}',
    '  .gm-user{display:flex;flex-direction:column;align-items:flex-start;margin-bottom:24px}',
    '  .gm-avatar{width:84px;height:84px;border-radius:9999px;object-fit:cover;background:#1e293b;border:2px solid rgba(148,163,184,.35)}',
    '  .gm-name{margin-top:12px;font-size:20px;font-weight:700;line-height:1.25;word-break:break-word}',
    '  .gm-list{display:flex;flex-direction:column;gap:6px}',
    '  .gm-item{display:flex;align-items:center;gap:16px;width:100%;padding:14px 12px;border-radius:12px;font-size:17px;color:inherit;text-decoration:none;background:transparent;border:0;text-align:left;cursor:pointer;font-family:inherit;-webkit-tap-highlight-color:transparent}',
    '  .gm-item:active{background:rgba(148,163,184,.18)}',
    '  .gm-item svg{width:24px;height:24px;flex:none}',
    '  .gm-icon{position:relative;display:inline-flex;flex:none}',
    '  .gm-badge{position:absolute;top:-10px;right:-14px;min-width:18px;height:18px;padding:0 5px;border-radius:9999px;background:#22c55e;color:#fff;font-size:11px;font-weight:700;line-height:1;display:flex;align-items:center;justify-content:center}',
    '  .gm-badge.gm-hidden{display:none}',
    '  .gm-publish{margin-top:14px;background:#2563eb;color:#fff;font-weight:700}',
    '  .gm-publish:active{background:#1d4ed8}',
    '  .gm-bottom{display:flex;position:fixed;left:0;right:0;bottom:0;height:52px;padding:0 18px calc(env(safe-area-inset-bottom));box-sizing:content-box;',
    '    background:rgba(2,6,23,.94);border-top:1px solid rgba(148,163,184,.18);color:#e5e7eb;align-items:center;justify-content:space-around;z-index:80;opacity:1;transition:opacity .25s ease,transform .2s ease;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);-webkit-tap-highlight-color:transparent}',
    '  html:not(.dark) .gm-bottom{background:rgba(255,255,255,.94);color:#111827;border-top-color:rgba(148,163,184,.28)}',
    '  .gm-bottom.gm-dim{opacity:0;pointer-events:none}\n  .gm-bottom a,.gm-bottom button{width:48px;height:48px;border:0;background:transparent;color:inherit;display:flex;align-items:center;justify-content:center;border-radius:9999px;cursor:pointer;-webkit-tap-highlight-color:transparent}',
    '  .gm-bottom svg{width:23px;height:23px}',
    '  .gm-fab{display:flex;position:fixed;right:20px;bottom:calc(68px + env(safe-area-inset-bottom));width:58px;height:58px;border:0;border-radius:9999px;background:#2563eb;color:#fff;align-items:center;justify-content:center;z-index:90;cursor:pointer;opacity:1;box-shadow:0 6px 18px rgba(37,99,235,.45);transition:opacity .25s ease,transform .15s ease;-webkit-tap-highlight-color:transparent}',
    '  .gm-fab svg{width:26px;height:26px}',
    '  .gm-fab:active{transform:scale(.94)}',
    '  .gm-fab.gm-dim{opacity:.3}',
    '  .gm-topbar-mobile{height:62px!important;padding:6px 14px!important;transform:translateY(0);transition:transform .25s ease,opacity .25s ease}',
    '  .gm-topbar-mobile .h-12{height:40px!important}',
    '  .gm-topbar-mobile.gm-hide{transform:translateY(-100%);opacity:0}',
    '  html.gm-lock,html.gm-lock body{overflow:hidden}',
    '  body{padding-bottom:calc(52px + env(safe-area-inset-bottom))}',
    '}'
  ].join('\n');
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  // ---------- Íconos ----------
  var SVG_OPEN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  var ICON = {
    close: SVG_OPEN + '<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>',
    home: SVG_OPEN + '<path d="M3 9.5 12 3l9 6.5"></path><path d="M5 10v10a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V10"></path></svg>',
    user: SVG_OPEN + '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>',
    bell: SVG_OPEN + '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"></path><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"></path></svg>',
    friends: SVG_OPEN + '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>',
    settings: SVG_OPEN + '<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"></path></svg>',
    pen: SVG_OPEN + '<path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>',
    // Hoja (cuadro) con un lápiz encima: ícono de posteo del botón flotante
    post: SVG_OPEN + '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"></path></svg>'
  };

  // ---------- Panel ----------
  var panel = document.createElement('div');
  panel.className = 'gm-panel';
  panel.id = 'gmPanel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', 'Menú de ByGether');
  panel.setAttribute('aria-hidden', 'true');
  panel.innerHTML =
    '<div class="gm-top"><button type="button" class="gm-close" aria-label="Cerrar menú">' + ICON.close + '</button></div>' +
    '<div class="gm-body">' +
      '<div class="gm-user"><img class="gm-avatar" alt="" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"><div class="gm-name"></div></div>' +
      '<nav class="gm-list">' +
        '<a class="gm-item" data-gm="home" href="dashboard.html">' + ICON.home + '<span>Inicio</span></a>' +
        '<a class="gm-item" data-gm="profile" href="perfil.html">' + ICON.user + '<span>Mi perfil</span></a>' +
        '<a class="gm-item" href="notificaciones.html"><span class="gm-icon">' + ICON.bell + '<span class="gm-badge gm-hidden" data-gm-badge>0</span></span><span>Notificaciones</span></a>' +
        '<a class="gm-item" data-gm="friends" href="conexiones.html">' + ICON.friends + '<span>Conexiones</span></a>' +
        '<a class="gm-item" href="settings.html">' + ICON.settings + '<span>Ajustes</span></a>' +
        '<button type="button" class="gm-item gm-publish" data-gm="publish">' + ICON.pen + '<span>Publicar</span></button>' +
      '</nav>' +
    '</div>';
  document.body.appendChild(panel);

  // ---------- Botón flotante ----------
  var fab = document.createElement('button');
  fab.type = 'button';
  fab.className = 'gm-fab';
  fab.setAttribute('aria-label', 'Publicar');
  fab.innerHTML = ICON.post;
  document.body.appendChild(fab);

  // ---------- Barra inferior móvil ----------
  var bottom = document.createElement('nav');
  bottom.className = 'gm-bottom';
  bottom.setAttribute('aria-label', 'Navegación móvil');
  bottom.innerHTML =
    '<a href="dashboard.html" data-gm-bottom="home" aria-label="Inicio">' + ICON.home + '</a>' +
    '<a href="notificaciones.html" data-gm-bottom="notifications" aria-label="Notificaciones"><span class="gm-icon">' + ICON.bell + '<span class="gm-badge gm-hidden" data-gm-bottom-badge>0</span></span></a>';
  document.body.appendChild(bottom);

  var mobileTopbar = document.querySelector('body > nav.sticky.top-0');
  if (mobileTopbar) mobileTopbar.classList.add('gm-topbar-mobile');

  var closeBtn = panel.querySelector('.gm-close');
  var avatarEl = panel.querySelector('.gm-avatar');
  var nameEl = panel.querySelector('.gm-name');
  var profileLink = panel.querySelector('[data-gm="profile"]');
  var homeLink = panel.querySelector('[data-gm="home"]');
  var publishBtn = panel.querySelector('[data-gm="publish"]');
  var badgeEl = panel.querySelector('[data-gm-badge]');
  var logoLink = document.querySelector('nav.sticky a[href="dashboard.html"]');

  var isDashboard = typeof window.openComposerModal === 'function';

  // ---------- Abrir / cerrar ----------
  function openMenu() {
    panel.classList.add('gm-open');
    panel.setAttribute('aria-hidden', 'false');
    document.documentElement.classList.add('gm-lock');
    if (logoLink) logoLink.setAttribute('aria-expanded', 'true');
  }

  function closeMenu() {
    panel.classList.remove('gm-open');
    panel.setAttribute('aria-hidden', 'true');
    document.documentElement.classList.remove('gm-lock');
    if (logoLink) logoLink.setAttribute('aria-expanded', 'false');
  }

  function goCompose() {
    if (typeof window.openComposerModal === 'function') {
      window.openComposerModal();
    } else {
      // El compositor vive en el dashboard: allá se abre solo al llegar.
      window.location.href = 'dashboard.html?compose=1';
    }
  }

  if (logoLink) {
    logoLink.setAttribute('aria-controls', 'gmPanel');
    logoLink.setAttribute('aria-expanded', 'false');
    logoLink.addEventListener('click', function (e) {
      if (mq.matches) {
        e.preventDefault();
        openMenu();
      }
    });
  }

  bottom.querySelector('[data-gm-bottom="home"]').addEventListener('click', function (e) {
    if (isDashboard) {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });

  closeBtn.addEventListener('click', closeMenu);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && panel.classList.contains('gm-open')) closeMenu();
  });

  homeLink.addEventListener('click', function (e) {
    if (isDashboard) {
      e.preventDefault();
      closeMenu();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });
  publishBtn.addEventListener('click', function () {
    closeMenu();
    goCompose();
  });
  fab.addEventListener('click', goCompose);

  // Si el navegador restaura la página desde su caché de retroceso, el panel arranca cerrado.
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) closeMenu();
  });

  // Si se pasa a pantalla ancha con el panel abierto (por ejemplo, al girar), se libera el scroll.
  var onMqChange = function (e) { if (!e.matches) closeMenu(); };
  if (mq.addEventListener) mq.addEventListener('change', onMqChange);
  else if (mq.addListener) mq.addListener(onMqChange);

  // ---------- Botón flotante: transparente al bajar, visible al subir ----------
  var lastY = window.pageYOffset || 0;
  var ticking = false;

  function handleScroll() {
    var y = window.pageYOffset || document.documentElement.scrollTop || 0;
    var delta = y - lastY;
    if (Math.abs(delta) > 6) {
      if (delta > 0 && y > 40) {
        fab.classList.add('gm-dim');
        bottom.classList.add('gm-dim');
        if (mobileTopbar) mobileTopbar.classList.add('gm-hide');
      } else if (delta < 0) {
        fab.classList.remove('gm-dim');
        bottom.classList.remove('gm-dim');
        if (mobileTopbar) mobileTopbar.classList.remove('gm-hide');
      }
      lastY = y;
    }
    if (y <= 40) {
      fab.classList.remove('gm-dim');
      bottom.classList.remove('gm-dim');
      if (mobileTopbar) mobileTopbar.classList.remove('gm-hide');
    }
    ticking = false;
  }

  window.addEventListener('scroll', function () {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(handleScroll);
  }, { passive: true });

  // ---------- Contador de notificaciones (refleja el de la campanita del menú lateral) ----------
  function setBadge(text, hidden) {
    badgeEl.textContent = text;
    badgeEl.classList.toggle('gm-hidden', hidden);
    if (bottomBadge) {
      bottomBadge.textContent = text;
      bottomBadge.classList.toggle('gm-hidden', hidden);
    }
  }

  var bottomBadge = bottom.querySelector('[data-gm-bottom-badge]');
  var bottomNotifications = bottom.querySelector('[data-gm-bottom="notifications"]');

  var sourceBadge = document.getElementById('notifBadge');
  if (sourceBadge) {
    var syncBadge = function () {
      setBadge(sourceBadge.textContent, sourceBadge.classList.contains('hidden'));
      bottomBadge.textContent = sourceBadge.textContent;
      bottomBadge.classList.toggle('gm-hidden', sourceBadge.classList.contains('hidden'));
    };
    syncBadge();
    if (window.MutationObserver) {
      new MutationObserver(syncBadge).observe(sourceBadge, {
        attributes: true, childList: true, characterData: true, subtree: true
      });
    }
  }

  // ---------- Avatar y nombre del usuario ----------
  async function loadUser() {
    try {
      if (typeof supabaseClient === 'undefined') return;
      var sess = await supabaseClient.auth.getSession();
      var user = sess && sess.data && sess.data.session && sess.data.session.user;
      if (!user) return;

      var name = (user.user_metadata && user.user_metadata.full_name) || (user.email || '').split('@')[0];
      nameEl.textContent = name;
      profileLink.href = 'perfil.html?user=' + encodeURIComponent(name);
      avatarEl.src = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(name) + '&background=random';

      var prof = await supabaseClient.from('profiles').select('avatar_url').eq('user_name', name).maybeSingle();
      if (prof && prof.data && prof.data.avatar_url) avatarEl.src = prof.data.avatar_url;

      // En páginas sin el menú lateral con campanita (ej. Ajustes) se consulta el contador aquí.
      if (!sourceBadge && user.email) {
        var c = await supabaseClient.from('notifications')
          .select('id', { count: 'exact', head: true })
          .eq('recipient_email', user.email)
          .eq('is_read', false);
        if (!c.error && c.count > 0) setBadge(c.count > 99 ? '99+' : String(c.count), false);
      }
    } catch (err) {
      // Si algo falla, el menú funciona igual, solo sin avatar/nombre.
    }
  }
  loadUser();

  // ---------- Llegada desde otra página con la intención de publicar ----------
  if (isDashboard && /[?&]compose=1(&|$)/.test(window.location.search)) {
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      var ready = (typeof myAvatarUrl !== 'undefined' && myAvatarUrl) || tries > 40;
      if (!ready) return;
      clearInterval(timer);
      window.openComposerModal();
      try { window.history.replaceState(null, '', window.location.pathname); } catch (e) { /* nada */ }
    }, 150);
  }
})();
