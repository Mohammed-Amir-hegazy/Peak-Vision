/*!
 * PEAK VISION — admin panel
 * Edits content.json and publishes it to the GitHub repository that hosts the site.
 */
(function () {
  'use strict';

  var SITE_ROOT = new URL('../', location.href);
  var LS_GH = 'pv-admin-gh', LS_DRAFT = 'pv-admin-draft', LS_SKIP = 'pv-admin-skip-gh', LS_UI = 'pv-admin-ui';

  var state = {
    content: null,
    publishedStr: '',
    sha: null,
    page: 'hero',
    assets: {},          // uploaded path -> data URL (so previews work before the site redeploys)
    undo: [], redo: [],
    lastSnap: 0,
    busy: false,
    icons: []
  };

  /* ============ small helpers ============ */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function h(tag, props) {
    var el = document.createElement(tag);
    props = props || {};
    Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(function (x) { add(el, x); });
    else el.appendChild(c.nodeType ? c : document.createTextNode(c));
  }
  function getPath(obj, path) {
    if (!path) return obj;
    return path.split('.').reduce(function (o, k) { return o == null ? o : o[k]; }, obj);
  }
  function setPath(obj, path, v) {
    var ks = path.split('.'), last = ks.pop();
    var o = ks.reduce(function (o, k) { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; return o[k]; }, obj);
    o[last] = v;
  }
  function ensureObj(path) {
    var o = getPath(state.content, path);
    if (o == null) { setPath(state.content, path, {}); o = getPath(state.content, path); }
    return o;
  }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function serialize(c) { return JSON.stringify(c, null, 2) + '\n'; }
  function debounce(fn, ms) { var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }
  function resolveUrl(u) {
    if (!u) return '';
    if (state.assets[u]) return state.assets[u];
    if (/^(data:|blob:|https?:|\/\/)/i.test(u)) return u;
    try { return new URL(u, SITE_ROOT).href; } catch (e) { return u; }
  }
  function toast(msg, kind, ms) {
    var t = h('div', { class: 'toast ' + (kind || '') }, msg);
    $('#toasts').appendChild(t);
    setTimeout(function () { t.remove(); }, ms || 4200);
  }
  var uid = (function () { var m = new WeakMap(), n = 0; return function (o) { if (!m.has(o)) m.set(o, 'i' + (++n)); return m.get(o); }; })();
  var openItems = new Set();
  var listSearch = {};

  /* ============ schema ============ */
  var LINK_HINT = 'رابط خارجي يبدأ بـ https:// أو قسم في الصفحة مثل ‎#work‎ — للواتساب: https://wa.me/201011650100';
  var HEAD = [
    { key: 'eyebrow', label: 'العنوان الصغير (فوق العنوان)' },
    { key: 'eyebrowIcon', label: 'أيقونة العنوان الصغير', type: 'icon' },
    { key: 'title', label: 'العنوان الرئيسي', type: 'rich', full: true },
    { key: 'description', label: 'وصف تحت العنوان (اختياري)', type: 'rich', full: true }
  ];
  var MORE = { key: 'initialCount', label: 'عدد العناصر الظاهرة قبل زر «عرض المزيد»', type: 'number', min: 0, hint: 'لو العناصر أكتر من الرقم ده هيظهر زر «عرض المزيد». اكتب 0 لإظهار الكل بدون زر.' };
  var BTN_FIELDS = [
    { key: 'text', label: 'نص الزر' },
    { key: 'link', label: 'الرابط', type: 'link', hint: LINK_HINT },
    { key: 'icon', label: 'الأيقونة', type: 'icon' },
    { key: 'style', label: 'شكل الزر', type: 'select', options: [['outline', 'بإطار أحمر'], ['solid', 'أحمر ممتلئ']] }
  ];
  var BLOCK_TYPES = [['lead', 'فقرة افتتاحية (خط كبير)'], ['heading', 'عنوان فرعي كبير'], ['text', 'نص عادي'], ['paragraph', 'فقرة رمادية']];
  var THEME_LABELS = [
    ['bgBlack', 'الخلفية الأساسية'], ['bgMid', 'توهج الخلفية'], ['bgDeep', 'خلفية داكنة إضافية'],
    ['red', 'الأحمر'], ['redBright', 'الأحمر الفاتح'], ['gold', 'اللون الذهبي'], ['goldSoft', 'الذهبي الفاتح'],
    ['ink', 'لون النص'], ['inkDim', 'نص ثانوي'], ['inkFaint', 'نص باهت']
  ];
  var DEFAULT_THEME = { bgBlack: '#0c0403', bgDeep: '#30363c', bgMid: '#3a0d0d', red: '#e1261c', redBright: '#ff3b30', gold: '#937e73', goldSoft: '#937e73', ink: '#f4ede9', inkDim: '#b8a9a4', inkFaint: '#7a6863' };

  var SECTION_META = {
    hero: { label: 'الواجهة الرئيسية', ico: '◆', list: 'buttons' },
    about: { label: 'من نحن', ico: '◎', list: 'blocks' },
    stats: { label: 'الأرقام والإحصائيات', ico: '#', list: 'items' },
    clients: { label: 'العملاء', ico: '★', list: 'items' },
    services: { label: 'الخدمات', ico: '▦', list: 'items' },
    work: { label: 'الأعمال والمشاريع', ico: '▶', list: 'items' },
    contact: { label: 'قسم التواصل', ico: '✆', list: 'buttons' }
  };

  var PAGES = {
    settings: {
      title: 'الإعدادات والألوان', desc: 'بيانات الموقع العامة، نصوص زر «عرض المزيد»، والألوان.',
      cards: [
        { title: 'بيانات الموقع', base: 'settings', fields: [
          { key: 'siteTitle', label: 'عنوان الموقع (يظهر في تبويب المتصفح)', full: true },
          { key: 'metaDescription', label: 'وصف الموقع لمحركات البحث', type: 'textarea', full: true },
          { key: 'favicon', label: 'أيقونة الموقع في المتصفح (Favicon)', type: 'image', full: true }
        ] },
        { title: 'زر «عرض المزيد»', base: 'settings', fields: [
          { key: 'showMoreText', label: 'نص زر عرض المزيد' },
          { key: 'showLessText', label: 'نص زر عرض أقل' }
        ] },
        { title: 'ألوان الموقع', base: 'theme', type: 'colors' },
        { title: 'CSS إضافي (للمتقدمين)', base: 'settings', fields: [
          { key: 'customCss', label: 'أكواد CSS تُضاف للموقع', type: 'code', full: true }
        ] }
      ]
    },
    header: {
      title: 'الهيدر والقائمة', desc: 'الشريط العلوي: اسم البراند، زر التواصل، وروابط القائمة وترتيبها.',
      cards: [
        { title: 'اسم البراند', base: 'header', fields: [
          { key: 'brandText1', label: 'الجزء الأول (أبيض)' },
          { key: 'brandText2', label: 'الجزء الثاني (ذهبي)' },
          { key: 'logoImage', label: 'صورة شعار بجانب الاسم (اختياري)', type: 'image', full: true }
        ] },
        { title: 'زر التواصل في الهيدر', base: 'header', fields: [
          { key: 'showCta', label: 'إظهار الزر', type: 'toggle', full: true },
          { key: 'cta.text', label: 'نص الزر' },
          { key: 'cta.link', label: 'الرابط', type: 'link', hint: LINK_HINT },
          { key: 'cta.icon', label: 'الأيقونة', type: 'icon' }
        ] },
        { title: 'روابط القائمة', base: 'header', fields: [
          { key: 'links', type: 'list', full: true, addLabel: 'رابط', title: function (i) { return i.text; }, sub: function (i) { return i.link; },
            template: function () { return { text: 'رابط جديد', link: '#' }; },
            fields: [{ key: 'text', label: 'النص' }, { key: 'link', label: 'الرابط', type: 'link', hint: 'أقسام الصفحة: #top ، #about ، #clients ، #services ، #work ، #contact' }] }
        ] }
      ]
    },
    hero: {
      section: true, title: 'الواجهة الرئيسية', desc: 'أول ما يظهر للزائر: الشعار الكبير، العنوان، والأزرار.',
      cards: [
        { title: 'المحتوى', base: 'hero', fields: [
          { key: 'logo', label: 'الشعار الكبير', type: 'image', full: true },
          { key: 'logoAlt', label: 'وصف الصورة (Alt)' },
          { key: 'subIcon', label: 'أيقونة السطر الصغير', type: 'icon' },
          { key: 'title', label: 'العنوان', type: 'rich', full: true, hint: 'ضع الكلمة بين [[ ]] لتلوينها بالذهبي — مثال: The Impact [[You Seek]]' },
          { key: 'subtitle', label: 'السطر الصغير تحت العنوان', full: true }
        ] },
        { title: 'الأزرار', base: 'hero', fields: [
          { key: 'buttons', type: 'list', full: true, addLabel: 'زر', title: function (i) { return i.text; }, sub: function (i) { return i.link; }, iconKey: 'icon',
            template: function () { return { text: 'زر جديد', link: '#contact', icon: 'chat', style: 'outline' }; }, fields: BTN_FIELDS }
        ] }
      ]
    },
    about: {
      section: true, title: 'من نحن', desc: 'نبذة عن الشركة، العناوين الفرعية، النص الإنجليزي، وكارت المؤسس.',
      cards: [
        { title: 'عنوان القسم', base: 'about', fields: HEAD.slice(0, 3) },
        { title: 'فقرات القسم', base: 'about', fields: [
          { key: 'blocks', type: 'list', full: true, addLabel: 'فقرة / عنوان',
            title: function (i) { return i.text; }, sub: function (i) { return (BLOCK_TYPES.filter(function (t) { return t[0] === i.type; })[0] || [])[1]; },
            template: function () { return { type: 'text', text: '' }; },
            fields: [
              { key: 'type', label: 'نوع العنصر', type: 'select', options: BLOCK_TYPES },
              { key: 'text', label: 'النص', type: 'rich', full: true }
            ] }
        ] },
        { title: 'النص الإنجليزي', base: 'about', fields: [
          { key: 'englishText', label: 'النص (سطر فاضي بين الفقرات)', type: 'textarea', full: true, ltr: true, rows: 7 }
        ] },
        { title: 'كارت المؤسس', base: 'about.founder', fields: [
          { key: 'show', label: 'إظهار كارت المؤسس', type: 'toggle', full: true },
          { key: 'image', label: 'صورة المؤسس', type: 'image', full: true },
          { key: 'eyebrow', label: 'العنوان الصغير' },
          { key: 'name', label: 'الاسم' },
          { key: 'bio', label: 'النبذة', type: 'rich', full: true, rows: 6 },
          { key: 'imageAlt', label: 'وصف الصورة (Alt)' }
        ] }
      ]
    },
    stats: {
      section: true, title: 'الأرقام والإحصائيات', desc: 'الكروت اللي فيها أرقام إنجازات الشركة.',
      cards: [
        { title: 'عنوان القسم (اختياري)', base: 'stats', fields: HEAD },
        { title: 'الأرقام', base: 'stats', fields: [
          MORE,
          { key: 'items', type: 'list', full: true, addLabel: 'رقم', title: function (i) { return i.number; }, sub: function (i) { return i.label; },
            template: function () { return { number: '+10', label: 'وصف الرقم' }; },
            fields: [{ key: 'number', label: 'الرقم', hint: 'مثال: ‎+2000‎' }, { key: 'label', label: 'الوصف' }] }
        ] }
      ]
    },
    clients: {
      section: true, title: 'العملاء', desc: 'شعارات العملاء — اسحب لتغيير الترتيب، ويمكنك رفع عدة شعارات مرة واحدة.',
      cards: [
        { title: 'عنوان القسم', base: 'clients', fields: HEAD },
        { title: 'الشعارات', base: 'clients', fields: [
          MORE,
          { key: 'showAddCell', label: 'إظهار خانة «+» في آخر الشبكة', type: 'toggle' },
          { key: 'items', type: 'list', full: true, addLabel: 'عميل', thumb: 'logo', thumbContain: true, bulkImage: 'logo',
            title: function (i) { return i.name; }, sub: function (i) { return i.link; },
            template: function () { return { name: 'عميل جديد', logo: '', link: '' }; },
            fields: [
              { key: 'name', label: 'اسم العميل' },
              { key: 'link', label: 'رابط (اختياري)', type: 'link' },
              { key: 'logo', label: 'الشعار', type: 'image', full: true }
            ] }
        ] }
      ]
    },
    services: {
      section: true, title: 'الخدمات', desc: 'كروت الخدمات: الأيقونة، الوسم، العنوان والوصف.',
      cards: [
        { title: 'عنوان القسم', base: 'services', fields: HEAD },
        { title: 'الخدمات', base: 'services', fields: [
          MORE,
          { key: 'items', type: 'list', full: true, addLabel: 'خدمة', iconKey: 'icon',
            title: function (i) { return i.title; }, sub: function (i) { return i.tag; },
            template: function () { return { icon: 'camera', tag: 'NEW', title: 'خدمة جديدة', description: '' }; },
            fields: [
              { key: 'title', label: 'اسم الخدمة' },
              { key: 'tag', label: 'الوسم الصغير', hint: 'مثال: PHOTO' },
              { key: 'icon', label: 'الأيقونة', type: 'icon' },
              { key: 'description', label: 'الوصف', type: 'rich', full: true }
            ] }
        ] }
      ]
    },
    work: {
      section: true, title: 'الأعمال والمشاريع', desc: 'دراسات الحالة / الفيديوهات. الترقيم (01، 02…) بيتعمل تلقائي حسب الترتيب.',
      cards: [
        { title: 'عنوان القسم', base: 'work', fields: HEAD },
        { title: 'المشاريع', base: 'work', fields: [
          MORE,
          { key: 'items', type: 'list', full: true, addLabel: 'مشروع', thumb: 'thumbnail', addTop: true,
            title: function (i) { return i.title; }, sub: function (i) { return i.category; },
            template: function () { return { title: 'مشروع جديد', category: 'عقارات', categoryIcon: 'building', description: '', link: '', thumbnail: '', thumbnailAlt: 'Video Thumbnail' }; },
            fields: [
              { key: 'title', label: 'اسم المشروع', full: true },
              { key: 'category', label: 'التصنيف', hint: 'اتركه فاضي لإخفائه' },
              { key: 'categoryIcon', label: 'أيقونة التصنيف', type: 'icon' },
              { key: 'description', label: 'الوصف', type: 'rich', full: true },
              { key: 'link', label: 'رابط الفيديو / المشروع', type: 'link', full: true, hint: 'رابط يوتيوب أو أي رابط' },
              { key: 'thumbnail', label: 'الصورة المصغرة', type: 'image', full: true, youtubeFrom: 'link' },
              { key: 'thumbnailAlt', label: 'وصف الصورة (Alt)' }
            ] }
        ] }
      ]
    },
    contact: {
      section: true, title: 'قسم التواصل', desc: 'الشريط الأخير قبل الفوتر: العنوان وأزرار التواصل (واتساب، اتصال، إيميل…).',
      cards: [
        { title: 'المحتوى', base: 'contact', fields: [
          { key: 'eyebrow', label: 'العنوان الصغير' },
          { key: 'eyebrowIcon', label: 'الأيقونة', type: 'icon' },
          { key: 'title', label: 'العنوان', type: 'rich', full: true, hint: 'ضع الكلمة بين [[ ]] لتلوينها بالذهبي' }
        ] },
        { title: 'أزرار التواصل', base: 'contact', fields: [
          { key: 'buttons', type: 'list', full: true, addLabel: 'زر', iconKey: 'icon', title: function (i) { return i.text; }, sub: function (i) { return i.link; },
            template: function () { return { text: 'اتصل بنا', link: 'tel:+201011650100', icon: 'phone', style: 'outline' }; },
            fields: BTN_FIELDS.map(function (f) { return f.key === 'link' ? Object.assign({}, f, { hint: 'واتساب: https://wa.me/201011650100 — اتصال: tel:+201011650100 — إيميل: mailto:name@mail.com' }) : f; }) }
        ] }
      ]
    },
    footer: {
      title: 'الفوتر والتواصل الاجتماعي', desc: 'أسفل الصفحة: الشعار، أعمدة الروابط وبيانات التواصل، وروابط السوشيال ميديا.',
      cards: [
        { title: 'الشعار والوصف', base: 'footer', fields: [
          { key: 'logo', label: 'شعار الفوتر', type: 'image', full: true },
          { key: 'description', label: 'الوصف', type: 'rich', full: true },
          { key: 'logoAlt', label: 'وصف الشعار (Alt)' }
        ] },
        { title: 'أعمدة الفوتر', base: 'footer', fields: [
          { key: 'columns', type: 'list', full: true, addLabel: 'عمود', iconKey: 'icon', title: function (i) { return i.title; },
            sub: function (i) { return (i.items || []).length + ' عناصر'; },
            template: function () { return { title: 'عمود جديد', icon: 'link', items: [] }; },
            fields: [
              { key: 'title', label: 'عنوان العمود' },
              { key: 'icon', label: 'الأيقونة', type: 'icon' },
              { key: 'items', type: 'list', full: true, label: 'عناصر العمود', addLabel: 'عنصر', iconKey: 'icon',
                title: function (i) { return i.text; }, sub: function (i) { return i.link; },
                template: function () { return { icon: 'link', text: 'عنصر جديد', link: '' }; },
                fields: [
                  { key: 'text', label: 'النص' },
                  { key: 'icon', label: 'الأيقونة', type: 'icon' },
                  { key: 'link', label: 'رابط (اختياري)', type: 'link', full: true, hint: LINK_HINT }
                ] }
            ] }
        ] },
        { title: 'السوشيال ميديا', base: 'footer', fields: [
          { key: 'social', type: 'list', full: true, addLabel: 'حساب', iconKey: 'icon', title: function (i) { return i.text; }, sub: function (i) { return i.link; },
            template: function () { return { icon: 'youtube', text: 'YouTube', link: 'https://' }; },
            fields: [
              { key: 'text', label: 'الاسم' },
              { key: 'icon', label: 'الأيقونة', type: 'icon' },
              { key: 'link', label: 'رابط الحساب', type: 'link', full: true }
            ] }
        ] },
        { title: 'حقوق النشر', base: 'footer', fields: [{ key: 'copyright', label: 'نص الحقوق', full: true }] }
      ]
    }
  };

  /* ============ change tracking, drafts, undo ============ */
  var saveDraft = debounce(function () {
    try { localStorage.setItem(LS_DRAFT, JSON.stringify({ content: state.content, savedAt: Date.now() })); } catch (e) { }
  }, 400);
  var pushPreview = debounce(sendPreview, 200);

  function snapshot(force) {
    var now = Date.now();
    if (!force && now - state.lastSnap < 1200) return;
    state.lastSnap = now;
    state.undo.push(JSON.stringify(state.content));
    if (state.undo.length > 150) state.undo.shift();
    state.redo = [];
    updateUndoButtons();
  }
  function changed(structural) {
    saveDraft();
    pushPreview();
    updateStatus();
    if (structural) { renderSidebar(); }
  }
  function structural(fn) {          // wrap a structural change (add/remove/move) with an undo point
    snapshot(true);
    fn();
    changed(true);
    renderEditor();
  }
  function undoRedo(from, to) {
    if (!from.length) return;
    to.push(JSON.stringify(state.content));
    state.content = JSON.parse(from.pop());
    state.lastSnap = 0;
    updateUndoButtons();
    changed(true);
    renderEditor();
  }
  function updateUndoButtons() {
    $('#btnUndo').disabled = !state.undo.length;
    $('#btnRedo').disabled = !state.redo.length;
  }
  function isDirty() { return state.content && serialize(state.content) !== state.publishedStr; }
  function updateStatus(text, cls) {
    var s = $('#status');
    if (text) { s.textContent = text; s.className = 'status ' + (cls || ''); return; }
    var dirty = isDirty();
    s.textContent = dirty ? '● تعديلات غير منشورة' : '✓ كل التعديلات منشورة';
    s.className = 'status ' + (dirty ? 'dirty' : 'ok');
    if (!GH.connected()) s.textContent += ' — غير مربوط بـ GitHub';
    $('#btnPublish').disabled = state.busy;
  }

  /* ============ field renderers ============ */
  function fieldWrap(f, control) {
    return h('div', { class: 'field' + (f.full || f.type === 'list' || f.type === 'image' && f.full !== false ? ' full' : '') },
      f.label && f.type !== 'toggle' ? h('label', { text: f.label }) : null,
      control,
      f.hint ? h('div', { class: 'hint', text: f.hint }) : null);
  }

  function renderField(obj, f, ctx) {
    var t = f.type || 'text';
    var val = getPath(obj, f.key);
    var set = function (v) { snapshot(); setPath(obj, f.key, v); changed(false); if (ctx && ctx.onChange) ctx.onChange(); };

    if (t === 'list') return renderList(obj, f, ctx);

    if (t === 'toggle') {
      var cb = h('input', { type: 'checkbox', checked: val !== false, onChange: function () { snapshot(true); setPath(obj, f.key, cb.checked); changed(true); } });
      return fieldWrap(f, h('label', { class: 'switch' }, cb, f.label));
    }
    if (t === 'select') {
      var sel = h('select', { onChange: function () { set(sel.value); } },
        f.options.map(function (o) { return h('option', { value: o[0], text: o[1] }); }));
      sel.value = val == null ? f.options[0][0] : val;
      return fieldWrap(f, sel);
    }
    if (t === 'number') {
      var num = h('input', { type: 'number', min: f.min, value: val == null ? 0 : val, onInput: function () { set(Math.max(0, parseInt(num.value, 10) || 0)); } });
      return fieldWrap(f, num);
    }
    if (t === 'icon') return fieldWrap(f, iconPicker(val, function (v) { snapshot(true); setPath(obj, f.key, v); changed(false); if (ctx && ctx.onChange) ctx.onChange(); }));
    if (t === 'image') return fieldWrap(f, imageField(obj, f, ctx));
    if (t === 'textarea' || t === 'rich' || t === 'code') {
      var ta = h('textarea', { rows: f.rows || (t === 'code' ? 8 : t === 'rich' && /title|eyebrow/i.test(f.key) ? 2 : 3), class: t === 'code' ? 'code' : null, dir: f.ltr ? 'ltr' : null, spellcheck: t === 'code' ? 'false' : null });
      ta.value = val == null ? '' : val;
      ta.addEventListener('input', function () { set(ta.value); });
      return fieldWrap(f, ta);
    }
    // text / link
    var inp = h('input', { type: 'text', dir: t === 'link' ? 'ltr' : null, placeholder: t === 'link' ? 'https://… أو #section' : null, list: t === 'link' ? 'pv-anchors' : null });
    inp.value = val == null ? '' : val;
    inp.addEventListener('input', function () { set(inp.value); });
    return fieldWrap(f, inp);
  }

  function iconSvg(id) {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    var u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    u.setAttribute('href', '#i-' + id);
    s.appendChild(u);
    return s;
  }
  function iconPicker(val, onPick) {
    var btn = h('button', { type: 'button', class: 'icon-pick' });
    function draw(v) {
      btn.replaceChildren();
      if (v) { btn.appendChild(iconSvg(v)); btn.appendChild(h('span', { text: v })); }
      else btn.appendChild(h('span', { text: 'بدون أيقونة' }));
    }
    draw(val);
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      openIconPopover(btn, val, function (v) { val = v; draw(v); onPick(v); });
    });
    return btn;
  }
  var iconPopCb = null;
  function openIconPopover(anchor, current, cb) {
    var pop = $('#iconPop'), grid = $('#iconGrid'), search = $('#iconSearch');
    iconPopCb = cb;
    function draw(q) {
      grid.replaceChildren(h('button', { type: 'button', class: 'none' + (!current ? ' on' : ''), title: 'بدون', text: 'بدون', onClick: function () { pick(''); } }));
      state.icons.filter(function (id) { return !q || id.indexOf(q.toLowerCase()) >= 0; }).forEach(function (id) {
        var b = h('button', { type: 'button', title: id, class: id === current ? 'on' : null, onClick: function () { pick(id); } });
        b.appendChild(iconSvg(id));
        grid.appendChild(b);
      });
    }
    function pick(v) { pop.hidden = true; if (iconPopCb) iconPopCb(v); }
    search.value = '';
    search.oninput = function () { draw(search.value.trim()); };
    draw('');
    pop.hidden = false;
    var r = anchor.getBoundingClientRect();
    var top = r.bottom + 6, left = r.left;
    if (top + 330 > innerHeight) top = Math.max(10, r.top - 336);
    if (left + 300 > innerWidth) left = innerWidth - 310;
    pop.style.top = top + 'px'; pop.style.left = Math.max(10, left) + 'px';
    search.focus();
  }
  document.addEventListener('click', function (e) {
    var pop = $('#iconPop');
    if (!pop.hidden && !pop.contains(e.target)) pop.hidden = true;
    var menu = $('#moreMenu');
    if (!menu.hidden && !e.target.closest('.menu-wrap')) menu.hidden = true;
  });

  function youtubeId(url) {
    var m = String(url || '').match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/)([A-Za-z0-9_-]{11})/);
    return m ? m[1] : '';
  }

  function imageField(obj, f, ctx) {
    var thumb = h('div', { class: 'img-thumb' });
    var inp = h('input', { type: 'text', dir: 'ltr', placeholder: 'رابط الصورة https://…' });
    inp.value = getPath(obj, f.key) || '';
    function drawThumb() {
      thumb.replaceChildren();
      var u = getPath(obj, f.key);
      if (u) {
        var im = h('img', { src: resolveUrl(u), alt: '' });
        im.onerror = function () { thumb.replaceChildren(h('span', { text: 'لا يمكن العرض' })); };
        thumb.appendChild(im);
      } else thumb.appendChild(h('span', { text: 'لا توجد صورة' }));
    }
    function setVal(v, snapNow) {
      if (snapNow) snapshot(true); else snapshot();
      setPath(obj, f.key, v);
      inp.value = v;
      drawThumb();
      changed(false);
      if (ctx && ctx.onChange) ctx.onChange();
    }
    inp.addEventListener('input', function () { setVal(inp.value.trim()); });
    drawThumb();

    var file = h('input', { type: 'file', accept: 'image/*', hidden: true });
    file.addEventListener('change', function () {
      var fl = file.files[0];
      file.value = '';
      if (!fl) return;
      uploadImage(fl).then(function (path) { if (path) setVal(path, true); });
    });
    var btns = h('div', { class: 'img-btns' },
      h('button', { type: 'button', class: 'btn sm', onClick: function () { file.click(); } }, '⬆ رفع صورة'),
      f.youtubeFrom ? h('button', {
        type: 'button', class: 'btn sm', title: 'استخدم الصورة المصغرة للفيديو من يوتيوب',
        onClick: function () {
          var id = youtubeId(getPath(obj, f.youtubeFrom));
          if (!id) { toast('حط رابط فيديو يوتيوب في خانة الرابط الأول', 'err'); return; }
          var max = 'https://img.youtube.com/vi/' + id + '/maxresdefault.jpg';
          var test = new Image();
          test.onload = function () { setVal(test.naturalWidth > 120 ? max : 'https://img.youtube.com/vi/' + id + '/hqdefault.jpg', true); };
          test.onerror = function () { setVal('https://img.youtube.com/vi/' + id + '/hqdefault.jpg', true); };
          test.src = max;
        }
      }, '▶ صورة من يوتيوب') : null,
      h('button', { type: 'button', class: 'btn sm ghost', onClick: function () { setVal('', true); } }, 'مسح'),
      file);
    return h('div', { class: 'img-field' }, thumb, h('div', { class: 'img-side' }, inp, btns));
  }

  /* ---------- lists (add / delete / duplicate / hide / reorder) ---------- */
  var drag = null;
  function renderList(obj, f, ctx) {
    if (!Array.isArray(obj[f.key])) obj[f.key] = [];
    var arr = obj[f.key];
    var listKey = (ctx && ctx.path || '') + '/' + f.key;
    var moreN = f.key === 'items' && obj.initialCount != null ? parseInt(obj.initialCount, 10) || 0 : 0;
    var wrap = h('div', { class: 'list' });

    var q = listSearch[listKey] || '';
    var search = arr.length > 8 ? h('input', { type: 'search', placeholder: 'بحث…', value: q }) : null;
    var hiddenCount = arr.filter(function (i) { return i && i.hidden; }).length;

    var bulk = null;
    if (f.bulkImage) {
      var multi = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
      multi.addEventListener('change', function () {
        var files = Array.prototype.slice.call(multi.files);
        multi.value = '';
        if (!files.length) return;
        (async function () {
          var made = [];
          for (var i = 0; i < files.length; i++) {
            var p = await uploadImage(files[i], '(' + (i + 1) + '/' + files.length + ') ');
            if (!p) break;
            var it = f.template();
            it[f.bulkImage] = p;
            if ('name' in it) it.name = files[i].name.replace(/\.[^.]+$/, '');
            made.push(it);
          }
          if (made.length) structural(function () { Array.prototype.push.apply(arr, made); });
        })();
      });
      bulk = h('button', { type: 'button', class: 'btn sm', onClick: function () { multi.click(); } }, '⬆ رفع عدة صور', multi);
    }

    var allOpen = arr.length && arr.every(function (i) { return openItems.has(uid(i)); });
    wrap.appendChild(h('div', { class: 'list-tools' },
      h('b', { text: (f.label ? f.label + ' — ' : '') + arr.length + ' عنصر' }),
      hiddenCount ? h('span', { class: 'badge', text: hiddenCount + ' مخفي' }) : null,
      h('span', { class: 'grow' }),
      search,
      arr.length > 1 ? h('button', { type: 'button', class: 'btn sm ghost', onClick: function () {
        arr.forEach(function (i) { if (allOpen) openItems.delete(uid(i)); else openItems.add(uid(i)); });
        renderEditor();
      } }, allOpen ? 'طي الكل' : 'فتح الكل') : null,
      bulk,
      f.addTop ? h('button', { type: 'button', class: 'btn sm', onClick: function () { addItem(true); } }, '+ ' + (f.addLabel || 'عنصر') + ' في الأول') : null,
      h('button', { type: 'button', class: 'btn sm', onClick: function () { addItem(false); } }, '+ إضافة ' + (f.addLabel || 'عنصر'))
    ));

    function addItem(top) {
      var it = f.template();
      openItems.add(uid(it));
      structural(function () { if (top) arr.unshift(it); else arr.push(it); });
      setTimeout(function () {
        var el = document.querySelector('[data-uid="' + uid(it) + '"]');
        if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); var i = el.querySelector('input,textarea'); if (i) i.focus(); }
      }, 50);
    }

    var items = h('div', { class: 'items' });
    if (!arr.length) items.appendChild(h('div', { class: 'empty', text: 'لا توجد عناصر — اضغط «إضافة»' }));
    var visibleIndex = 0;
    arr.forEach(function (it, idx) {
      if (moreN && !it.hidden && visibleIndex === moreN) {
        items.appendChild(h('div', { class: 'more-divider', text: 'العناصر التالية تظهر بعد الضغط على «عرض المزيد»' }));
      }
      if (!it.hidden) visibleIndex++;
      items.appendChild(renderItem(arr, it, idx, f, listKey));
    });
    wrap.appendChild(items);

    if (search) {
      var applyFilter = function () {
        var qq = search.value.trim().toLowerCase();
        listSearch[listKey] = search.value;
        $$(':scope > .item', items).forEach(function (el, i) {
          var txt = (f.title(arr[i]) || '') + ' ' + (f.sub ? f.sub(arr[i]) || '' : '');
          el.hidden = qq && txt.toLowerCase().indexOf(qq) < 0;
        });
        $$(':scope > .more-divider', items).forEach(function (d) { d.hidden = !!qq; });
      };
      search.addEventListener('input', applyFilter);
      if (q) setTimeout(applyFilter);
    }
    return fieldWrap({ full: true }, wrap);
  }

  function renderItem(arr, it, idx, f, listKey) {
    var id = uid(it);
    var open = openItems.has(id);
    var el = h('div', { class: 'item' + (open ? ' open' : '') + (it.hidden ? ' is-hidden' : ''), 'data-uid': id });
    var titleEl = h('span', { class: 'item-title' });
    function drawTitle() {
      titleEl.replaceChildren(f.title(it) || '(بدون عنوان)');
      var sub = f.sub && f.sub(it);
      if (sub) titleEl.appendChild(h('span', { class: 'sub', text: sub }));
    }
    drawTitle();

    var thumb = null;
    if (f.thumb) {
      thumb = getPath(it, f.thumb) ? h('img', { class: 'item-thumb' + (f.thumbContain ? ' contain' : ''), src: resolveUrl(getPath(it, f.thumb)), alt: '', loading: 'lazy' }) : h('span', { class: 'item-thumb' });
    } else if (f.iconKey) {
      thumb = h('span', { class: 'item-thumb-ico' });
      if (it[f.iconKey]) thumb.appendChild(iconSvg(it[f.iconKey]));
    }

    var handle = h('span', { class: 'drag', title: 'اسحب لتغيير الترتيب', text: '⋮⋮' });
    var head = h('div', { class: 'item-head' },
      handle,
      h('span', { class: 'item-num', text: String(idx + 1) }),
      thumb,
      titleEl,
      it.hidden ? h('span', { class: 'badge', text: 'مخفي' }) : null,
      h('span', { class: 'item-actions' },
        h('button', { type: 'button', class: 'opt', title: 'لأعلى', text: '↑', disabled: idx === 0 ? true : null, onClick: function (e) { e.stopPropagation(); move(idx, idx - 1); } }),
        h('button', { type: 'button', class: 'opt', title: 'لأسفل', text: '↓', disabled: idx === arr.length - 1 ? true : null, onClick: function (e) { e.stopPropagation(); move(idx, idx + 1); } }),
        h('button', { type: 'button', title: it.hidden ? 'إظهار' : 'إخفاء بدون حذف', text: it.hidden ? '◌' : '◉', onClick: function (e) {
          e.stopPropagation(); structural(function () { if (it.hidden) delete it.hidden; else it.hidden = true; });
        } }),
        h('button', { type: 'button', class: 'opt', title: 'نسخ', text: '⧉', onClick: function (e) {
          e.stopPropagation(); var c = clone(it); openItems.add(uid(c)); structural(function () { arr.splice(idx + 1, 0, c); });
        } }),
        h('button', { type: 'button', class: 'del', title: 'حذف', text: '🗑', onClick: function (e) {
          e.stopPropagation();
          if (!confirm('حذف «' + (f.title(it) || 'العنصر') + '»؟\n(تقدر ترجعه بزر التراجع ↶)')) return;
          structural(function () { arr.splice(idx, 1); });
        } })
      ));
    head.addEventListener('click', function () {
      if (openItems.has(id)) openItems.delete(id); else openItems.add(id);
      renderEditor();
    });
    el.appendChild(head);

    function move(from, to) {
      if (to < 0 || to >= arr.length) return;
      structural(function () { arr.splice(to, 0, arr.splice(from, 1)[0]); });
    }

    // drag & drop (from the handle)
    handle.addEventListener('mousedown', function () { el.draggable = true; });
    handle.addEventListener('touchstart', function () { el.draggable = true; }, { passive: true });
    handle.addEventListener('click', function (e) { e.stopPropagation(); });
    el.addEventListener('dragstart', function (e) {
      e.stopPropagation();
      drag = { arr: arr, idx: idx };
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', String(idx)); } catch (x) { }
    });
    el.addEventListener('dragend', function () { el.draggable = false; el.classList.remove('dragging'); drag = null; clearDrop(); });
    el.addEventListener('dragover', function (e) {
      if (!drag || drag.arr !== arr) return;
      e.preventDefault(); e.stopPropagation();
      var r = el.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
      clearDrop();
      el.classList.add(after ? 'drop-after' : 'drop-before');
    });
    el.addEventListener('drop', function (e) {
      if (!drag || drag.arr !== arr) return;
      e.preventDefault(); e.stopPropagation();
      var r = el.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
      var from = drag.idx, to = idx + (after ? 1 : 0);
      if (from < to) to--;
      clearDrop();
      if (from !== to) move(from, to);
    });

    if (open) {
      var ctx = { path: listKey + '/' + id, onChange: function () {
        drawTitle();
        if (f.thumb && thumb && thumb.tagName === 'IMG') thumb.src = resolveUrl(getPath(it, f.thumb));
        if (f.iconKey && thumb) { thumb.replaceChildren(); if (it[f.iconKey]) thumb.appendChild(iconSvg(it[f.iconKey])); }
      } };
      el.appendChild(h('div', { class: 'item-body' }, h('div', { class: 'fields' }, f.fields.map(function (sf) { return renderField(it, sf, ctx); }))));
    }
    return el;
  }
  document.addEventListener('mouseup', function () { $$('.item[draggable="true"]').forEach(function (x) { if (!x.classList.contains('dragging')) x.draggable = false; }); });
  function clearDrop() { $$('.drop-before,.drop-after').forEach(function (x) { x.classList.remove('drop-before', 'drop-after'); }); }

  /* ============ pages ============ */
  function renderEditor() {
    var ed = $('#editor');
    var scroll = ed.scrollTop;
    var page = PAGES[state.page];
    ed.replaceChildren();
    var layoutEntry = (state.content.layout || []).filter(function (s) { return s.id === state.page; })[0];

    var head = h('div', { class: 'page-head' },
      h('div', null, h('h1', { text: page.title }), h('p', { text: page.desc })),
      h('span', { class: 'spacer' }));
    if (page.section && layoutEntry) {
      var cb = h('input', { type: 'checkbox', checked: layoutEntry.visible !== false });
      cb.addEventListener('change', function () { structural(function () { layoutEntry.visible = cb.checked; }); });
      head.appendChild(h('label', { class: 'switch vis-toggle' }, cb, 'إظهار القسم في الموقع'));
      var L = state.content.layout, li = L.indexOf(layoutEntry);
      var moveSec = function (d) { structural(function () { L.splice(li + d, 0, L.splice(li, 1)[0]); }); toast('تم تغيير ترتيب الأقسام'); };
      head.appendChild(h('button', { type: 'button', class: 'btn sm', title: 'تحريك القسم لأعلى في الصفحة', disabled: li === 0 ? true : null, onClick: function () { moveSec(-1); } }, '↑ لأعلى'));
      head.appendChild(h('button', { type: 'button', class: 'btn sm', title: 'تحريك القسم لأسفل في الصفحة', disabled: li === L.length - 1 ? true : null, onClick: function () { moveSec(1); } }, '↓ لأسفل'));
    }
    ed.appendChild(head);

    page.cards.forEach(function (card) {
      var obj = ensureObj(card.base);
      var c = h('div', { class: 'card' }, h('div', { class: 'card-title', text: card.title }));
      if (card.type === 'colors') {
        var grid = h('div', { class: 'colors' });
        THEME_LABELS.forEach(function (t) {
          var v = obj[t[0]] || DEFAULT_THEME[t[0]];
          var color = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(v) ? v : '#000000' });
          var text = h('input', { type: 'text', dir: 'ltr', value: v });
          color.addEventListener('input', function () { snapshot(); obj[t[0]] = color.value; text.value = color.value; changed(false); });
          text.addEventListener('input', function () { snapshot(); obj[t[0]] = text.value.trim(); if (/^#[0-9a-f]{6}$/i.test(text.value.trim())) color.value = text.value.trim(); changed(false); });
          grid.appendChild(h('div', { class: 'color-field' }, color, h('div', { class: 'cf-text' }, h('label', { text: t[1] }), text)));
        });
        c.appendChild(grid);
        c.appendChild(h('div', { style: 'margin-top:12px' }, h('button', { type: 'button', class: 'btn sm', onClick: function () {
          structural(function () { Object.assign(obj, DEFAULT_THEME); });
        } }, 'استرجاع الألوان الأصلية')));
      } else {
        c.appendChild(h('div', { class: 'fields' }, card.fields.map(function (f) { return renderField(obj, f, { path: card.base }); })));
      }
      ed.appendChild(c);
    });
    ed.scrollTop = scroll;
  }

  /* ---------- sidebar (with section ordering) ---------- */
  function renderSidebar() {
    $$('.sidebar .side-item[data-page]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-page') === state.page); });
    var list = $('#sectionList');
    list.replaceChildren();
    var layout = state.content.layout;
    layout.forEach(function (sec, idx) {
      var meta = SECTION_META[sec.id];
      if (!meta) return;
      var data = state.content[sec.id] || {};
      var n = Array.isArray(data[meta.list]) ? data[meta.list].length : 0;
      var eye = h('span', { class: 'eye', title: sec.visible === false ? 'إظهار القسم' : 'إخفاء القسم', text: sec.visible === false ? '◌' : '◉' });
      var b = h('div', { class: 'side-item' + (state.page === sec.id ? ' on' : '') + (sec.visible === false ? ' off' : ''), role: 'button', tabindex: '0' },
        h('span', { class: 'drag', title: 'اسحب لتغيير ترتيب الأقسام', text: '⋮⋮' }),
        h('span', { class: 'si-ico', text: meta.ico }),
        h('span', { class: 'grow', text: meta.label }),
        n ? h('span', { class: 'count', text: n }) : null,
        eye);
      b.addEventListener('click', function (e) {
        if (e.target === eye) { structural(function () { sec.visible = sec.visible === false; }); return; }
        go(sec.id);
      });
      b.draggable = true;
      b.addEventListener('dragstart', function (e) { drag = { layout: true, idx: idx }; b.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', sec.id); } catch (x) { } });
      b.addEventListener('dragend', function () { b.classList.remove('dragging'); drag = null; clearDrop(); });
      b.addEventListener('dragover', function (e) {
        if (!drag || !drag.layout) return;
        e.preventDefault();
        var r = b.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
        clearDrop(); b.classList.add(after ? 'drop-after' : 'drop-before');
      });
      b.addEventListener('drop', function (e) {
        if (!drag || !drag.layout) return;
        e.preventDefault();
        var r = b.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
        var from = drag.idx, to = idx + (after ? 1 : 0);
        if (from < to) to--;
        clearDrop();
        if (from !== to) {
          structural(function () { layout.splice(to, 0, layout.splice(from, 1)[0]); });
          toast('تم تغيير ترتيب الأقسام');
        }
      });
      list.appendChild(b);
    });
  }

  function go(page) {
    state.page = page;
    try { localStorage.setItem(LS_UI, JSON.stringify({ page: page })); } catch (e) { }
    renderSidebar();
    $('#editor').scrollTop = 0;
    renderEditor();
    $('#sidebar').classList.remove('open');
    postToPreview({ type: 'pv:scroll', id: page });
  }

  /* ============ preview ============ */
  var previewReady = false;
  var device = 'desktop';
  var DEVICES = { desktop: 1440, tablet: 820, mobile: 390 };
  function postToPreview(msg) {
    var fr = $('#previewFrame');
    if (previewReady && fr.contentWindow) fr.contentWindow.postMessage(msg, location.origin);
  }
  function sendPreview() { postToPreview({ type: 'pv:content', content: state.content, assets: state.assets }); }
  function fitPreview() {
    var stage = $('#previewStage'), fr = $('#previewFrame');
    var w = DEVICES[device], sw = stage.clientWidth, sh = stage.clientHeight;
    if (!sw) return;
    var scale = Math.min(1, (sw - (device === 'desktop' ? 0 : 24)) / w);
    fr.style.width = w + 'px';
    fr.style.height = (sh / scale) + 'px';
    fr.style.transform = 'scale(' + scale + ')';
  }
  window.addEventListener('message', function (e) {
    if (e.origin !== location.origin || !e.data) return;
    if (e.data.type === 'pv:ready') { previewReady = true; sendPreview(); postToPreview({ type: 'pv:scroll', id: state.page }); }
  });

  /* ============ GitHub ============ */
  var GH = {
    cfg: {},
    load: function () {
      var raw = null;
      try { raw = localStorage.getItem(LS_GH) || sessionStorage.getItem(LS_GH); } catch (e) { }
      this.cfg = raw ? JSON.parse(raw) : {};
      if (!this.cfg.owner) {
        var guess = guessRepo();
        this.cfg.owner = guess.owner; this.cfg.repo = guess.repo;
      }
      if (!this.cfg.path) this.cfg.path = 'content.json';
    },
    save: function (remember) {
      var s = JSON.stringify(this.cfg);
      try {
        localStorage.removeItem(LS_GH); sessionStorage.removeItem(LS_GH);
        (remember ? localStorage : sessionStorage).setItem(LS_GH, s);
      } catch (e) { }
    },
    connected: function () { return !!(this.cfg.token && this.cfg.owner && this.cfg.repo); },
    api: function (path, opts) {
      opts = opts || {};
      var headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', Authorization: 'Bearer ' + this.cfg.token };
      if (opts.body) headers['Content-Type'] = 'application/json';
      return fetch('https://api.github.com' + path, { method: opts.method || 'GET', headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined, cache: 'no-store' })
        .then(function (r) {
          return r.text().then(function (t) {
            var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { }
            if (!r.ok) { var err = new Error((j && j.message) || ('HTTP ' + r.status)); err.status = r.status; throw err; }
            return j;
          });
        });
    },
    repoPath: function () { return '/repos/' + encodeURIComponent(this.cfg.owner) + '/' + encodeURIComponent(this.cfg.repo); },
    filePath: function (p) { return this.repoPath() + '/contents/' + p.split('/').map(encodeURIComponent).join('/'); },
    ensureBranch: function () {
      var self = this;
      if (self.cfg.branch) return Promise.resolve(self.cfg.branch);
      return self.api(self.repoPath()).then(function (r) { self.cfg.branch = r.default_branch; return r.default_branch; });
    },
    getFile: function (p) {
      var self = this;
      return self.ensureBranch().then(function (br) {
        return self.api(self.filePath(p) + '?ref=' + encodeURIComponent(br));
      }).then(function (j) {
        return { sha: j.sha, text: b64ToUtf8(j.content || '') };
      });
    },
    putFile: function (p, b64, message, sha) {
      var self = this;
      return self.ensureBranch().then(function (br) {
        var body = { message: message, content: b64, branch: br };
        if (sha) body.sha = sha;
        return self.api(self.filePath(p), { method: 'PUT', body: body });
      });
    }
  };
  function guessRepo() {
    var host = location.hostname;
    if (/\.github\.io$/i.test(host)) {
      var owner = host.split('.')[0];
      var seg = location.pathname.split('/').filter(Boolean)[0];
      return { owner: owner, repo: seg && seg !== 'admin' ? seg : host };
    }
    return { owner: 'Mohammed-Amir-hegazy', repo: 'Peak-Vision' };
  }
  function utf8ToB64(str) {
    var bytes = new TextEncoder().encode(str), bin = '';
    for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function b64ToUtf8(b64) {
    var bin = atob(b64.replace(/\s/g, '')), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function ghErrorText(e) {
    if (e.status === 401) return 'الـ Token غير صحيح أو انتهت صلاحيته.';
    if (e.status === 403) return 'الـ Token مالوش صلاحية الكتابة (Contents: Read and write) على المستودع ده.';
    if (e.status === 404) return 'المستودع أو الفرع أو الملف مش موجود، أو الـ Token مش مسموح له يشوف المستودع.';
    if (e.status === 409) return 'حصل تعارض — حد نشر تعديلات في نفس الوقت. جرّب تاني.';
    return e.message || 'خطأ غير معروف';
  }

  function openGhDialog() {
    var d = $('#ghDialog');
    $('#ghOwner').value = GH.cfg.owner || '';
    $('#ghRepo').value = GH.cfg.repo || '';
    $('#ghBranch').value = GH.cfg.branch || '';
    $('#ghPath').value = GH.cfg.path || 'content.json';
    $('#ghToken').value = GH.cfg.token || '';
    $('#ghMsg').textContent = ''; $('#ghMsg').className = 'dlg-msg';
    if (!d.open) d.showModal();
  }
  $('#ghForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var msg = $('#ghMsg');
    var prev = GH.cfg;
    GH.cfg = { owner: $('#ghOwner').value.trim(), repo: $('#ghRepo').value.trim(), branch: $('#ghBranch').value.trim(), path: $('#ghPath').value.trim() || 'content.json', token: $('#ghToken').value.trim() };
    if (!GH.cfg.token) { msg.textContent = 'اكتب الـ Token'; msg.className = 'dlg-msg err'; return; }
    msg.textContent = 'جارٍ الاختبار…'; msg.className = 'dlg-msg';
    GH.api(GH.repoPath()).then(function (r) {
      if (!r.permissions || !r.permissions.push) throw Object.assign(new Error('no push'), { status: 403 });
      if (!GH.cfg.branch) GH.cfg.branch = r.default_branch;
      GH.save($('#ghRemember').checked);
      try { localStorage.removeItem(LS_SKIP); } catch (x) { }
      msg.textContent = '✓ تم الربط بنجاح'; msg.className = 'dlg-msg ok';
      setTimeout(function () { $('#ghDialog').close(); }, 600);
      toast('تم الربط بـ GitHub — تقدر تنشر دلوقتي', 'ok');
      refreshPublished(false);
    }).catch(function (err) {
      GH.cfg = prev.token ? prev : GH.cfg;
      if (!prev.token) GH.cfg.token = '';
      msg.textContent = '✕ ' + ghErrorText(err); msg.className = 'dlg-msg err';
    });
  });
  $('#ghSkip').addEventListener('click', function () {
    try { localStorage.setItem(LS_SKIP, '1'); } catch (e) { }
    $('#ghDialog').close();
    updateStatus();
  });

  /* ---------- image upload ---------- */
  function readAsDataURL(blob) {
    return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = rej; r.readAsDataURL(blob); });
  }
  async function shrink(file) {
    // Large photos are resized (max 2000px) and re-encoded to keep the site fast.
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 500 * 1024) return { blob: file, ext: (file.name.split('.').pop() || 'png').toLowerCase() };
    try {
      var bmp = await createImageBitmap(file);
      var sc = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
      var cv = document.createElement('canvas');
      cv.width = Math.round(bmp.width * sc); cv.height = Math.round(bmp.height * sc);
      cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
      var blob = await new Promise(function (r) { cv.toBlob(r, 'image/webp', 0.86); });
      if (blob && blob.size < file.size) return { blob: blob, ext: 'webp' };
    } catch (e) { }
    return { blob: file, ext: (file.name.split('.').pop() || 'png').toLowerCase() };
  }
  async function uploadImage(file, prefix) {
    if (!GH.connected()) {
      toast('لرفع الصور لازم تربط اللوحة بـ GitHub الأول — أو الصق رابط صورة في الخانة', 'err', 6000);
      openGhDialog();
      return null;
    }
    if (file.size > 20 * 1024 * 1024) { toast('الصورة كبيرة جدًا (الحد 20MB)', 'err'); return null; }
    updateStatus((prefix || '') + 'جارٍ رفع ' + file.name + '…', 'busy');
    try {
      var s = await shrink(file);
      var dataUrl = await readAsDataURL(s.blob);
      var base = file.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'image';
      var d = new Date();
      var path = 'uploads/' + d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '/' + Date.now().toString(36) + '-' + base + '.' + s.ext;
      await GH.putFile(path, dataUrl.split(',')[1], 'Upload image ' + path + ' (admin panel)');
      state.assets[path] = dataUrl;
      toast('✓ تم رفع الصورة — اضغط «نشر التغييرات» عشان تظهر في الموقع', 'ok');
      return path;
    } catch (e) {
      toast('فشل رفع الصورة: ' + ghErrorText(e), 'err', 7000);
      return null;
    } finally {
      updateStatus();
    }
  }

  /* ---------- load & publish ---------- */
  function normalize(c) {
    c.settings = c.settings || {};
    c.theme = c.theme || {};
    c.header = c.header || {};
    c.footer = c.footer || {};
    if (!Array.isArray(c.layout)) c.layout = [];
    Object.keys(SECTION_META).forEach(function (id) {
      if (!c.layout.some(function (s) { return s.id === id; })) c.layout.push({ id: id, visible: !!c[id] });
      if (!c[id]) c[id] = {};
    });
    return c;
  }

  function fetchPublished() {
    if (GH.connected()) {
      return GH.getFile(GH.cfg.path).then(function (f) { return { text: f.text, sha: f.sha }; });
    }
    return fetch(new URL('content.json?v=' + Date.now(), SITE_ROOT), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then(function (t) { return { text: t, sha: null }; });
  }

  function refreshPublished(replaceContent) {
    return fetchPublished().then(function (f) {
      var published = normalize(JSON.parse(f.text));
      state.publishedStr = serialize(published);
      state.sha = f.sha;
      if (replaceContent) { state.content = published; renderAll(); }
      updateStatus();
    }).catch(function (e) {
      toast('تعذّر تحميل المحتوى من GitHub: ' + ghErrorText(e), 'err', 7000);
    });
  }

  async function publish() {
    if (state.busy) return;
    if (!GH.connected()) { openGhDialog(); return; }
    if (!isDirty()) { toast('مفيش تعديلات جديدة للنشر'); return; }
    state.busy = true;
    updateStatus('جارٍ النشر…', 'busy');
    $('#btnPublish').disabled = true;
    try {
      var remote = await GH.getFile(GH.cfg.path).catch(function (e) { if (e.status === 404) return { sha: null, text: '' }; throw e; });
      if (remote.text && state.publishedStr && serialize(normalize(JSON.parse(remote.text))) !== state.publishedStr) {
        if (!confirm('المحتوى المنشور اتغير من جهاز تاني بعد ما فتحت اللوحة.\nلو كملت، تعديلاتك هتستبدله بالكامل. تكمل؟')) { return; }
      }
      var text = serialize(state.content);
      var res = await GH.putFile(GH.cfg.path, utf8ToB64(text), 'Update site content (admin panel)', remote.sha);
      state.sha = res && res.content ? res.content.sha : null;
      state.publishedStr = text;
      try { localStorage.removeItem(LS_DRAFT); } catch (e) { }
      toast('✓ تم النشر بنجاح! التعديلات هتظهر على الموقع خلال دقيقة أو اتنين.', 'ok', 7000);
    } catch (e) {
      toast('فشل النشر: ' + ghErrorText(e), 'err', 8000);
    } finally {
      state.busy = false;
      updateStatus();
    }
  }

  function exportJson() {
    var blob = new Blob([serialize(state.content)], { type: 'application/json' });
    var a = h('a', { href: URL.createObjectURL(blob), download: 'content.json' });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }
  $('#importFile').addEventListener('change', function () {
    var f = this.files[0]; this.value = '';
    if (!f) return;
    f.text().then(function (t) {
      var c = JSON.parse(t);
      if (!c || typeof c !== 'object' || !c.layout) throw new Error('bad');
      snapshot(true);
      state.content = normalize(c);
      changed(true); renderEditor();
      toast('تم استيراد النسخة — راجعها واضغط «نشر» لتطبيقها', 'ok');
    }).catch(function () { toast('الملف ده مش نسخة صحيحة من محتوى الموقع', 'err'); });
  });

  /* ============ wiring ============ */
  function renderAll() { renderSidebar(); renderEditor(); updateUndoButtons(); updateStatus(); sendPreview(); }

  $$('.sidebar .side-item[data-page]').forEach(function (b) {
    b.addEventListener('click', function () { go(b.getAttribute('data-page')); });
  });
  $('#btnPublish').addEventListener('click', publish);
  $('#btnUndo').addEventListener('click', function () { undoRedo(state.undo, state.redo); });
  $('#btnRedo').addEventListener('click', function () { undoRedo(state.redo, state.undo); });
  $('#btnMenu').addEventListener('click', function () { $('#sidebar').classList.toggle('open'); });
  $('#btnMore').addEventListener('click', function (e) { e.stopPropagation(); $('#moreMenu').hidden = !$('#moreMenu').hidden; });
  $('#moreMenu').addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b) return;
    $('#moreMenu').hidden = true;
    var act = b.getAttribute('data-act');
    if (act === 'export') exportJson();
    else if (act === 'import') $('#importFile').click();
    else if (act === 'github') openGhDialog();
    else if (act === 'discard') {
      if (!isDirty()) { toast('مفيش تعديلات غير منشورة'); return; }
      if (!confirm('إلغاء كل التعديلات اللي ما اتنشرتش والرجوع للنسخة المنشورة؟')) return;
      snapshot(true);
      state.content = normalize(JSON.parse(state.publishedStr));
      try { localStorage.removeItem(LS_DRAFT); } catch (x) { }
      changed(true); renderEditor();
    } else if (act === 'reload') {
      if (isDirty() && !confirm('هيتم استبدال تعديلاتك غير المنشورة بالنسخة المنشورة. تكمل؟')) return;
      try { localStorage.removeItem(LS_DRAFT); } catch (x) { }
      refreshPublished(true);
    } else if (act === 'logout') {
      try { localStorage.removeItem(LS_GH); sessionStorage.removeItem(LS_GH); } catch (x) { }
      GH.cfg.token = '';
      updateStatus();
      toast('تم تسجيل الخروج — الـ Token اتمسح من الجهاز ده');
    }
  });

  var layoutEl = $('.layout');
  var uiPrefs = {};
  try { uiPrefs = JSON.parse(localStorage.getItem(LS_UI) || '{}'); } catch (e) { }
  function togglePreview(force) {
    var narrow = innerWidth <= 1250;
    if (narrow) layoutEl.classList.toggle('show-preview', force != null ? force : !layoutEl.classList.contains('show-preview'));
    else layoutEl.classList.toggle('no-preview', force != null ? !force : !layoutEl.classList.contains('no-preview'));
    setTimeout(fitPreview, 30);
  }
  $('#btnPreviewToggle').addEventListener('click', function () { togglePreview(); });
  $('#btnPreviewClose').addEventListener('click', function () { togglePreview(false); });
  $$('.seg [data-dev]').forEach(function (b) {
    b.addEventListener('click', function () {
      device = b.getAttribute('data-dev');
      $$('.seg [data-dev]').forEach(function (x) { x.classList.toggle('on', x === b); });
      fitPreview();
    });
  });
  if (window.ResizeObserver) new ResizeObserver(fitPreview).observe($('#previewStage'));
  window.addEventListener('resize', fitPreview);

  document.addEventListener('keydown', function (e) {
    if (!(e.ctrlKey || e.metaKey)) return;
    var k = e.key.toLowerCase();
    if (k === 's') { e.preventDefault(); publish(); }
    else if ((k === 'z' && !e.shiftKey) && !/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) { e.preventDefault(); undoRedo(state.undo, state.redo); }
    else if ((k === 'y' || (k === 'z' && e.shiftKey)) && !/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) { e.preventDefault(); undoRedo(state.redo, state.undo); }
  });

  // anchors for link fields
  document.body.appendChild(h('datalist', { id: 'pv-anchors' },
    ['#top', '#about', '#stats', '#clients', '#services', '#work', '#contact', 'https://wa.me/201011650100', 'tel:+201011650100', 'mailto:'].map(function (v) { return h('option', { value: v }); })));

  /* ============ boot ============ */
  async function boot() {
    GH.load();
    if (uiPrefs.page && PAGES[uiPrefs.page]) state.page = uiPrefs.page;

    // icons: reuse the site's own SVG sprite so the admin shows exactly what the site shows
    try {
      var html = await fetch(new URL('index.html', SITE_ROOT), { cache: 'no-store' }).then(function (r) { return r.text(); });
      var m = html.match(/<svg[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/svg>/);
      if (m) {
        $('#sprite').innerHTML = m[0];
        state.icons = (m[0].match(/id="i-([a-z0-9-]+)"/g) || []).map(function (s) { return s.slice(6, -1); }).filter(function (i) { return i !== 'chevron-down'; });
      }
    } catch (e) { }

    try {
      var f = await fetchPublished();
      var published = normalize(JSON.parse(f.text));
      state.publishedStr = serialize(published);
      state.sha = f.sha;
      state.content = published;
    } catch (e) {
      updateStatus('تعذّر تحميل المحتوى', 'dirty');
      $('#editor').replaceChildren(h('div', { class: 'card' }, h('b', { text: 'تعذّر تحميل content.json' }), h('p', { class: 'muted', text: (e.status ? ghErrorText(e) : e.message) + ' — تأكد إن اللوحة شغالة من نفس مكان الموقع (وليس بفتح الملف مباشرة)، أو راجع إعدادات GitHub.' }),
        h('button', { class: 'btn', style: 'margin-top:10px', onClick: openGhDialog }, 'إعدادات GitHub')));
      if (GH.cfg.token) openGhDialog();
      return;
    }

    try {
      var d = JSON.parse(localStorage.getItem(LS_DRAFT) || 'null');
      if (d && d.content && serialize(normalize(d.content)) !== state.publishedStr) {
        state.content = normalize(d.content);
        toast('تم استرجاع تعديلاتك غير المنشورة من آخر مرة', 'ok', 6000);
      }
    } catch (e) { }

    $('#previewFrame').src = new URL('index.html?preview=1', SITE_ROOT).href;
    renderAll();
    fitPreview();

    var skipped = false; try { skipped = localStorage.getItem(LS_SKIP) === '1'; } catch (e) { }
    if (!GH.connected() && !skipped) openGhDialog();
  }
  boot();
})();
