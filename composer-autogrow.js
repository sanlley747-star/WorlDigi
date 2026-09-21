// ===== CUADRO DE PUBLICAR: el área de texto crece a medida que se escribe =====
// Archivo aislado: solo ajusta la altura del área de texto del dashboard (#postContent).
// Mantiene como mínimo su tamaño actual y, al publicar (se vacía el texto), vuelve a ese tamaño.
(function () {
  var ta = document.getElementById('postContent');
  if (!ta) return;

  ta.style.overflowY = 'hidden';

  function grow() {
    ta.style.height = 'auto';                      // tamaño mínimo natural (el de siempre)
    ta.style.height = ta.scrollHeight + 'px';      // crece según el contenido
  }

  ta.addEventListener('input', grow);
  window.addEventListener('resize', grow);         // al cambiar el ancho, el texto se reacomoda

  // Al publicar, el texto se vacía por código (no dispara "input"): se vuelve al tamaño mínimo
  var btn = document.getElementById('btnPublish');
  if (btn) btn.addEventListener('click', function () { setTimeout(grow, 0); });

  grow();
})();
