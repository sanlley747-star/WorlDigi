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

  // Actualización optimista en pantalla
  if (counterElement) counterElement.textContent = newLikes;
  btn.setAttribute('data-liked', newLiked.toString());
  btn.classList.toggle('text-red-500', newLiked);
  btn.classList.toggle('hover:text-red-500', !newLiked);
  if (heartPath) heartPath.setAttribute('fill', newLiked ? 'currentColor' : 'none');
  btn.setAttribute('onclick', `ccToggleLike(this, ${id}, ${newLikes}, ${newLiked}, ${JSON.stringify(userEmail)}, ${JSON.stringify(userName)})`);
  const wrapper = btn.closest('[data-like-wrapper]');
  if (wrapper) ccLikeHover(wrapper, false);

  await supabaseClient.from('posts').update({ likes: newLikes }).eq('id', id);

  if (isLiked) {
    await supabaseClient.from('post_likes').delete().eq('post_id', id).eq('user_email', userEmail);
  } else {
    await supabaseClient.from('post_likes').insert({ post_id: id, user_email: userEmail, user_name: userName });
  }
}
