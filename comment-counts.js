// ===== CONTADOR DE COMENTARIOS =====
// Archivo aislado: solo LEE la cantidad de comentarios por publicación.
// Requiere que la página ya haya definido `supabaseClient` antes de USAR estas funciones.
// Usa la función SQL public.comment_counts(post_ids) (ver supabase/sql/paso8_contador_comentarios.sql).

// Devuelve { [post_id]: cantidad } para la lista de ids indicada. Si algo falla devuelve {} (los contadores quedan en 0).
async function ccFetchCounts(postIds) {
  const ids = Array.from(new Set((postIds || []).filter(id => id !== null && id !== undefined)));
  if (!ids.length) return {};
  try {
    const { data, error } = await supabaseClient.rpc('comment_counts', { post_ids: ids });
    if (error) throw error;
    const map = {};
    (data || []).forEach(r => { map[r.post_id] = Number(r.total) || 0; });
    return map;
  } catch (e) {
    console.error('No se pudieron cargar los contadores de comentarios:', e);
    return {};
  }
}

// Actualiza en pantalla el contador de una publicación (si está visible en el feed).
function ccSetCount(postId, n) {
  const el = document.getElementById(`comments-count-${postId}`);
  if (el) el.textContent = n;
}

// ===== CONTADOR DE REPOSTS =====
// Cuántas veces fue reposteada (o citada) cada publicación. Usa la función SQL public.repost_counts(post_ids)
// (ver supabase/sql/paso9_contador_reposts.sql). Devuelve { [post_id]: cantidad }.
async function ccFetchRepostCounts(postIds) {
  const ids = Array.from(new Set((postIds || []).filter(id => id !== null && id !== undefined)));
  if (!ids.length) return {};
  try {
    const { data, error } = await supabaseClient.rpc('repost_counts', { post_ids: ids });
    if (error) throw error;
    const map = {};
    (data || []).forEach(r => { map[r.post_id] = Number(r.total) || 0; });
    return map;
  } catch (e) {
    console.error('No se pudieron cargar los contadores de reposts:', e);
    return {};
  }
}

// ===== ME GUSTA YA DADOS POR EL USUARIO ACTUAL =====
// Devuelve un Set con los post_id que el usuario (userEmail) ya marcó con "me gusta",
// de entre la lista de ids indicada. Se usa para pintar el corazón en rojo relleno
// y para saber si el clic debe sumar o quitar el like (evita likes repetidos).
async function ccFetchMyLikes(postIds, userEmail) {
  const ids = Array.from(new Set((postIds || []).filter(id => id !== null && id !== undefined)));
  if (!ids.length || !userEmail) return new Set();
  try {
    const { data, error } = await supabaseClient
      .from('post_likes')
      .select('post_id')
      .eq('user_email', userEmail)
      .in('post_id', ids);
    if (error) throw error;
    return new Set((data || []).map(r => r.post_id));
  } catch (e) {
    console.error('No se pudieron cargar los "me gusta" del usuario:', e);
    return new Set();
  }
}

// Genera el HTML del botón de "me gusta" (corazón + contador + leyenda "Cancelar like").
// isLiked pinta el corazón rojo relleno; al pasar el cursor sobre un corazón ya marcado
// aparece la leyenda, y desaparece al quitar el cursor. userEmail/userName son quien da el like.
function ccLikeButtonHtml(id, likes, isLiked, userEmail, userName) {
  const count = likes || 0;
  const ue = JSON.stringify(userEmail || '');
  const un = JSON.stringify(userName || '');
  return `
    <div class="relative" data-like-wrapper onmouseenter="ccLikeHover(this, true)" onmouseleave="ccLikeHover(this, false)">
      <button
        type="button"
        data-like-btn
        data-liked="${isLiked ? 'true' : 'false'}"
        onclick="ccToggleLike(this, ${id}, ${count}, ${isLiked ? 'true' : 'false'}, ${ue}, ${un})"
        title="Me gusta"
        class="flex items-center gap-1.5 font-semibold transition ${isLiked ? 'text-red-500' : 'hover:text-red-500'}">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5 flex-shrink-0">
          <path data-heart-icon fill="${isLiked ? 'currentColor' : 'none'}" d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z"></path>
        </svg>
        <span id="likes-count-${id}">${count}</span>
      </button>
      <span data-like-tooltip class="hidden pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 whitespace-nowrap bg-gray-900 text-white text-[11px] font-semibold px-2 py-1 rounded-md shadow-lg z-10">Cancelar like</span>
    </div>
  `;
}

