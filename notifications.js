// ===== SISTEMA DE NOTIFICACIONES DE BYKONET (badge de la campanita) =====
// El listado detallado vive en notificaciones.html (mural propio del usuario).
// Este archivo solo mantiene actualizada la burbujita de la campanita.
// Requiere que la página ya haya definido `supabaseClient` antes de cargar este archivo.
// Requiere en el HTML: #notifBadge

let notifCurrentEmail = null;
let notifChannel = null;

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
