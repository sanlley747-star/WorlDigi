// Navegación hacia el muro de búsqueda del dashboard.
// No contiene lógica de búsqueda ni modifica la URL de la página de origen.
(function () {
  'use strict';

  const pageNames = {
    'perfil.html': 'perfil',
    'notificaciones.html': 'notificaciones',
    'conexiones.html': 'conexiones',
    'settings.html': 'settings'
  };

  function initSearchNav() {
    const pageName = pageNames[window.location.pathname.split('/').pop()];
    if (!pageName) return;

    document.querySelectorAll('[data-search-nav]').forEach((button) => {
      button.addEventListener('click', () => {
        window.location.href = 'dashboard.html?buscar=1&origen=' + encodeURIComponent(pageName);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSearchNav, { once: true });
  } else {
    initSearchNav();
  }
})();