// Muestra/oculta la leyenda "Cancelar like" al pasar el cursor sobre el corazón,
// solo cuando la publicación ya está marcada como "me gusta" (data-liked="true").
function ccLikeHover(wrapper, show) {
  const btn = wrapper.querySelector('[data-like-btn]');
  const tooltip = wrapper.querySelector('[data-like-tooltip]');
  if (!btn || !tooltip) return;
  tooltip.classList.toggle('hidden', !(show && btn.getAttribute('data-liked') === 'true'));
}

// Alterna el "me gusta" de una publicación para el usuario actual: si ya la había marcado,
// se lo quita (borra su fila en post_likes y resta 1, corazón vuelve a estar vacío); si no,
// se lo agrega (inserta fila y suma 1, corazón queda relleno en rojo). Así cada usuario solo
// puede tener un "me gusta" activo por publicación. Actualiza pantalla de forma optimista.
// btn: el <button> pulsado. id: id del post. currentLikes: contador actual mostrado. isLiked: si ya tenía like.
// userEmail/userName: identidad de quien da el like.
async function ccToggleLike(btn, id, currentLikes, isLiked, userEmail, userName) {
  if (!userEmail) return;

  const counterElement = document.getElementById(`likes-count-${id}`);
  const heartPath = btn.querySelector('[data-heart-icon]');
  const newLiked = !isLiked;
  const newLikes = Math.max(0, currentLikes + (isLiked ? -1 : 1));

  const updateUI = (likesCount, likedState) => {
    if (counterElement) counterElement.textContent = likesCount;
    btn.setAttribute('data-liked', likedState.toString());
    btn.classList.toggle('text-red-500', likedState);
    btn.classList.toggle('hover:text-red-500', !likedState);
    if (heartPath) heartPath.setAttribute('fill', likedState ? 'currentColor' : 'none');
    btn.setAttribute('onclick', `ccToggleLike(this, ${id}, ${likesCount}, ${likedState}, ${JSON.stringify(userEmail)}, ${JSON.stringify(userName)})`);
    const wrapper = btn.closest('[data-like-wrapper]');
    if (wrapper) ccLikeHover(wrapper, false);
  };

  // 1. Pintado optimista
  updateUI(newLikes, newLiked);

  try {
    let response;
    if (isLiked) {
      response = await supabaseClient
        .from('post_likes')
        .delete()
        .eq('post_id', id)
        .eq('user_email', userEmail);
    } else {
      response = await supabaseClient
        .from('post_likes')
        .insert({ post_id: id, user_email: userEmail, user_name: userName });
    }

    // 2. Si Supabase devuelve error (RLS o duplicado), revertir UI
    if (response.error) {
      console.error('Error en post_likes Supabase:', response.error.message);
      updateUI(currentLikes, isLiked);
      return;
    }

    // 3. Si todo salió bien, actualizar el total en la tabla posts
    await supabaseClient.from('posts').update({ likes: newLikes }).eq('id', id);

  } catch (err) {
    console.error('Error inesperado de red:', err);
    updateUI(currentLikes, isLiked);
  }
}

// ============================================================
// ===== BOTONES DE LOS COMENTARIOS (Me gusta / Responder / Repostear / Compartir) =====
// Mismo patrón que arriba, aplicado a la tabla `comments` en vez de `posts`.
// Usa las funciones SQL comment_like_counts, comment_reply_counts y comment_repost_counts
// (ver supabase/sql/paso11_comentarios_acciones.sql). Los ids de DOM se prefijan con "c-"
// para no chocar con los de las publicaciones cuando conviven en la misma página.
// ============================================================

// Cuántos "me gusta" tiene cada comentario de la lista. Devuelve { [comment_id]: cantidad }.
async function ccFetchCommentLikeCounts(commentIds) {
  const ids = Array.from(new Set((commentIds || []).filter(id => id !== null && id !== undefined)));
  if (!ids.length) return {};
  try {
    const { data, error } = await supabaseClient.rpc('comment_like_counts', { comment_ids: ids });
    if (error) throw error;
    const map = {};
    (data || []).forEach(r => { map[r.comment_id] = Number(r.total) || 0; });
    return map;
  } catch (e) {
    console.error('No se pudieron cargar los "me gusta" de los comentarios:', e);
    return {};
  }
}

// Cuántas respuestas tiene cada comentario de la lista. Devuelve { [comment_id]: cantidad }.
async function ccFetchCommentReplyCounts(commentIds) {
  const ids = Array.from(new Set((commentIds || []).filter(id => id !== null && id !== undefined)));
  if (!ids.length) return {};
  try {
    const { data, error } = await supabaseClient.rpc('comment_reply_counts', { comment_ids: ids });
    if (error) throw error;
    const map = {};
    (data || []).forEach(r => { map[r.comment_id] = Number(r.total) || 0; });
    return map;
  } catch (e) {
    console.error('No se pudieron cargar las respuestas de los comentarios:', e);
    return {};
  }
}

