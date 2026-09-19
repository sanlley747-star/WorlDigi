// ===== SISTEMA DE CONEXIONES DE BYGETHER =====
// Modelo de "seguir": si A presiona Conectar en el perfil de B, A queda conectado con B
// al instante (B no tiene que aceptar) y a B le llega una notificación "Estableció conexión".
//   - Siguiendo  = usuarios a los que yo presioné Conectar.
//   - Seguidores = usuarios que presionaron Conectar hacia mí.
//   - Conectar  -> Conectado (yo lo sigo) -> Conectados (nos seguimos mutuamente).
//   - Sobre Conectado / Conectados aparece "Desconectar" en rojo (con hover, o con un
//     primer toque en pantallas táctiles) y al confirmarlo se elimina la conexión.
// Requiere que la página ya haya definido `supabaseClient` antes de USAR estas funciones.
// Se usa en: perfil.html, notificaciones.html y conexiones.html.

// ---------- Estilos del botón (se inyectan una sola vez) ----------
(function () {
  if (document.getElementById('connStyles')) return;
  const css = [
    '.conn-btn{position:relative;display:inline-grid;place-items:center;min-width:8.75rem;padding:.45rem 1.1rem;border-radius:9999px;',
    '  font-size:.875rem;font-weight:700;line-height:1.25rem;font-family:inherit;cursor:pointer;white-space:nowrap;',
    '  border:1.5px solid #2563eb;background:#2563eb;color:#fff;transition:background-color .15s,color .15s,border-color .15s;',
    '  -webkit-tap-highlight-color:transparent}',
    '.conn-btn:hover{background:#1d4ed8;border-color:#1d4ed8}',
    '.conn-btn > span{grid-area:1/1}',
    '.conn-btn .conn-off{visibility:hidden}',
    '.conn-btn.conn-sm{min-width:0;padding:.35rem .8rem;font-size:.8125rem}',
    '.conn-btn[disabled]{opacity:.6;cursor:default}',
    /* Ya conectado: botón con contorno */
    '.conn-btn.conn-on{background:transparent;color:#2563eb;border-color:#2563eb}',
    'html.dark .conn-btn.conn-on{color:#93c5fd;border-color:#60a5fa}',
    '.conn-btn.conn-on:hover{background:transparent}',
    /* Desconectar: letras y borde en rojo (hover en escritorio, o "armado" con un toque en móvil) */
    '.conn-btn.conn-on.conn-armed{color:#ef4444 !important;border-color:#ef4444 !important;background:transparent !important}',
    '.conn-btn.conn-armed .conn-lbl{visibility:hidden}',
    '.conn-btn.conn-armed .conn-off{visibility:visible}',
    '@media (hover:hover){',
    '  .conn-btn.conn-on:hover{color:#ef4444 !important;border-color:#ef4444 !important}',
    '  .conn-btn.conn-on:hover .conn-lbl{visibility:hidden}',
    '  .conn-btn.conn-on:hover .conn-off{visibility:visible}',
    '}'
  ].join('\n');
  const style = document.createElement('style');
  style.id = 'connStyles';
  style.textContent = css;
  document.head.appendChild(style);
})();

