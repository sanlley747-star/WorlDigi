// ===== CUADRO DE PUBLICAR: indicador dinámico del límite de 280 caracteres =====
// Archivo aislado: solo dibuja el indicador (#composerLimit) junto al botón Publicar del dashboard.
//   - Aparece al escribir la primera letra: un cuadrado cuyo borde se va llenando en AZUL.
//   - Cuando faltan 30 caracteres o menos: pasa a AMARILLO y muestra cuántos faltan.
//   - Al llegar a 0: el borde se cierra por completo, pasa a ROJO y muestra 0.
//   - Si se borra todo el texto (o se publica), desaparece.
(function () {
  var ta = document.getElementById('postContent');
  var box = document.getElementById('composerLimit');
  if (!ta || !box) return;

  var bar = box.querySelector('.cl-bar');
  var num = box.querySelector('.cl-num');
  var MAX = ta.maxLength > 0 ? ta.maxLength : 280;
  var WARN = 30;

  var css = [
    '.cl-wrap{position:relative;width:32px;height:32px;flex:0 0 auto;opacity:0;transform:scale(.85);',
    '  transition:opacity .15s ease,transform .15s ease;pointer-events:none}',
    '.cl-wrap.cl-on{opacity:1;transform:none}',
    '.cl-wrap svg{display:block;width:100%;height:100%}',
    '.cl-track{fill:none;stroke:#e2e8f0;stroke-width:3}',
    'html.dark .cl-track{stroke:#334155}',
    '.cl-bar{fill:none;stroke:#3b82f6;stroke-width:3;stroke-linecap:round;stroke-dasharray:0 100;',
    '  transition:stroke-dasharray .12s linear,stroke .15s ease}',
    '.cl-wrap.cl-warn .cl-bar{stroke:#eab308}',
    '.cl-wrap.cl-end .cl-bar{stroke:#ef4444}',
    '.cl-num{position:absolute;top:0;right:0;bottom:0;left:0;display:flex;align-items:center;justify-content:center;',
    '  font-size:.75rem;font-weight:700;line-height:1;color:#64748b;opacity:0;transition:opacity .15s ease}',
    'html.dark .cl-num{color:#94a3b8}',
    '.cl-wrap.cl-warn .cl-num{opacity:1}',
    '.cl-wrap.cl-end .cl-num,html.dark .cl-wrap.cl-end .cl-num{color:#ef4444}'
  ].join('\n');
  var style = document.createElement('style');
  style.id = 'composerLimitStyles';
  style.textContent = css;
  document.head.appendChild(style);

  function update() {
    var len = ta.value.length;
    if (len === 0) {
      box.classList.remove('cl-on', 'cl-warn', 'cl-end');
      bar.style.strokeDasharray = '0 100';
      num.textContent = '';
      return;
    }
    var left = Math.max(0, MAX - len);
    var pct = Math.min(100, (len / MAX) * 100);

    box.classList.add('cl-on');
    bar.style.strokeDasharray = pct + ' 100';
    box.classList.toggle('cl-warn', left <= WARN);
    box.classList.toggle('cl-end', left === 0);
    num.textContent = left <= WARN ? String(left) : '';
    box.setAttribute('aria-label', 'Te quedan ' + left + ' caracteres');
  }

  ta.addEventListener('input', update);
  window.addEventListener('pageshow', update);
  // Al publicar, el texto se vacía por código (no dispara "input"): el indicador se oculta
  var btn = document.getElementById('btnPublish');
  if (btn) btn.addEventListener('click', function () { setTimeout(update, 0); });

  update();
})();
