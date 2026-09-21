// ===== CUADRO DE PUBLICAR: el área de texto crece a medida que se escribe =====
// Archivo aislado: solo ajusta la altura del área de texto del dashboard (#postContent).
// Mantiene como mínimo su tamaño natural y, al publicar (se vacía el texto), vuelve a ese tamaño.
(function () {
  var ta = document.getElementById('postContent');
  if (!ta) return;

  ta.style.overflowY = 'hidden';
  var lastWidth = -1;

  function grow() {
    ta.style.height = 'auto';                      // tamaño natural (el de siempre)
    // Si la página aún está oculta (por ejemplo mientras se verifica la sesión) no se puede medir:
    // se deja el tamaño natural y se recalcula cuando el área de texto se vuelva visible.
    if (!ta.offsetParent || ta.scrollHeight === 0) return;
    ta.style.height = ta.scrollHeight + 'px';      // crece según el contenido
  }

  ta.addEventListener('input', grow);
  window.addEventListener('resize', grow);         // al cambiar el ancho, el texto se reacomoda
  window.addEventListener('load', grow);
  window.addEventListener('pageshow', grow);

  // Cuando el área de texto pasa de oculta a visible (o cambia de ancho) se vuelve a medir
  if (window.ResizeObserver) {
    new ResizeObserver(function () {
      var w = ta.offsetWidth;
      if (w !== lastWidth) { lastWidth = w; grow(); }
    }).observe(ta);
  }

  // Al publicar, el texto se vacía por código (no dispara "input"): se vuelve al tamaño mínimo
  var btn = document.getElementById('btnPublish');
  if (btn) btn.addEventListener('click', function () { setTimeout(grow, 0); });

  grow();
})();
