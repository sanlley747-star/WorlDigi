// ===== TARJETA INFORMATIVA DE USUARIO (aparece al pasar el cursor sobre un nombre) =====
// Muestra: avatar (izquierda) con el nombre debajo, botón Conectar / Conectado / Conectados /
// Desconectar (derecha) y, más abajo, los contadores Siguiendo y Seguidores.
//
// Cómo se activa en cada pantalla:
//   - Cualquier elemento con el atributo  data-user-card="Nombre del usuario"
//   - Cualquier enlace de texto a  perfil.html?user=...  (los enlaces que contienen una imagen,
//     como los del avatar, no la activan: solo los nombres).
// Reglas:
//   - En tu propia cuenta no hay botón de conectar (igual que en tu perfil).
//   - Cuentas canal: llevan su etiqueta y solo muestran Seguidores; lo que siguen es privado y
//     solo lo ve la propia cuenta.
//   - Solo con mouse (pantallas con hover). En pantallas táctiles el toque abre el perfil como siempre.
// Requiere connections.js y que la página ya haya definido `supabaseClient` antes de USAR la tarjeta.

(function () {
  if (window.__userCardLoaded) return;
  window.__userCardLoaded = true;

  var OPEN_DELAY = 350;   // ms antes de abrir al entrar en un nombre
  var SWITCH_DELAY = 120; // ms al pasar de un nombre a otro con la tarjeta ya abierta
  var CLOSE_DELAY = 250;  // ms de gracia al salir (permite llegar a la tarjeta)
  var CACHE_MS = 30000;
  var CARD_W = 300;

  // ---------- Estilos (se inyectan una sola vez) ----------
  var css = [
    '.uc-card{position:fixed;z-index:10000;top:0;left:0;width:' + CARD_W + 'px;max-width:calc(100vw - 16px);box-sizing:border-box;',
    '  padding:14px 16px;border-radius:14px;background:#fff;color:#0f172a;border:1px solid #e2e8f0;',
    '  box-shadow:0 14px 34px rgba(15,23,42,.20);opacity:0;visibility:hidden;transform:translateY(4px);',
    '  transition:opacity .12s ease,transform .12s ease,visibility 0s linear .12s;pointer-events:none;font-family:inherit}',
    '.uc-card.uc-show{opacity:1;visibility:visible;transform:none;pointer-events:auto;transition:opacity .12s ease,transform .12s ease}',
    'html.dark .uc-card{background:#0f172a;color:#f1f5f9;border-color:#334155;box-shadow:0 14px 34px rgba(0,0,0,.55)}',
    /* Puente invisible para que el cursor pueda cruzar el hueco entre el nombre y la tarjeta */
    '.uc-card::before,.uc-card::after{content:"";position:absolute;left:0;right:0;height:12px}',
    '.uc-card::before{top:-12px}.uc-card::after{bottom:-12px}',
    '.uc-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}',
    '.uc-id{display:flex;flex-direction:column;align-items:flex-start;gap:6px;min-width:0;flex:1 1 auto}',
    '.uc-avatar{display:block;width:56px;height:56px;border-radius:9999px;overflow:hidden;background:#fff;border:1px solid #e2e8f0}',
    '.uc-avatar img{display:block;width:100%;height:100%;object-fit:cover}',
    'html.dark .uc-avatar{background:#fff;border-color:#e2e8f0}',
    '.uc-name{max-width:100%;font-weight:700;font-size:.95rem;line-height:1.2rem;color:inherit;text-decoration:none;overflow-wrap:anywhere}',
    '.uc-name:hover{text-decoration:underline}',
    '.uc-action{flex:0 0 auto;min-height:2rem}',
    '.uc-stats{display:flex;align-items:center;gap:18px;margin-top:12px;padding-top:10px;border-top:1px solid #e2e8f0;font-size:.875rem;color:#475569}',
    'html.dark .uc-stats{border-top-color:#334155;color:#94a3b8}',
    '.uc-stats a{color:inherit;text-decoration:none}',
    '.uc-stats a:hover{text-decoration:underline}',
    '.uc-stats strong{color:#0f172a;font-weight:700}',
    'html.dark .uc-stats strong{color:#fff}'
  ].join('\n');
  var styleEl = document.createElement('style');
  styleEl.id = 'userCardStyles';
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // ---------- Estado ----------
  var card = null;
  var anchorEl = null;
  var openTimer = null;
  var closeTimer = null;
  var seq = 0;
  var cache = {};       // nombre -> { t, info }
  var meCache;          // undefined = aún no consultado; null = sin sesión
  var statFollowing = null;
  var statFollowers = null;

  function canHover() {
    return !!(window.matchMedia && window.matchMedia('(hover: hover)').matches);
  }

  // ---------- Detección del nombre bajo el cursor ----------
  function findTrigger(node) {
    if (!node || !node.closest) return null;
    var t = node.closest('[data-user-card]');
    if (t) {
      var n = t.getAttribute('data-user-card');
      return n ? { el: t, name: n } : null;
    }
    var a = node.closest('a[href]');
    if (a && !a.querySelector('img')) {
      var href = a.getAttribute('href') || '';
      var prefix = 'perfil.html?user=';
      if (href.indexOf(prefix) === 0) {
        var raw = href.slice(prefix.length).split('&')[0];
        try { raw = decodeURIComponent(raw); } catch (e) { /* se deja tal cual */ }
        if (raw) return { el: a, name: raw };
      }
    }
    return null;
  }

  // ---------- Datos ----------
  async function getMe() {
    if (meCache !== undefined) return meCache;
    try {
      var res = await supabaseClient.auth.getSession();
      var u = res && res.data && res.data.session && res.data.session.user;
      meCache = u ? {
        email: u.email,
        name: (u.user_metadata && u.user_metadata.full_name) || (u.email || '').split('@')[0]
      } : null;
    } catch (e) {
      meCache = null;
    }
    return meCache;
  }

  async function loadInfo(name) {
    var hit = cache[name];
    if (hit && Date.now() - hit.t < CACHE_MS) return hit.info;

    var info = {
      name: name, email: null, avatar: null, me: null, isMe: false, channel: false,
      counts: { following: 0, followers: 0 }, state: { iFollow: false, followsMe: false }
    };
    try {
      // Sesión y perfil son consultas independientes: arrancan al mismo tiempo.
      var mePromise = getMe();
      var profPromise = supabaseClient.from('profiles')
        .select('user_email, avatar_url').eq('user_name', name).limit(1);
      info.me = await mePromise;

      var prof = await profPromise;
      if (prof.data && prof.data.length) {
        info.email = prof.data[0].user_email;
        info.avatar = prof.data[0].avatar_url || null;
      }
      if (!info.email) info.email = await connResolveEmail(name);

      if (info.email) {
        info.isMe = !!(info.me && info.me.email === info.email);
        var results = await Promise.all([
          connCounts(info.email),
          connIsChannel(info.email),
          (info.me && !info.isMe) ? connFetchStates(info.me.email, [info.email]) : Promise.resolve(null)
        ]);
        info.counts = results[0];
        info.channel = results[1];
        if (results[2] && results[2][info.email]) info.state = results[2][info.email];
      }
    } catch (e) {
      console.error('Tarjeta de usuario:', e);
    }
    cache[name] = { t: Date.now(), info: info };
    return info;
  }

  // ---------- Construcción de la tarjeta ----------
  function ensureCard() {
    if (card) return card;
    card = document.createElement('div');
    card.className = 'uc-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Información del usuario');
    document.body.appendChild(card);
    return card;
  }

  function renderCard(name, info, loading) {
    var isChannelHidden = info && info.channel && !info.isMe; // "Siguiendo" privado en cuentas canal
    // Mientras llegan los datos, el avatar permanece completamente blanco.
    // No mostramos las iniciales/fallback porque ese contenido da una falsa sensación de dato ya cargado.
    var avatar = (info && info.avatar) || (loading ? "" : connAvatarFallback(name));
    var profileUrl = connProfileUrl(name);
    var following = info ? info.counts.following : '–';
    var followers = info ? info.counts.followers : '–';

    card.innerHTML =
      '<div class="uc-top">' +
        '<div class="uc-id">' +
          '<a href="' + connEscape(profileUrl) + '"><span class="uc-avatar" aria-hidden="true">' +
          (avatar ? '<img src="' + connEscape(avatar) + '" alt="' + connEscape(name) + '">' : '') +
        '</span></a>' +
          '<a class="uc-name" href="' + connEscape(profileUrl) + '">' + connEscape(name) + (info && info.channel ? connChannelChip() : '') + '</a>' +
        '</div>' +
        '<div class="uc-action" data-uc-action></div>' +
      '</div>' +
      '<div class="uc-stats">' +
        (isChannelHidden ? '' :
          '<a href="' + connEscape(connListUrl(name, 'siguiendo')) + '"><strong data-uc-following>' + following + '</strong> Siguiendo</a>') +
        '<a href="' + connEscape(connListUrl(name, 'seguidores')) + '"><strong data-uc-followers>' + followers + '</strong> Seguidores</a>' +
      '</div>';

    statFollowing = card.querySelector('[data-uc-following]');
    statFollowers = card.querySelector('[data-uc-followers]');

    // Botón de conexión (no en tu propia cuenta)
    if (info && info.email && !info.isMe) {
      var slot = card.querySelector('[data-uc-action]');
      slot.appendChild(connCreateButton({
        myEmail: info.me ? info.me.email : null,
        myName: info.me ? info.me.name : null,
        otherEmail: info.email,
        otherName: name,
        iFollow: info.state.iFollow,
        followsMe: info.state.followsMe,
        compact: true,
        onChange: async function () {
          delete cache[name];
          var c = await connCounts(info.email);
          if (card && card.classList.contains('uc-show') && statFollowing !== undefined) {
            if (statFollowing) statFollowing.textContent = c.following;
            if (statFollowers) statFollowers.textContent = c.followers;
          }
        }
      }));
    }
  }

  // ---------- Posición ----------
  function place() {
    if (!card || !anchorEl || !document.contains(anchorEl)) return;
    var r = anchorEl.getBoundingClientRect();
    var w = card.offsetWidth || CARD_W;
    var h = card.offsetHeight || 150;
    var vw = document.documentElement.clientWidth;
    var vh = window.innerHeight;

    var left = Math.max(8, Math.min(r.left, vw - w - 8));
    var top = r.bottom + 8;
    if (top + h > vh - 8 && r.top - h - 8 >= 8) top = r.top - h - 8; // si no cabe abajo, va arriba
    top = Math.max(8, Math.min(top, vh - h - 8));

    card.style.left = left + 'px';
    card.style.top = top + 'px';
  }

  // ---------- Abrir / cerrar ----------
  async function open(el, name, prefetchedInfo) {
    if (!canHover() || !name || name === 'Usuario' || typeof supabaseClient === 'undefined') return;
    anchorEl = el;
    var mySeq = ++seq;

    ensureCard();
    var hit = cache[name];
    var fresh = hit && Date.now() - hit.t < CACHE_MS;
    renderCard(name, fresh ? hit.info : null, !fresh); // durante la carga, avatar blanco
    card.classList.add('uc-show');
    place();

    if (fresh) return;
    var info = prefetchedInfo || await loadInfo(name);
    if (mySeq !== seq) return; // el usuario ya movió el cursor a otro nombre
    renderCard(name, info, false);
    place();
  }

  function hide() {
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
    seq++;
    anchorEl = null;
    if (card) card.classList.remove('uc-show');
  }

  function isOpen() {
    return !!(card && card.classList.contains('uc-show'));
  }

  // ---------- Eventos (delegados: valen para nombres que se dibujan después) ----------
  document.addEventListener('mouseover', function (e) {
    if (!e.target || !e.target.closest) return;
    if (e.target.closest('.uc-card')) { clearTimeout(closeTimer); return; }

    var t = findTrigger(e.target);
    if (!t) return;
    clearTimeout(closeTimer);
    if (isOpen() && anchorEl === t.el) { clearTimeout(openTimer); return; }

    clearTimeout(openTimer);

    // Empieza a cargar los datos en cuanto el cursor entra en el nombre.
    // El retardo de apertura sigue evitando parpadeos, pero ya no se desperdicia ese tiempo.
    var prefetched = null;
    var hit = cache[t.name];
    if (!(hit && Date.now() - hit.t < CACHE_MS) && typeof supabaseClient !== 'undefined') {
      prefetched = loadInfo(t.name);
    }

    openTimer = setTimeout(function () {
      if (prefetched) {
        prefetched.then(function (info) { open(t.el, t.name, info); })
          .catch(function () { open(t.el, t.name); });
      } else {
        open(t.el, t.name);
      }
    }, isOpen() ? SWITCH_DELAY : OPEN_DELAY);
  });

  document.addEventListener('mouseout', function (e) {
    if (!e.target || !e.target.closest) return;
    var fromCard = e.target.closest('.uc-card');
    var fromTrigger = fromCard ? null : findTrigger(e.target);
    if (!fromCard && !fromTrigger) return;

    var to = e.relatedTarget;
    if (to && to.closest) {
      if (to.closest('.uc-card')) return;                       // va hacia la tarjeta
      var toTrigger = findTrigger(to);
      if (toTrigger && fromTrigger && toTrigger.el === fromTrigger.el) return; // sigue dentro del mismo nombre
    }
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
    closeTimer = setTimeout(hide, CLOSE_DELAY);
  });

  window.addEventListener('scroll', function () { if (isOpen()) hide(); }, true);
  window.addEventListener('resize', function () { if (isOpen()) hide(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && isOpen()) hide(); });
  document.addEventListener('click', function (e) {
    // Un clic en el nombre navega/abre algo: la tarjeta se cierra. Los clics dentro de la tarjeta no la cierran.
    if (isOpen() && !(e.target.closest && e.target.closest('.uc-card'))) hide();
  });

  // Si cambia una conexión desde otro botón de la página, los datos guardados dejan de valer
  window.addEventListener('conn:changed', function () { cache = {}; });
})();