// Cuántas veces fue reposteado cada comentario de la lista. Devuelve { [comment_id]: cantidad }.
async function ccFetchCommentRepostCounts(commentIds) {
  const ids = Array.from(new Set((commentIds || []).filter(id => id !== null && id !== undefined)));
  if (!ids.length) return {};
  try {
    const { data, error } = await supabaseClient.rpc('comment_repost_counts', { comment_ids: ids });
    if (error) throw error;
    const map = {};
    (data || []).forEach(r => { map[r.comment_id] = Number(r.total) || 0; });
    return map;
  } catch (e) {
    console.error('No se pudieron cargar los reposts de los comentarios:', e);
    return {};
  }
}

// Qué comentarios de la lista ya tienen "me gusta" del usuario actual (para pintar el corazón).
async function ccFetchMyCommentLikes(commentIds, userEmail) {
  const ids = Array.from(new Set((commentIds || []).filter(id => id !== null && id !== undefined)));
  if (!ids.length || !userEmail) return new Set();
  try {
    const { data, error } = await supabaseClient
      .from('comment_likes')
      .select('comment_id')
      .eq('user_email', userEmail)
      .in('comment_id', ids);
    if (error) throw error;
    return new Set((data || []).map(r => r.comment_id));
  } catch (e) {
    console.error('No se pudieron cargar los "me gusta" del usuario en comentarios:', e);
    return new Set();
  }
}

// Qué comentarios de la lista ya reposteó (sin cita) el usuario actual (para pintar el icono en verde).
async function ccFetchMyCommentReposts(commentIds, userEmail) {
  const ids = Array.from(new Set((commentIds || []).filter(id => id !== null && id !== undefined)));
  if (!ids.length || !userEmail) return new Set();
  try {
    const { data, error } = await supabaseClient
      .from('posts')
      .select('repost_of_comment_id')
      .eq('user_email', userEmail)
      .is('quote_text', null)
      .in('repost_of_comment_id', ids);
    if (error) throw error;
    return new Set((data || []).map(r => r.repost_of_comment_id));
  } catch (e) {
    console.error('No se pudieron cargar los reposts propios de comentarios:', e);
    return new Set();
  }
}

// Genera el HTML de la barra de acciones de un comentario: Me gusta, Responder, Repostear y Compartir.
function ccCommentActionsHtml(c, v) {
  const id = c.id;
  const ue = JSON.stringify(v.userEmail || '');
  const un = JSON.stringify(v.userName || '');
  const menuBtnCls = 'w-full flex items-center gap-2 text-left px-4 py-2.5 text-xs hover:bg-gray-100 dark:hover:bg-slate-800 transition';
  const repostIcon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-3.5 h-3.5 flex-shrink-0"><path d="m17 2 4 4-4 4"></path><path d="M3 11v-1a4 4 0 0 1 4-4h14"></path><path d="m7 22-4-4 4-4"></path><path d="M21 13v1a4 4 0 0 1-4 4H3"></path></svg>';
  const quoteIcon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-3.5 h-3.5 flex-shrink-0"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>';

  return `
    <div class="flex items-center gap-4 mt-1.5 text-xs text-gray-500 dark:text-gray-400">

      <div class="relative" data-like-wrapper onmouseenter="ccLikeHover(this, true)" onmouseleave="ccLikeHover(this, false)">
        <button type="button" data-like-btn data-liked="${v.isLiked ? 'true' : 'false'}"
          onclick="ccToggleCommentLike(this, ${id}, ${v.likes || 0}, ${v.isLiked ? 'true' : 'false'}, ${ue}, ${un})"
          title="Me gusta" class="flex items-center gap-1 font-semibold transition ${v.isLiked ? 'text-red-500' : 'hover:text-red-500'}">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 flex-shrink-0">
            <path data-heart-icon fill="${v.isLiked ? 'currentColor' : 'none'}" d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z"></path>
          </svg>
          <span id="c-likes-count-${id}">${v.likes || 0}</span>
        </button>
        <span data-like-tooltip class="hidden pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 whitespace-nowrap bg-gray-900 text-white text-[11px] font-semibold px-2 py-1 rounded-md shadow-lg z-10">Cancelar like</span>
      </div>

      <button type="button" onclick="ccReplyToComment(${id})" title="Responder" class="flex items-center gap-1 font-semibold hover:text-blue-600 transition">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 flex-shrink-0"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z"></path></svg>
        <span id="c-replies-count-${id}">${v.replies || 0}</span>
      </button>

      <div class="relative">
        <button type="button" data-repost-toggle onclick="ccToggleCommentRepostMenu(${id})" title="Repostear"
          class="flex items-center gap-1 font-semibold hover:text-green-600 transition ${v.isReposted ? 'text-green-600' : ''}">
          ${repostIcon}
          <span id="c-reposts-count-${id}">${v.reposts || 0}</span>
        </button>
        <div id="c-repost-menu-${id}" class="hidden absolute left-0 bottom-full mb-2 w-44 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl shadow-lg overflow-hidden z-40">
          ${v.isReposted ? `
            <button onclick="ccUndoCommentRepost(${id})" class="${menuBtnCls}">${repostIcon} Deshacer</button>
            <button onclick="ccQuoteComment(${id})" class="${menuBtnCls}">${quoteIcon} Citar</button>
          ` : `
            <button onclick="ccRepostComment(${id})" class="${menuBtnCls}">${repostIcon} Repostear</button>
            <button onclick="ccQuoteComment(${id})" class="${menuBtnCls}">${quoteIcon} Citar</button>
          `}
        </div>
      </div>

      <button type="button" onclick="ccShareComment(${id}, ${JSON.stringify(v.postId)})" title="Compartir" class="hover:text-blue-600 transition">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 flex-shrink-0"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>
      </button>

    </div>
  `;
}