// ---------- Utilidades ----------
function connEscape(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function connAvatarFallback(name) {
  return 'https://ui-avatars.com/api/?name=' + encodeURIComponent(name || 'Usuario') + '&background=random';
}

function connProfileUrl(name) {
  return 'perfil.html?user=' + encodeURIComponent(name);
}

// tab: 'siguiendo' | 'seguidores'
function connListUrl(name, tab) {
  return 'conexiones.html?user=' + encodeURIComponent(name) + '&tab=' + (tab || 'siguiendo');
}

function connChunks(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// ---------- Consultas ----------

// El perfil se abre por nombre (perfil.html?user=Nombre): buscamos el correo de ese nombre.
async function connResolveEmail(userName) {
  if (!userName) return null;
  const prof = await supabaseClient
    .from('profiles').select('user_email').eq('user_name', userName).limit(1);
  if (prof.data && prof.data.length) return prof.data[0].user_email;

  // Quien aún no tiene fila en profiles se identifica por sus publicaciones
  const post = await supabaseClient
    .from('posts').select('user_email').eq('user_name', userName).limit(1);
  if (post.data && post.data.length) return post.data[0].user_email;

  return null;
}

// { following: a cuántos sigue este usuario, followers: cuántos lo siguen }
async function connCounts(email) {
  if (!email) return { following: 0, followers: 0 };
  const [a, b] = await Promise.all([
    supabaseClient.from('connections').select('id', { count: 'exact', head: true }).eq('follower_email', email),
    supabaseClient.from('connections').select('id', { count: 'exact', head: true }).eq('following_email', email)
  ]);
  return { following: a.count || 0, followers: b.count || 0 };
}

// Para cada correo: { iFollow: yo lo sigo, followsMe: él me sigue }
async function connFetchStates(myEmail, emails) {
  const out = {};
  const list = [...new Set((emails || []).filter(e => e && e !== myEmail))];
  list.forEach(e => { out[e] = { iFollow: false, followsMe: false }; });
  if (!myEmail || !list.length) return out;

  for (const chunk of connChunks(list, 50)) {
    const [a, b] = await Promise.all([
      supabaseClient.from('connections').select('following_email')
        .eq('follower_email', myEmail).in('following_email', chunk),
      supabaseClient.from('connections').select('follower_email')
        .eq('following_email', myEmail).in('follower_email', chunk)
    ]);
    (a.data || []).forEach(r => { if (out[r.following_email]) out[r.following_email].iFollow = true; });
    (b.data || []).forEach(r => { if (out[r.follower_email]) out[r.follower_email].followsMe = true; });
  }
  return out;
}

// Nombre y avatar de una lista de correos. `hints` = { correo: nombre guardado en la conexión }.
async function connFetchPeople(emails, hints) {
  const people = {};
  const list = [...new Set((emails || []).filter(Boolean))];
  list.forEach(e => {
    people[e] = { name: (hints && hints[e]) || e.split('@')[0], avatar: null };
  });

  for (const chunk of connChunks(list, 50)) {
    const { data } = await supabaseClient
      .from('profiles').select('user_email, user_name, avatar_url').in('user_email', chunk);
    (data || []).forEach(p => {
      if (!people[p.user_email]) return;
      if (p.user_name) people[p.user_email].name = p.user_name;
      people[p.user_email].avatar = p.avatar_url || null;
    });
  }
  return people;
}

// ---------- Botón Conectar / Conectado / Conectados / Desconectar ----------
// opts: { myEmail, myName, otherEmail, otherName, iFollow, followsMe,
//         variant: 'default' | 'notif', compact: boolean, onChange(state) }
let connArmedBtn = null;

document.addEventListener('click', function (e) {
  if (connArmedBtn && !connArmedBtn.contains(e.target)) {
    connArmedBtn.classList.remove('conn-armed');
    connArmedBtn = null;
  }
});

function connCreateButton(opts) {
  const btn = document.createElement('button');
  btn.type = 'button';

  let iFollow = !!opts.iFollow;
  const followsMe = !!opts.followsMe;
  let busy = false;
  let armTimer = null;
  const canHover = !!(window.matchMedia && window.matchMedia('(hover: hover)').matches);

  function disarm() {
    clearTimeout(armTimer);
    btn.classList.remove('conn-armed');
    if (connArmedBtn === btn) connArmedBtn = null;
  }

  function arm() {
    if (connArmedBtn && connArmedBtn !== btn) connArmedBtn.classList.remove('conn-armed');
    btn.classList.add('conn-armed');
    connArmedBtn = btn;
    clearTimeout(armTimer);
    armTimer = setTimeout(disarm, 4000);
  }

  function render() {
    let label;
    if (iFollow && followsMe) label = 'Conectados';
    else if (iFollow) label = 'Conectado';
    else if (opts.variant === 'notif' && followsMe) label = 'Conecta tú también';
    else label = 'Conectar';

    btn.className = 'conn-btn' + (iFollow ? ' conn-on' : '') + (opts.compact ? ' conn-sm' : '');
    btn.innerHTML = '<span class="conn-lbl">' + label + '</span><span class="conn-off">Desconectar</span>';
    btn.setAttribute('aria-label', iFollow ? label + ' (presiona para desconectar)' : label);
    btn.disabled = busy;
  }

  async function follow() {
    const { error } = await supabaseClient.from('connections').insert({
      follower_email: opts.myEmail,
      follower_name: opts.myName || null,
      following_email: opts.otherEmail,
      following_name: opts.otherName || null
    });
    // 23505 = ya estaban conectados (por ejemplo, desde otra pestaña): se toma como éxito
    if (error && error.code !== '23505') {
      alert('No se pudo establecer la conexión: ' + error.message);
      return false;
    }
    iFollow = true;
    return true;
  }

  async function unfollow() {
    const { error } = await supabaseClient.from('connections').delete()
      .eq('follower_email', opts.myEmail)
      .eq('following_email', opts.otherEmail);
    if (error) {
      alert('No se pudo desconectar: ' + error.message);
      return false;
    }
    iFollow = false;
    return true;
  }

  btn.addEventListener('click', async function (e) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;

    if (!opts.myEmail) { window.location.href = 'index.html'; return; }

    if (iFollow) {
      // Con mouse el botón ya muestra "Desconectar" al pasar el cursor: un clic basta.
      // En pantallas táctiles el primer toque muestra "Desconectar" y el segundo confirma.
      if (!canHover && !btn.classList.contains('conn-armed')) { arm(); return; }
      disarm();
    }

    busy = true;
    render();
    const ok = iFollow ? await unfollow() : await follow();
    busy = false;
    render();
    if (ok && typeof opts.onChange === 'function') {
      opts.onChange({ iFollow: iFollow, followsMe: followsMe, mutual: iFollow && followsMe });
    }
  });

  render();
  return btn;
}
