// youtube-embed.js — Reproductor de YouTube dentro de las publicaciones de ByGether.
// Uso: ytEmbedsFor(textoDelPost) devuelve el HTML del reproductor (o '' si no hay enlaces de YouTube).
// Técnica "facade": se muestra la miniatura y solo al dar play se carga el iframe (feed rápido y sin rastreo hasta que el usuario decide).
(function () {
  const MAX_EMBEDS_POR_POST = 1;
  const ID_RE = /^[A-Za-z0-9_-]{11}$/;
  const ICON_EXPAND = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M3 3l6 6M16 3h5v5M21 3l-6 6M8 21H3v-5M3 21l6-6M16 21h5v-5M21 21l-6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

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
      .yt-expand { display: none; position: absolute; right: .5rem; bottom: .5rem; width: 42px; height: 42px; border: 0; border-radius: .5rem; background: rgba(0,0,0,.72); color: #fff; align-items: center; justify-content: center; cursor: pointer; z-index: 3; }
      .yt-expand svg { width: 22px; height: 22px; }
      @media (max-width: 767px) { .yt-expand { display: flex; } }
      .yt-frame.yt-theater { position: fixed; inset: 0; z-index: 9999; width: 100vw; height: 100vh; aspect-ratio: auto; border-radius: 0; }
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
        <button type="button" class="yt-expand" aria-label="Pantalla completa" title="Pantalla completa">${ICON_EXPAND}</button>
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

  // Precarga cercana, reproducción al entrar y pausa/reanudación por visibilidad.
  const YT_ORIGIN = 'https://www.youtube-nocookie.com';
  const VISIBLE_MIN = 0.5;
  const PLAY_DELAY_MS = 150;
  const MAX_PRELOADS = 3;
  const observedFrames = new WeakSet();
  const visibilityRatios = new WeakMap();
  const playTimers = new WeakMap();
  const preloadedFrames = new Set();

  function postPlayerCommand(frame, func) {
    const iframe = frame && frame.querySelector('iframe');
    if (!iframe || !iframe.contentWindow) return;
    try {
      iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args: [] }), YT_ORIGIN);
    } catch (e) { /* el reproductor aún no está listo */ }
  }

  function pauseFrame(frame) {
    postPlayerCommand(frame, 'pauseVideo');
  }

  function pauseOtherFrames(activeFrame) {
    document.querySelectorAll('.yt-frame').forEach(function (frame) {
      if (frame !== activeFrame) pauseFrame(frame);
    });
  }

  function playFrame(frame) {
    const iframe = frame && frame.querySelector('iframe');
    if (!iframe) return;
    iframe.dataset.ytPendingPlay = '1';
    if (iframe.dataset.ytLoaded !== '1') return;
    iframe.dataset.ytPendingPlay = '0';
    postPlayerCommand(frame, 'mute');
    postPlayerCommand(frame, 'playVideo');
  }

  function schedulePlay(frame) {
    if (playTimers.has(frame)) return;
    const timer = setTimeout(function () {
      playTimers.delete(frame);
      if (!frame.isConnected || (visibilityRatios.get(frame) || 0) < VISIBLE_MIN) return;
      pauseOtherFrames(frame);
      if (!frame.querySelector('iframe')) {
        const box = frame.closest('.yt-embed');
        if (box) loadPlayer(box, true, true);
      }
      playFrame(frame);
    }, PLAY_DELAY_MS);
    playTimers.set(frame, timer);
  }

  function preloadBox(box) {
    const frame = box.querySelector('.yt-frame');
    if (!frame || frame.querySelector('iframe') || preloadedFrames.size >= MAX_PRELOADS) return;
    preloadedFrames.add(frame);
    loadPlayer(box, false, true, true);
  }

  function observeBox(box) {
    const frame = box.querySelector('.yt-frame');
    if (!frame || observedFrames.has(frame)) return;
    observedFrames.add(frame);
    if (visibilityObserver) visibilityObserver.observe(frame);
    if (preloadObserver) preloadObserver.observe(frame);
  }

  const visibilityObserver = ('IntersectionObserver' in window)
    ? new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          const frame = en.target;
          visibilityRatios.set(frame, en.intersectionRatio);
          if (en.intersectionRatio < VISIBLE_MIN) {
            const timer = playTimers.get(frame);
            if (timer) { clearTimeout(timer); playTimers.delete(frame); }
            pauseFrame(frame);
          } else {
            // Al salir de la zona de precarga, deja libre el cupo para fachadas futuras.
            preloadedFrames.delete(frame);
            schedulePlay(frame);
          }
        });
      }, { threshold: [0, VISIBLE_MIN] })
    : null;

  const preloadObserver = ('IntersectionObserver' in window)
    ? new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) {
            const box = en.target.closest('.yt-embed');
            if (box) preloadBox(box);
          } else {
            preloadedFrames.delete(en.target);
          }
        });
      }, { rootMargin: '0px 0px 100% 0px', threshold: 0 })
    : null;

  // Detecta fachadas añadidas dinámicamente sin duplicar observadores.
  function observePendingBoxes(root) {
    if (root.matches && root.matches('.yt-embed')) observeBox(root);
    if (root.querySelectorAll) root.querySelectorAll('.yt-embed').forEach(observeBox);
  }
  observePendingBoxes(document);
  if ('MutationObserver' in window && document.documentElement) {
    new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        mutation.addedNodes.forEach(function (node) {
          if (node.nodeType === 1) observePendingBoxes(node);
        });
      });
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  function loadPlayer(box, autoplay, muted, preload) {
    if (!box) return;
    const frame = box.querySelector('.yt-frame');
    let iframe = frame.querySelector('iframe');
    if (iframe) {
      if (autoplay) {
        pauseOtherFrames(frame);
        schedulePlay(frame);
      }
      return;
    }
    const id = box.dataset.ytId;
    const start = parseInt(box.dataset.ytStart, 10) || 0;
    iframe = document.createElement('iframe');
    iframe.src = `https://www.youtube-nocookie.com/embed/${id}?rel=0&autoplay=0&mute=${muted ? '1' : '0'}&playsinline=1&modestbranding=1&enablejsapi=1&origin=${encodeURIComponent(location.origin)}${start ? '&start=' + start : ''}`;
    iframe.title = 'Reproductor de YouTube';
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen';
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    iframe.loading = preload ? 'eager' : 'lazy';
    iframe.addEventListener('load', function () {
      iframe.dataset.ytLoaded = '1';
      if (iframe.dataset.ytPendingPlay === '1' &&
          (visibilityRatios.get(frame) || 0) >= VISIBLE_MIN) {
        pauseOtherFrames(frame);
        playFrame(frame);
      }
    });
    frame.querySelector('.yt-play').replaceWith(iframe);
    if (autoplay) schedulePlay(frame);
    if (visibilityObserver && !observedFrames.has(frame)) observeBox(box);
  }

  function isFullscreen() { return document.fullscreenElement || document.webkitFullscreenElement; }

  function exitTheater(frame) {
    frame.classList.remove('yt-theater');
    document.body.style.overflow = '';
  }

  function toggleExpand(box) {
    const frame = box.querySelector('.yt-frame');
    pauseOtherFrames(frame);
    loadPlayer(box, true, false);
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
    if (e.target.closest('.yt-play')) { pauseOtherFrames(box.querySelector('.yt-frame')); loadPlayer(box, true, false); playFrame(box.querySelector('.yt-frame')); }
    else if (e.target.closest('.yt-expand')) { toggleExpand(box); }
  }, true);

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    const t = document.querySelector('.yt-frame.yt-theater');
    if (t) exitTheater(t);
  });
})();
