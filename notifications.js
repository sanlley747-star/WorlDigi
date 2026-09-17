// ===== SISTEMA DE NOTIFICACIONES DE BYKONET =====
// Comentarios, likes, citas y compartidos sobre las publicaciones del usuario.
// Requiere que la página ya haya definido `supabaseClient` antes de cargar este archivo.
// Requiere en el HTML: #notifBellBtn, #notifBadge, #notifPanel, #notifList

let notifCurrentEmail = null;
let notifChannel = null;

function notifTypeText(n) {
  const who = n.actor_name || (n.actor_email ? n.actor_email.split('@')[0] : 'Alguien');
  switch (n.type) {
    case 'comment': return `<strong>${who}</strong> comentó tu publicación`;
    case 'like': return `<strong>${who}</strong> le dio me gusta a tu publicación`;
    case 'quote': return `<strong>${who}</strong> citó tu publicación`;
    case 'share': return `<strong>${who}</strong> compartió tu publicación`;
    default: return `<strong>${who}</strong> interactuó con tu publicación`;
  }
}

function updateNotifBadge(count) {
  const badge = document.getElementById('notifBadge');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

async function refreshNotifCount() {
  if (!notifCurrentEmail) return;
  const { count, error } = await supabaseClient
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_email', notifCurrentEmail)
    .eq('is_read', false);

  if (!error) updateNotifBadge(count || 0);
}

async function loadNotifList() {
  const list = document.getElementById('notifList');
  if (!list || !notifCurrentEmail) return;

  const { data, error } = await supabaseClient
    .from('notifications')
    .select('*')
    .eq('recipient_email', notifCurrentEmail)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error || !data || !data.length) {
    list.innerHTML = '<p class="p-4 text-sm text-gray-400 dark:text-gray-500 text-center">Aún no tienes notificaciones.</p>';
    return;
  }

  list.innerHTML = data.map(n => `
    <button onclick="handleNotifClick(${n.post_id}, ${n.id})" class="w-full text-left p-3 text-sm flex items-start gap-2 hover:bg-gray-50 dark:hover:bg-slate-800 transition ${n.is_read ? '' : 'bg-blue-50 dark:bg-slate-800/70'}">
      <span class="flex-1 text-gray-700 dark:text-gray-200">${notifTypeText(n)}</span>
      <span class="text-xs text-gray-400 whitespace-nowrap">${typeof formatCompactTime === 'function' ? formatCompactTime(n.created_at) : ''}</span>
    </button>
  `).join('');
}

function handleNotifClick(postId, notifId) {
  toggleNotifPanel(true);
  supabaseClient.from('notifications').update({ is_read: true }).eq('id', notifId).then(() => refreshNotifCount());
  if (postId && typeof openPostViewer === 'function') {
    openPostViewer(postId);
  }
}

async function markAllNotifsRead() {
  if (!notifCurrentEmail) return;
  await supabaseClient
    .from('notifications')
    .update({ is_read: true })
    .eq('recipient_email', notifCurrentEmail)
    .eq('is_read', false);
  updateNotifBadge(0);
}

function toggleNotifPanel(forceClose) {
  const panel = document.getElementById('notifPanel');
  if (!panel) return;
  const willOpen = forceClose ? false : panel.classList.contains('hidden');

  if (willOpen) {
    panel.classList.remove('hidden');
    loadNotifList();
    markAllNotifsRead();
  } else {
    panel.classList.add('hidden');
  }
}

document.addEventListener('click', (e) => {
  const panel = document.getElementById('notifPanel');
  const btn = document.getElementById('notifBellBtn');
  if (!panel || !btn || panel.classList.contains('hidden')) return;
  if (!panel.contains(e.target) && !btn.contains(e.target)) {
    panel.classList.add('hidden');
  }
});

// Llamar una vez que se conoce el email del usuario logueado.
function initNotifications(email) {
  notifCurrentEmail = email || null;
  if (!notifCurrentEmail) return;

  refreshNotifCount();

  if (notifChannel) {
    supabaseClient.removeChannel(notifChannel);
  }

  notifChannel = supabaseClient
    .channel('notifications-' + notifCurrentEmail)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'notifications',
      filter: `recipient_email=eq.${notifCurrentEmail}`
    }, () => refreshNotifCount())
    .subscribe();
}
