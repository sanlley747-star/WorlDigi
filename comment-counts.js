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
