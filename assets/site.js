/*!
 * PEAK VISION — site renderer
 * Builds the whole page from content.json (edited from /admin).
 * The generated markup mirrors the original hand-written HTML so the look stays identical.
 */
(function () {
  'use strict';

  var root = document.getElementById('site');
  var params = new URLSearchParams(location.search);
  var PREVIEW = params.has('preview');
  var assetOverrides = {};          // preview only: uploaded-but-not-yet-deployed images
  var expanded = {};                // "show more" state per section (kept across preview re-renders)
  var current = null;

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // Inline formatting: [[gold]]  {{red}}  **bold**  new line -> <br>
  function rich(s, goldClass) {
    var h = esc(s);
    h = h.replace(/\[\[([\s\S]+?)\]\]/g, '<span class="' + (goldClass || 'accent-gold') + '">$1</span>');
    h = h.replace(/\{\{([\s\S]+?)\}\}/g, '<span class="accent-red">$1</span>');
    h = h.replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>');
    return h.replace(/\r?\n/g, '<br>');
  }
  function src(u) { u = u || ''; return esc(assetOverrides[u] || u); }
  function svg(id, cls) {
    return id ? '<svg' + (cls ? ' class="' + cls + '"' : '') + '><use href="#i-' + esc(id) + '"/></svg>' : '';
  }
  function isExternal(link) { return /^(https?:)?\/\//i.test(link || ''); }
  function href(link) {
    var a = ' href="' + esc(link || '#') + '"';
    return isExternal(link) ? a + ' target="_blank" rel="noopener"' : a;
  }
  function visible(list) {
    return (list || []).filter(function (i) { return i && !i.hidden; });
  }
  function has(v) { return v != null && String(v).trim() !== ''; }

  function sectionHead(s, style) {
    if (!has(s.eyebrow) && !has(s.title) && !has(s.description)) return '';
    var h = '<div class="section-head"' + (style ? ' style="' + style + '"' : '') + '>';
    if (has(s.eyebrow)) {
      h += '<span class="eyebrow-row">' +
        (s.eyebrowIcon ? '<span class="eyebrow-icon-badge">' + svg(s.eyebrowIcon) + '</span>' : '') +
        '<span class="eyebrow">' + esc(s.eyebrow) + '</span></span>';
    }
    if (has(s.title)) h += '<h2>' + rich(s.title) + '</h2>';
    if (has(s.description)) h += '<p>' + rich(s.description) + '</p>';
    return h + '</div>';
  }
  function button(b) {
    return '<a' + href(b.link) + ' class="btn ' + (b.style === 'solid' ? 'btn-solid' : 'btn-outline') + '">' +
      svg(b.icon, 'icon') + esc(b.text) + '</a>';
  }

  // Splits a list into the part shown first and the part revealed by "show more"
  function paged(key, items, s, renderItem, extraHidden) {
    var n = parseInt(s.initialCount, 10) || 0;
    var cut = n > 0 && items.length > n && !expanded[key];
    var html = items.map(function (it, i) {
      return renderItem(it, i, cut && i >= n);
    }).join('\n');
    return { html: html, hasMore: n > 0 && items.length > n, collapsed: cut, extra: extraHidden };
  }
  function moreButton(key, p) {
    if (!p.hasMore) return '';
    var c = current.settings || {};
    var label = p.collapsed ? (c.showMoreText || 'عرض المزيد') : (c.showLessText || 'عرض أقل');
    return '<div class="pv-more-wrap"><button type="button" class="btn btn-outline pv-more-btn' +
      (p.collapsed ? '' : ' expanded') + '" data-more="' + key + '">' + esc(label) + svg('chevron-down', 'icon') +
      '</button></div>';
  }
  function hid(flag) { return flag ? ' pv-hidden' : ''; }

  /* ---------- sections ---------- */
  var R = {};

  R.header = function (h) {
    var cta = h.showCta !== false && h.cta ?
      '<a' + href(h.cta.link) + ' class="btn btn-outline nav-cta" style="display:flex;">' + svg(h.cta.icon, 'icon') + esc(h.cta.text) + '</a>' : '';
    var links = visible(h.links).map(function (l, i) {
      return '      <li><a' + href(l.link) + (i === 0 ? ' class="active"' : '') + '>' + esc(l.text) + '</a></li>';
    }).join('\n');
    return '<header>\n  <nav class="wrap">\n    ' + cta +
      '\n    <ul class="nav-links" id="navLinks">\n' + links + '\n    </ul>' +
      '\n    <div class="burger" id="burger"><span></span><span></span><span></span></div>' +
      '\n    <div class="logo-mark">\n      <a href="#top" class="active">' +
      (has(h.logoImage) ? '<img src="' + src(h.logoImage) + '" alt="' + esc(h.brandText1 + ' ' + h.brandText2) + '">' : '') + '</a>' +
      ((has(h.brandText1) || has(h.brandText2)) ?
        '\n      <span style="font-family:var(--display); font-weight:800; font-size:18px; letter-spacing:0.04em;">' +
        esc(h.brandText1) + ' <span style="color:var(--gold);">' + esc(h.brandText2) + '</span></span>' : '') +
      '\n    </div>\n  </nav>\n</header>';
  };

  R.hero = function (s) {
    return '<section class="hero" id="top">' +
      (has(s.logo) ? '\n  <div class="hero-logo">\n    <img src="' + src(s.logo) + '" alt="' + esc(s.logoAlt) + '">\n  </div>' : '') +
      (has(s.title) ? '\n  <h1>' + rich(s.title) + '</h1>' : '') +
      (has(s.subtitle) ? '\n  <p class="sub">' + svg(s.subIcon, 'icon') + esc(s.subtitle) + '</p>' : '') +
      (visible(s.buttons).length ? '\n  <div class="hero-ctas">\n    ' + visible(s.buttons).map(button).join('\n    ') + '\n  </div>' : '') +
      '\n</section>';
  };

  R.about = function (s) {
    var blocks = visible(s.blocks).map(function (b) {
      switch (b.type) {
        case 'lead': return '<p class="lead">' + rich(b.text) + '<br></p>';
        case 'heading': return '<div class="section-head" style="margin-bottom:44px;"><h2>' + rich(b.text) + '</h2></div>';
        case 'paragraph': return '<p>' + rich(b.text) + '</p>';
        default: return '<br>' + rich(b.text) + '<br>';      // free text (as in the original layout)
      }
    }).join('\n');
    var f = s.founder || {};
    var founder = f.show === false ? '' :
      '\n    <div class="founder-card" style="margin-top:56px; display:flex; align-items:center; gap:44px; background:var(--card); border:1px solid var(--line); border-radius:18px; padding:40px; flex-wrap:wrap;">' +
      (has(f.image) ? '\n      <div style="flex-shrink:0; width:220px; margin:0 auto;">\n        <img src="' + src(f.image) + '" alt="' + esc(f.imageAlt) + '" style="width:220px; height:220px; object-fit:cover; border-radius:16px; border:1px solid rgba(232,165,61,0.35);">\n      </div>' : '') +
      '\n      <div style="flex:1; min-width:280px;">' +
      (has(f.eyebrow) ? '\n        <span class="eyebrow">' + esc(f.eyebrow) + '</span>' : '') +
      (has(f.name) ? '\n        <h3 style="font-size:26px; font-weight:800; margin:10px 0 18px; color:var(--ink);">' + esc(f.name) + '</h3>' : '') +
      (has(f.bio) ? '\n        <p style="color:var(--ink-dim); font-size:16px; line-height:1.95;">' + rich(f.bio) + '</p>' : '') +
      '\n      </div>\n    </div>';
    return '<section class="about" id="about">\n  <div class="wrap reveal">\n    ' +
      sectionHead(s, 'margin-bottom:44px;') + '\n' + blocks + '<p></p>' +
      (has(s.englishText) ? '\n    <div class="about-en">' + rich(s.englishText) + '</div>' : '') +
      founder + '\n  </div>\n</section>';
  };

  R.stats = function (s) {
    var p = paged('stats', visible(s.items), s, function (it, i, h) {
      return '      <div class="stat-card' + hid(h) + '">\n        <div class="stat-num">' + esc(it.number) +
        '</div>\n        <div class="stat-label">' + esc(it.label) + '</div>\n      </div>';
    });
    return '<section id="stats">\n  <div class="wrap reveal">\n    ' + sectionHead(s) +
      '\n    <div class="stats-grid">\n' + p.html + '\n    </div>' + moreButton('stats', p) + '\n  </div>\n</section>';
  };

  R.clients = function (s) {
    var p = paged('clients', visible(s.items), s, function (it, i, h) {
      var img = '<img class="client-logo" src="' + src(it.logo) + '" alt="' + esc(it.name) + '">';
      return has(it.link) ?
        '      <a class="client-cell' + hid(h) + '"' + href(it.link) + '>' + img + '</a>' :
        '      <div class="client-cell' + hid(h) + '">' + img + '</div>';
    });
    var add = s.showAddCell !== false ? '\n      <div class="client-cell add-new' + hid(p.collapsed) + '">+</div>' : '';
    return '<section id="clients">\n  <div class="wrap reveal">\n    ' + sectionHead(s) +
      '\n    <div class="clients-grid">\n' + p.html + add + '\n    </div>' + moreButton('clients', p) + '\n  </div>\n</section>';
  };

  R.services = function (s) {
    var p = paged('services', visible(s.items), s, function (it, i, h) {
      return '      <div class="service-card' + hid(h) + '">' +
        (it.icon ? '\n        <div class="service-icon">' + svg(it.icon) + '</div>' : '') +
        (has(it.tag) ? '\n        <span class="service-tag">' + esc(it.tag) + '</span>' : '') +
        '\n        <h3>' + esc(it.title) + '</h3>\n        <p>' + rich(it.description) + '</p>\n      </div>';
    });
    return '<section id="services">\n  <div class="wrap reveal">\n    ' + sectionHead(s) +
      '\n    <div class="services-grid">\n' + p.html + '\n    </div>' + moreButton('services', p) + '\n  </div>\n</section>';
  };

  R.work = function (s) {
    var p = paged('work', visible(s.items), s, function (it, i, h) {
      var num = i + 1 < 10 ? '0' + (i + 1) : String(i + 1);
      var cat = has(it.category) ? ' <span class="cat">' + svg(it.categoryIcon) + esc(it.category) + '</span>' : '';
      var media = has(it.thumbnail) ? '<img src="' + src(it.thumbnail) + '" alt="' + esc(it.thumbnailAlt || 'Video Thumbnail') + '">' : '';
      var a = has(it.link) ? '<a' + href(it.link) + '>' + media + '</a>' : '<a>' + media + '</a>';
      return '      <div class="case-item' + hid(h) + '">\n        <div class="case-num">' + num + '</div>' +
        '\n        <div class="case-body">\n          <h3>' + esc(it.title) + cat + '</h3>' +
        (has(it.description) ? '\n          <p>' + rich(it.description) + '</p>' : '') +
        '\n        </div>\n        ' + a + '\n      </div>';
    });
    return '<section id="work">\n  <div class="wrap reveal">\n    ' + sectionHead(s) +
      '\n    <div class="case-list">\n' + p.html + '\n    </div>' + moreButton('work', p) + '\n  </div>\n</section>';
  };

  R.contact = function (s) {
    return '<section class="cta-strip" id="contact">\n  <div class="wrap reveal">\n    ' +
      (has(s.eyebrow) ? '<span class="eyebrow-row">' + (s.eyebrowIcon ? '<span class="eyebrow-icon-badge">' + svg(s.eyebrowIcon) + '</span>' : '') +
        '<span class="eyebrow">' + esc(s.eyebrow) + '</span></span>' : '') +
      (has(s.title) ? '\n    <h2 style="margin-top:18px;">' + rich(s.title, 'accent') + '</h2>' : '') +
      (visible(s.buttons).length ? '\n    <div class="hero-ctas" style="margin-top:10px;">\n      ' + visible(s.buttons).map(button).join('\n      ') + '\n    </div>' : '') +
      '\n  </div>\n</section>';
  };

  R.footer = function (f) {
    var cols = visible(f.columns).map(function (c) {
      return '      <div class="footer-col">\n        <h4>' + svg(c.icon) + esc(c.title) + '</h4>\n        <ul>\n' +
        visible(c.items).map(function (it) {
          return '          <li>' + svg(it.icon) + (has(it.link) ? '<a' + href(it.link) + '>' + esc(it.text) + '</a>' : esc(it.text)) + '</li>';
        }).join('\n') + '\n        </ul>\n      </div>';
    }).join('\n');
    var social = visible(f.social).map(function (l) {
      return '        <a' + href(l.link) + '>' + svg(l.icon) + esc(l.text) + '</a>';
    }).join('\n');
    return '<footer>\n  <div class="wrap">\n    <div class="footer-top">\n      <div class="footer-brand">' +
      (has(f.logo) ? '\n        <img src="' + src(f.logo) + '" alt="' + esc(f.logoAlt) + '">' : '') +
      (has(f.description) ? '\n        <p>' + rich(f.description) + '</p>' : '') +
      '\n      </div>\n' + cols + '\n    </div>\n    <div class="footer-bottom">\n      <span>' + esc(f.copyright) +
      '</span>\n      <div class="footer-social">\n' + social + '\n      </div>\n    </div>\n  </div>\n</footer>';
  };

  /* ---------- theme & meta ---------- */
  var THEME_VARS = {
    bgBlack: '--bg-black', bgDeep: '--bg-deep', bgMid: '--bg-mid', red: '--red', redBright: '--red-bright',
    gold: '--gold', goldSoft: '--gold-soft', ink: '--ink', inkDim: '--ink-dim', inkFaint: '--ink-faint'
  };
  function applyTheme(c) {
    var t = c.theme || {}, st = document.documentElement.style;
    Object.keys(THEME_VARS).forEach(function (k) {
      if (has(t[k])) st.setProperty(THEME_VARS[k], t[k]); else st.removeProperty(THEME_VARS[k]);
    });
    var s = c.settings || {};
    if (has(s.siteTitle)) document.title = s.siteTitle;
    var css = document.getElementById('pv-custom-css');
    if (!css) { css = document.createElement('style'); css.id = 'pv-custom-css'; document.head.appendChild(css); }
    css.textContent = s.customCss || '';
    var d = document.querySelector('meta[name="description"]');
    if (has(s.metaDescription)) {
      if (!d) { d = document.createElement('meta'); d.name = 'description'; document.head.appendChild(d); }
      d.content = s.metaDescription;
    }
    if (has(s.favicon)) {
      var l = document.querySelector('link[rel="icon"]');
      if (!l) { l = document.createElement('link'); l.rel = 'icon'; document.head.appendChild(l); }
      l.href = assetOverrides[s.favicon] || s.favicon;
    }
  }

  /* ---------- render ---------- */
  function render(c) {
    current = c;
    applyTheme(c);
    var parts = [R.header(c.header || {})];
    (c.layout || []).forEach(function (sec) {
      if (sec.visible === false || !R[sec.id] || !c[sec.id]) return;
      parts.push(R[sec.id](c[sec.id]));
    });
    parts.push(R.footer(c.footer || {}));
    root.className = '';
    root.innerHTML = '\n' + parts.join('\n\n') + '\n';
    wire();
  }

  var observer = null;
  function wire() {
    var burger = document.getElementById('burger');
    var navLinks = document.getElementById('navLinks');
    if (burger && navLinks) {
      burger.addEventListener('click', function () { navLinks.classList.toggle('open'); });
      navLinks.querySelectorAll('a').forEach(function (a) {
        a.addEventListener('click', function () { navLinks.classList.remove('open'); });
      });
    }
    if (observer) observer.disconnect();
    observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); } });
    }, { threshold: 0.01, rootMargin: '0px 0px -50px 0px' });
    document.querySelectorAll('.reveal').forEach(function (el) {
      if (PREVIEW) el.classList.add('in');
      observer.observe(el);
    });
    onScroll();
  }

  // "show more / show less"
  root.addEventListener('click', function (e) {
    var b = e.target.closest('[data-more]');
    if (!b) return;
    var key = b.getAttribute('data-more');
    var wasExpanded = !!expanded[key];
    expanded[key] = !wasExpanded;
    var sec = b.closest('section');
    var head = sec.offsetTop;
    var newHtml = R[key](current[key]);
    var tmp = document.createElement('div');
    tmp.innerHTML = newHtml;
    var fresh = tmp.firstElementChild;
    fresh.querySelector('.reveal').classList.add('in');
    sec.parentNode.replaceChild(fresh, sec);
    if (wasExpanded) window.scrollTo({ top: head - 80, behavior: 'smooth' });
  });

  function onScroll() {
    var sections = document.querySelectorAll('section[id]');
    var navA = document.querySelectorAll('.nav-links a[href^="#"]');
    var cur = 'top';
    sections.forEach(function (sec) {
      var rect = sec.getBoundingClientRect();
      if (rect.top <= 120 && rect.bottom > 120) cur = sec.id;
    });
    navA.forEach(function (a) { a.classList.toggle('active', a.getAttribute('href') === '#' + cur); });
  }
  window.addEventListener('scroll', onScroll);

  /* ---------- boot ---------- */
  if (PREVIEW) {
    // Live preview inside the admin panel
    window.addEventListener('message', function (e) {
      if (e.origin !== location.origin || !e.data) return;
      if (e.data.type === 'pv:content') {
        assetOverrides = e.data.assets || {};
        var y = window.scrollY;
        render(e.data.content);
        window.scrollTo(0, y);
      } else if (e.data.type === 'pv:scroll') {
        var el = document.getElementById(e.data.id === 'hero' ? 'top' : e.data.id);
        if (e.data.id === 'header') window.scrollTo({ top: 0, behavior: 'smooth' });
        else if (e.data.id === 'footer') window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
        else if (el) el.scrollIntoView({ behavior: 'smooth' });
      }
    });
    parent.postMessage({ type: 'pv:ready' }, location.origin);
  } else {
    var cfg = window.PV_CONFIG || {};
    var fromFile = function () {
      return fetch('content.json?v=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
    };
    // Content comes from the database (edited in /admin); content.json is the fallback.
    var load = cfg.supabaseUrl && cfg.supabaseAnonKey ?
      fetch(String(cfg.supabaseUrl).replace(/\/+$/, '') + '/rest/v1/site_content?id=eq.main&select=data',
        { headers: { apikey: cfg.supabaseAnonKey }, cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(function (rows) { return rows && rows[0] && rows[0].data ? rows[0].data : fromFile(); })
        .catch(function (err) { console.warn('content database unavailable, using content.json', err); return fromFile(); }) :
      fromFile();
    load
      .then(function (c) {
        render(c);
        if (location.hash) {
          var t = document.getElementById(location.hash.slice(1));
          if (t) t.scrollIntoView();
        }
      })
      .catch(function (err) {
        root.className = '';
        root.innerHTML = '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;color:var(--ink-dim);font-family:var(--arabic)">' +
          'تعذّر تحميل محتوى الموقع (content.json).<br>إذا كنت تفتح الملف مباشرة من جهازك، شغّله من خلال سيرفر محلي.</div>';
        console.error('content.json failed to load', err);
      });
  }
})();
