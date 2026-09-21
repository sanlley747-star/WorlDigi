// ===== VENTANA PARA COMENTAR (icono de comentar de una publicación) =====
// Archivo aislado. Expone  openCommentModal(postId).
// Muestra la publicación (avatar de quien publicó, su nombre y el tiempo) y debajo el lugar para comentar:
//   - avatar de quien comenta + un espacio SIN cuadro ni borde (solo el cursor parpadeando);
//   - abajo a la derecha, el indicador cuadrado de los 280 caracteres y el botón azul "Comentar",
//     inactivo hasta que se escribe la primera letra.
// Requiere `supabaseClient` (definido por la página) y comment-counts.js (para actualizar el contador).
(function () {
  var MAX = 280;
  var WARN = 30;
  var els = null;
  var currentPostId = null;
  var me = null;

  var css = [
    '.cm-lim{position:relative;width:32px;height:32px;flex:0 0 auto;opacity:0;transform:scale(.85);',
    '  transition:opacity .15s ease,transform .15s ease;pointer-events:none}',
    '.cm-lim.cm-on{opacity:1;transform:none}',
    '.cm-lim svg{display:block;width:100%;height:100%}',
    '.cm-track{fill:none;stroke:#e2e8f0;stroke-width:3}',
    'html.dark .cm-track{stroke:#334155}',
    '.cm-bar{fill:none;stroke:#3b82f6;stroke-width:3;stroke-linecap:round;stroke-dasharray:0 100;',
    '  transition:stroke-dasharray .12s linear,stroke .15s ease}',
    '.cm-lim.cm-warn .cm-bar{stroke:#eab308}',
    '.cm-lim.cm-end .cm-bar{stroke:#ef4444}',
    '.cm-num{position:absolute;top:0;right:0;bottom:0;left:0;display:flex;align-items:center;justify-content:center;',
    '  font-size:.75rem;font-weight:700;line-height:1;color:#64748b;opacity:0;transition:opacity .15s ease}',
    'html.dark .cm-num{color:#94a3b8}',
    '.cm-lim.cm-warn .cm-num{opacity:1}',
    '.cm-lim.cm-end .cm-num,html.dark .cm-lim.cm-end .cm-num{color:#ef4444}',
    '.cm-input{display:block;width:100%;padding:.5rem .25rem;border:0;outline:none;box-shadow:none;resize:none;overflow-y:hidden;',
    '  background:transparent;color:inherit;font:inherit;font-size:1rem;line-height:1.5rem;min-height:3.5rem}'
  ].join('\n');

  function esc(t) {
    return String(t == null ? '' : t)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fallbackAvatar(name) {
    return 'https://ui-avatars.com/api/?name=' + encodeURIComponent(name || 'Usuario') + '&background=random';
  }
  function timeText(d) {
    return (typeof formatCompactTime === 'function') ? formatCompactTime(d) : '';
  }

  function build() {
    if (els) return els;
    var style = document.createElement('style');
    style.id = 'commentModalStyles';
    style.textContent = css;
    document.head.appendChild(style);

    var wrap = document.createElement('div');
    wrap.id = 'commentModal';
    wrap.className = 'hidden fixed inset-0 bg-black/70 z-[100] items-start md:items-center justify-center p-4 overflow-y-auto';
    wrap.innerHTML =
      '<div class="relative bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 rounded-xl shadow-lg w-full max-w-xl p-4 my-auto">' +
        '<button type="button" data-cm="close" aria-label="Cerrar" class="absolute top-3 right-3 text-2xl text-gray-500 hover:text-gray-800 dark:hover:text-white leading-none">&times;</button>' +

        // La publicación
        '<div data-cm="post" class="pr-8"></div>' +

        // Quien comenta
        '<div class="flex items-start gap-3 mt-4 pt-4 border-t border-gray-100 dark:border-slate-800">' +
          '<img data-cm="myavatar" src="" alt="Tu avatar" class="w-10 h-10 rounded-full object-cover border border-gray-300 dark:border-slate-700 flex-shrink-0">' +
          '<textarea data-cm="input" maxlength="' + MAX + '" rows="2" aria-label="Escribe tu comentario" class="cm-input"></textarea>' +
        '</div>' +

        '<div class="flex items-center justify-end gap-3 mt-2">' +
          '<div data-cm="lim" class="cm-lim" role="img" aria-label="Límite de caracteres">' +
            '<svg viewBox="0 0 30 30" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
              '<path class="cm-track" d="M15 1.5H21.5A7 7 0 0 1 28.5 8.5V21.5A7 7 0 0 1 21.5 28.5H8.5A7 7 0 0 1 1.5 21.5V8.5A7 7 0 0 1 8.5 1.5Z"></path>' +
              '<path class="cm-bar" pathLength="100" d="M15 1.5H21.5A7 7 0 0 1 28.5 8.5V21.5A7 7 0 0 1 21.5 28.5H8.5A7 7 0 0 1 1.5 21.5V8.5A7 7 0 0 1 8.5 1.5Z"></path>' +
            '</svg>' +
            '<span data-cm="num" class="cm-num"></span>' +
          '</div>' +
          '<button type="button" data-cm="submit" disabled class="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:hover:bg-blue-600 disabled:cursor-not-allowed text-white text-sm font-bold py-2 px-6 rounded-lg transition">Comentar</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);

    els = {
      wrap: wrap,
      post: wrap.querySelector('[data-cm="post"]'),
      myAvatar: wrap.querySelector('[data-cm="myavatar"]'),
      input: wrap.querySelector('[data-cm="input"]'),
      lim: wrap.querySelector('[data-cm="lim"]'),
      bar: wrap.querySelector('.cm-bar'),
      num: wrap.querySelector('[data-cm="num"]'),
      submit: wrap.querySelector('[data-cm="submit"]'),
      close: wrap.querySelector('[data-cm="close"]')
    };

    els.close.addEventListener('click', close);
    wrap.addEventListener('click', function (e) { if (e.target === wrap) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && isOpen()) close(); });
    els.input.addEventListener('input', onInput);
    els.submit.addEventListener('click', send);
    return els;
  }

  function isOpen() { return !!(els && !els.wrap.classList.contains('hidden')); }

  function grow() {
    els.input.style.height = 'auto';
    if (els.input.scrollHeight > 0) els.input.style.height = els.input.scrollHeight + 'px';
  }

  function updateLimit() {
    var len = els.input.value.length;
    if (len === 0) {
      els.lim.classList.remove('cm-on', 'cm-warn', 'cm-end');
      els.bar.style.strokeDasharray = '0 100';
      els.num.textContent = '';
      return;
    }
    var left = Math.max(0, MAX - len);
    els.lim.classList.add('cm-on');
    els.bar.style.strokeDasharray = Math.min(100, (len / MAX) * 100) + ' 100';
    els.lim.classList.toggle('cm-warn', left <= WARN);
    els.lim.classList.toggle('cm-end', left === 0);
    els.num.textContent = left <= WARN ? String(left) : '';
    els.lim.setAttribute('aria-label', 'Te quedan ' + left + ' caracteres');
  }

  function onInput() {
    els.submit.disabled = els.input.value.trim().length === 0;
    updateLimit();
    grow();
  }

  function close() {
    if (!els) return;
    els.wrap.classList.add('hidden');
    els.wrap.classList.remove('flex');
    document.body.style.overflow = '';
    currentPostId = null;
  }

  async function getMe() {
    if (me) return me;
    var res = await supabaseClient.auth.getSession();
    var u = res && res.data && res.data.session && res.data.session.user;
    if (!u) return null;
    me = { email: u.email, name: (u.user_metadata && u.user_metadata.full_name) || (u.email || '').split('@')[0] };
    return me;
  }

  async function open(postId) {
    if (!postId) return;
    var user = await getMe();
    if (!user) { window.location.href = 'index.html'; return; }

    build();
    currentPostId = postId;

    // Estado inicial limpio y ventana visible
    els.input.value = '';
    els.submit.disabled = true;
    els.post.innerHTML = '<p class="text-sm text-gray-400 dark:text-gray-500 py-2">Cargando...</p>';
    els.myAvatar.src = fallbackAvatar(user.name);
    updateLimit();
    els.wrap.classList.remove('hidden');
    els.wrap.classList.add('flex');
    document.body.style.overflow = 'hidden';
    grow();
    els.input.focus();

    var mySeq = postId;

    // Mi foto
    supabaseClient.from('profiles').select('avatar_url').eq('user_email', user.email).maybeSingle()
      .then(function (r) { if (currentPostId === mySeq && r.data && r.data.avatar_url) els.myAvatar.src = r.data.avatar_url; });

    // La publicación (si es un repost, se muestra lo mismo que se ve en la tarjeta: la publicación original)
    var pr = await supabaseClient.from('posts').select('*').eq('id', postId).maybeSingle();
    var post = pr.data;
    if (post && post.repost_of) {
      var orig = await supabaseClient.from('posts').select('*').eq('id', post.repost_of).maybeSingle();
      if (orig.data) post = orig.data;
    }
    if (currentPostId !== mySeq) return;
    if (!post) {
      els.post.innerHTML = '<p class="text-sm text-gray-500 dark:text-gray-400 py-2">Esta publicación ya no está disponible.</p>';
      els.submit.disabled = true;
      return;
    }

    var author = post.user_name || 'Usuario';
    var avatar = post.avatar_url || fallbackAvatar(author);
    var ar = await supabaseClient.from('profiles').select('avatar_url').eq('user_email', post.user_email).maybeSingle();
    if (ar.data && ar.data.avatar_url) avatar = ar.data.avatar_url;
    if (currentPostId !== mySeq) return;

    els.post.innerHTML =
      '<div class="flex items-center gap-3">' +
        '<img src="' + esc(avatar) + '" alt="' + esc(author) + '" class="w-10 h-10 rounded-full object-cover border border-gray-300 dark:border-slate-700 flex-shrink-0">' +
        '<div class="flex items-center gap-2 min-w-0">' +
          '<span data-user-card="' + esc(author) + '" class="font-bold text-sm text-gray-900 dark:text-white truncate">' + esc(author) + '</span>' +
          '<span class="text-gray-400 text-sm">·</span>' +
          '<span class="text-sm text-gray-500 dark:text-gray-400 flex-shrink-0">' + esc(timeText(post.created_at)) + '</span>' +
        '</div>' +
      '</div>' +
      (post.content ? '<p class="mt-3 text-sm text-gray-800 dark:text-gray-200 break-words whitespace-pre-line">' + esc(post.content) + '</p>' : '') +
      (post.image_url ? '<img src="' + esc(post.image_url) + '" alt="Imagen de publicación" class="mt-3 w-full rounded-lg max-h-60 object-cover">' : '');
  }

  async function send() {
    var content = els.input.value.trim();
    if (!content || content.length > MAX || !currentPostId) return;
    var user = await getMe();
    if (!user) { window.location.href = 'index.html'; return; }

    var postId = currentPostId;
    els.submit.disabled = true;
    var res = await supabaseClient.from('comments').insert({
      post_id: postId,
      user_email: user.email,
      user_name: user.name,
      content: content
    });
    if (res.error) {
      alert('Error al comentar: ' + res.error.message);
      els.submit.disabled = els.input.value.trim().length === 0;
      return;
    }

    close();
    // El número junto al icono de comentar se actualiza al instante
    if (typeof ccFetchCounts === 'function' && typeof ccSetCount === 'function') {
      var counts = await ccFetchCounts([postId]);
      ccSetCount(postId, counts[postId] || 0);
    }
    if (typeof showToast === 'function') showToast('Tu comentario se envió');
  }

  window.openCommentModal = open;
})();
