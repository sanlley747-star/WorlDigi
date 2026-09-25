// youtube-embed.js — Reproductor de YouTube dentro de las publicaciones de ByGether.
// Uso: ytEmbedsFor(textoDelPost) devuelve el HTML del reproductor (o '' si no hay enlaces de YouTube).
// Técnica "facade": se muestra la miniatura y solo al dar play se carga el iframe (feed rápido y sin rastreo hasta que el usuario decide).
(function () {
  const MAX_EMBEDS_POR_POST = 1;
  const ID_RE = /^[A-Za-z0-9_-]{11}$/;

  function parseStart(u) {
    const raw = u.searchParams.get('t') || u.searchParams.get('start');
    if (!raw) return 0;
    if (/^\d+$/.test(raw)) return parseInt(raw, 10);
    const m = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
    if (!m) return 0;
    return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
  }

  // Devuelve { id, start, short } o null si la URL no es un video de YouTube
  function parseYouTube(url) {
    let u;
    try { u = new URL(url); } catch (e) { return null; }
    const host = u.hostname.replace(/^(www|m|music)\./, '');
    let id = null, short = false;
    if (host === 'youtu.be') {
      id = u.pathname.slice(1).split('/')[0];
    } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      if (u.pathname === '/watch') id = u.searchParams.get('v');
      else {
        const m = u.pathname.match(/^\/(shorts|embed|live|v)\/([^/?#]+)/);
        if (m) { id = m[2]; short = m[1] === 'shorts'; }
      }
    }
    if (!id || !ID_RE.test(id)) return null;
    return { id, start: parseStart(u), short };
  }

  function ensureStyles() {
    if (document.getElementById('yt-embed-styles')) return;
    const s = document.createElement('style');
    s.id = 'yt-embed-styles';
    s.textContent = `
      .yt-embed { margin-top: .5rem; }
      .yt-frame { position: relative; width: 100%; aspect-ratio: 16 / 9; background: #000; border-radius: .75rem; overflow: hidden; }
      .yt-frame.yt-short { aspect-ratio: 9 / 16; max-width: 320px; }
      .yt-frame iframe, .yt-frame .yt-play { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
      .yt-play { padding: 0; cursor: pointer; background: #000 center / cover no-repeat; display: flex; align-items: center; justify-content: center; }
      .yt-play::after { content: ''; width: 68px; height: 48px; border-radius: 12px; background: rgba(0,0,0,.72) url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='white'><path d='M9 6.5v11l9-5.5z'/></svg>") center / 30px no-repeat; transition: background-color .15s; }
      .yt-play:hover::after, .yt-play:focus-visible::after { background-color: #ff0000; }
      .yt-meta { margin-top: .25rem; font-size: .75rem; }
      .yt-meta a { color: #6b7280; }
      .yt-meta a:hover { text-decoration: underline; }
      /* Modo teatro (respaldo cuando el navegador no permite fullscreen de elementos, p. ej. iPhone) */
    `;
    document.head.appendChild(s);
  }


  function renderEmbed(v) {
    const thumb = `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`;
    const watch = `https://www.youtube.com/watch?v=${v.id}${v.start ? '&t=' + v.start + 's' : ''}`;
    return `<div class="yt-embed" data-yt-id="${v.id}" data-yt-start="${v.start}">
      <div class="yt-frame${v.short ? ' yt-short' : ''}">
        <button type="button" class="yt-play" style="background-image:url('${thumb}')" aria-label="Reproducir video"></button>
      </div>
      <div class="yt-meta"><a href="${watch}" target="_blank" rel="noopener noreferrer">YouTube</a></div>
    </div>`;
  }

  // Quita la puntuación que suele quedar pegada al final de un enlace escrito en un texto: "(url)" o "url."
  function trimUrl(url) { return url.replace(/[.,;:!?)\]}'"]+$/, ''); }

  // Videos que se van a mostrar como reproductor en un post (únicos, hasta el máximo permitido)
  function embeddedVideos(text) {
    const vistos = new Set();
    const out = [];
    const urls = String(text).match(/https?:\/\/[^\s<>"]+/g) || [];
    for (const url of urls) {
      const v = parseYouTube(trimUrl(url));
      if (!v || vistos.has(v.id)) continue;
      vistos.add(v.id);
      out.push(v);
      if (out.length >= MAX_EMBEDS_POR_POST) break;
    }
    return out;
  }

  // API pública
  window.ytEmbedsFor = function (text) {
    if (!text) return '';
    const videos = embeddedVideos(text);
    if (!videos.length) return '';
    ensureStyles();
    return videos.map(renderEmbed).join('');
  };

  // Devuelve el texto del post SIN el enlace del video que ya se muestra como reproductor.
  // Solo afecta a lo que se ve: el texto guardado en la base de datos no cambia (el reproductor lo necesita).
  window.ytStripLink = function (text) {
    if (!text) return text;
    const ids = new Set(embeddedVideos(text).map((v) => v.id));
    if (!ids.size) return text;
    let removed = false;
    let out = String(text).replace(/https?:\/\/[^\s<>"]+/g, function (url) {
      const v = parseYouTube(trimUrl(url));
      if (v && ids.has(v.id)) {
        removed = true;
        // conserva solo los cierres pegados al enlace (")", comillas) para que el paréntesis vacío "()" se limpie abajo
        return url.slice(trimUrl(url).length).replace(/[.,;:!?]/g, '');
      }
      return url;
    });
    if (!removed) return text;
    return out
      .replace(/\(\s*\)/g, '')                     // paréntesis que quedaron vacíos
      .replace(/[ \t]*[—–-][ \t]*(?=\n|$)/g, '')    // separador (" —") que quedó colgando al final de línea
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/[ \t]+$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      // Posts de canales de YouTube: la última línea "Canal: ESPN" pasa a cerrar el titular como "… - ESPN"
      .replace(/\s*\n+\s*Canal:[ \t]*([^\n]+?)[ \t]*$/i, ' - $1')
      .replace(/\s*\n+\s*Canal:[ \t]*$/i, '')                 // "Canal:" sin nombre: se elimina
      .replace(/^Canal:[ \t]*([^\n]+?)[ \t]*$/i, '$1');        // post sin titular: solo queda el medio
  };

  // true si el post tiene un video de YouTube y su imagen es la miniatura de YouTube (el reproductor ya la muestra)
  window.ytOwnsImage = function (text, imageUrl) {
    if (!text || !imageUrl || !/(^|\/\/)i\.ytimg\.com\//.test(imageUrl)) return false;
    const urls = String(text).match(/https?:\/\/[^\s<>"]+/g) || [];
    return urls.some((u) => parseYouTube(trimUrl(u)));
  };

  // Auto-pausa: si el video se está reproduciendo y el usuario hace scroll de modo que
  // queda menos de la mitad visible, se pausa (no se reanuda solo al volver).
  const YT_ORIGIN = 'https://www.youtube-nocookie.com';
  const VISIBLE_MIN = 0.5;

  function pauseFrame(frame) {
    const iframe = frame.querySelector('iframe');
    if (!iframe || !iframe.contentWindow) return;
    try {
      iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }), YT_ORIGIN);
    } catch (e) { /* el reproductor aún no cargó: no hay nada que pausar */ }
  }

  const visibilityObserver = ('IntersectionObserver' in window)
    ? new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.intersectionRatio < VISIBLE_MIN) pauseFrame(en.target);
        });
      }, { threshold: [0, VISIBLE_MIN] })
    : null;

  function loadPlayer(box, autoplay) {
    const frame = box.querySelector('.yt-frame');
    if (frame.querySelector('iframe')) return;
    const id = box.dataset.ytId;
    const start = parseInt(box.dataset.ytStart, 10) || 0;
    const iframe = document.createElement('iframe');
    iframe.src = `https://www.youtube-nocookie.com/embed/${id}?rel=0&playsinline=1&modestbranding=1&enablejsapi=1&origin=${encodeURIComponent(location.origin)}${autoplay ? '&autoplay=1' : ''}${start ? '&start=' + start : ''}`;
    iframe.title = 'Reproductor de YouTube';
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen';
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    iframe.loading = 'lazy';
    frame.querySelector('.yt-play').replaceWith(iframe);
    if (visibilityObserver) visibilityObserver.observe(frame);
  }

  function isFullscreen() { return document.fullscreenElement || document.webkitFullscreenElement; }

  function exitTheater(frame) {
    frame.classList.remove('yt-theater');
    document.body.style.overflow = '';
  }

  function toggleExpand(box) {
    const frame = box.querySelector('.yt-frame');
    loadPlayer(box, true);
    if (frame.classList.contains('yt-theater')) { exitTheater(frame); return; }
    if (isFullscreen()) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
    const req = frame.requestFullscreen || frame.webkitRequestFullscreen;
    if (req) {
      const p = req.call(frame);
      if (p && p.catch) p.catch(() => { frame.classList.add('yt-theater'); document.body.style.overflow = 'hidden'; });
    } else {
      frame.classList.add('yt-theater');
      document.body.style.overflow = 'hidden';
    }
  }

  // Captura el clic antes de que llegue a la tarjeta del post (que abre la publicación al hacer clic)
  document.addEventListener('click', function (e) {
    const box = e.target.closest && e.target.closest('.yt-embed');
    if (!box) return;
    e.stopPropagation();
    if (e.target.closest('.yt-play')) { loadPlayer(box, true); }
  }, true);

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    const t = document.querySelector('.yt-frame.yt-theater');
    if (t) exitTheater(t);
  });
})();