// Cierra cualquier menú de repost de comentario abierto si se hace clic fuera de él.
document.addEventListener('click', (e) => {
  const isToggleButton = e.target.closest('[data-repost-toggle]');
  const isInsideMenu = e.target.closest('[id^="c-repost-menu-"]');
  if (!isToggleButton && !isInsideMenu) {
    document.querySelectorAll('[id^="c-repost-menu-"]').forEach(menu => menu.classList.add('hidden'));
  }
});

function ccToggleCommentRepostMenu(commentId) {
  const menu = document.getElementById(`c-repost-menu-${commentId}`);
  if (!menu) return;
  document.querySelectorAll('[id^="c-repost-menu-"]').forEach(m => { if (m !== menu) m.classList.add('hidden'); });
  menu.classList.toggle('hidden');
}

// Alterna el "me gusta" de un comentario (mismo mecanismo que ccToggleLike, sobre comment_likes).
async function ccToggleCommentLike(btn, id, currentLikes, isLiked, userEmail, userName) {
  if (!userEmail) return;

  const counterElement = document.getElementById(`c-likes-count-${id}`);
  const heartPath = btn.querySelector('[data-heart-icon]');
  const newLiked = !isLiked;
  const newLikes = Math.max(0, currentLikes + (isLiked ? -1 : 1));

  if (counterElement) counterElement.textContent = newLikes;
  btn.setAttribute('data-liked', newLiked.toString());
  btn.classList.toggle('text-red-500', newLiked);
  btn.classList.toggle('hover:text-red-500', !newLiked);
  if (heartPath) heartPath.setAttribute('fill', newLiked ? 'currentColor' : 'none');
  btn.setAttribute('onclick', `ccToggleCommentLike(this, ${id}, ${newLikes}, ${newLiked}, ${JSON.stringify(userEmail)}, ${JSON.stringify(userName)})`);
  const wrapper = btn.closest('[data-like-wrapper]');
  if (wrapper) ccLikeHover(wrapper, false);

  if (isLiked) {
    await supabaseClient.from('comment_likes').delete().eq('comment_id', id).eq('user_email', userEmail);
  } else {
    await supabaseClient.from('comment_likes').insert({ comment_id: id, user_email: userEmail, user_name: userName });
  }
}

// Abre la ventana de responder a un comentario (delegado a la página, que sabe cómo mostrar su propio hilo).
function ccReplyToComment(commentId) {
  if (typeof window.onReplyToComment === 'function') window.onReplyToComment(commentId);
}

async function ccRepostComment(commentId) {
  if (typeof window.onRepostComment === 'function') await window.onRepostComment(commentId, null);
  ccToggleCommentRepostMenu(commentId);
}

async function ccUndoCommentRepost(commentId) {
  if (typeof window.onUndoCommentRepost === 'function') await window.onUndoCommentRepost(commentId);
  ccToggleCommentRepostMenu(commentId);
}

async function ccQuoteComment(commentId) {
  const quoteText = prompt('Escribe tu cita para este repost:');
  ccToggleCommentRepostMenu(commentId);
  if (quoteText === null) return;
  if (typeof window.onRepostComment === 'function') await window.onRepostComment(commentId, quoteText.trim() || null);
}

function ccShareComment(commentId, postId) {
  const url = `${window.location.origin}/publicacion.html?id=${encodeURIComponent(postId)}#comentario-${commentId}`;
  if (navigator.share) {
    navigator.share({ title: 'ByGether', url });
  } else {
    navigator.clipboard.writeText(url);
    if (typeof showToast === 'function') showToast('Enlace del comentario copiado');
    else alert('¡Enlace copiado!');
  }
}
