/* Acrobacia Libre Awards 2027 — lógica compartida (login, API, subidas, modo demo) */
(function () {
  const CFG = window.AWARDS_CONFIG || {};
  const qs = new URLSearchParams(location.search);
  if (qs.get('demo') === '1') sessionStorage.setItem('awards_demo', '1');
  if (qs.get('demo') === '0') sessionStorage.removeItem('awards_demo');
  const MOCK = !!(CFG.MOCK || sessionStorage.getItem('awards_demo') === '1' || /PEGA_AQUI/.test(CFG.API_URL || 'PEGA_AQUI'));
  const DEMO = MOCK;
  const TOKEN_KEY = 'awards_token';
  const CHUNK = 8 * 1024 * 1024; // 8 MB (múltiplo de 256 KB)

  // ---------- helpers DOM ----------
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function toast(msg, type) {
    let box = $('#toasts');
    if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
    const t = document.createElement('div');
    t.className = 'toast ' + (type || '');
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => t.classList.add('out'), 3600);
    setTimeout(() => t.remove(), 4200);
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  }

  // ---------- token ----------
  function parseJwt(t) {
    try { return JSON.parse(decodeURIComponent(escape(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))))); }
    catch (e) { return null; }
  }
  function getToken() {
    const t = localStorage.getItem(TOKEN_KEY);
    if (!t) return null;
    if (t.startsWith('mock:')) return t;
    const p = parseJwt(t);
    if (!p || p.exp * 1000 < Date.now() + 60000) { localStorage.removeItem(TOKEN_KEY); return null; }
    return t;
  }
  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    try { google.accounts.id.disableAutoSelect(); } catch (e) { }
    location.reload();
  }

  // ---------- API ----------
  async function api(action, payload) {
    const token = getToken();
    if (MOCK) return Mock.call(action, token, payload || {});
    const res = await fetch(CFG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // evita preflight CORS
      body: JSON.stringify({ action, token, payload: payload || {} })
    });
    const j = await res.json();
    if (!j.ok) {
      if (j.code === 'AUTH') { localStorage.removeItem(TOKEN_KEY); }
      const e = new Error(j.error); e.code = j.code; throw e;
    }
    return j.data;
  }

  // ---------- login ----------
  function loadGis() {
    return new Promise((ok, fail) => {
      if (window.google && google.accounts) return ok();
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
      s.onload = ok; s.onerror = () => fail(new Error('No se pudo cargar el login de Google'));
      document.head.appendChild(s);
    });
  }
  async function ensureLogin(container) {
    if (getToken()) return;
    container.innerHTML = `
      <section class="card login">
        <div class="trophy">${ICONS.trophy}</div>
        <h2>Entra para participar</h2>
        <p class="muted">Usa tu cuenta de Gmail. Solo la usamos para que cada persona vote una vez.</p>
        <div id="gbtn"></div>
      </section>`;
    if (MOCK) {
      $('#gbtn').innerHTML = `<input id="mockmail" placeholder="correo de prueba" value="demo@gmail.com">
        <button class="btn gold" id="mockgo">Entrar (modo demo)</button>`;
      return new Promise(ok => {
        $('#mockgo').onclick = () => {
          const email = $('#mockmail').value.trim().toLowerCase() || 'demo@gmail.com';
          localStorage.setItem(TOKEN_KEY, 'mock:' + email); ok();
        };
      });
    }
    if (/Instagram|FBAN|FBAV|FB_IAB|Line\/|TikTok|musical_ly|Snapchat/i.test(navigator.userAgent)) {
      $('#gbtn').innerHTML = `<p style="color:var(--gold)"><b>Abre este link en Safari o Chrome.</b><br>Google no deja iniciar sesión dentro de Instagram/Facebook/TikTok. Toca los <b>⋯</b> arriba y elige “Abrir en el navegador”.</p>`;
      return new Promise(() => { });
    }
    await loadGis();
    return new Promise(ok => {
      google.accounts.id.initialize({
        client_id: CFG.CLIENT_ID,
        auto_select: true,
        callback: (r) => { localStorage.setItem(TOKEN_KEY, r.credential); ok(); }
      });
      google.accounts.id.renderButton($('#gbtn'), { theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with', locale: 'es' });
      google.accounts.id.prompt();
    });
  }

  // ---------- horario ----------
  function askHorario(container, me) {
    return new Promise(ok => {
      container.innerHTML = `
        <section class="card">
          <p class="eyebrow">Una sola pregunta antes de empezar</p>
          <h2>¿En qué horario asistes a Acrobacia Libre?</h2>
          <p class="muted">Así votarás y nominarás solo a la gente de tu horario. Ojo: queda fijo.</p>
          <div class="horarios">
            ${me.horarios.map(h => `<button class="hbtn" data-h="${h.id}"><b>${esc(h.name)}</b></button>`).join('')}
          </div>
        </section>`;
      $$('.hbtn', container).forEach(b => b.onclick = async () => {
        const h = me.horarios.find(x => x.id === b.dataset.h);
        if (!confirm('¿Confirmas el horario "' + h.name + '"? No se puede cambiar después.')) return;
        b.disabled = true;
        try { await api('setHorario', { horario: h.id }); me.user.horario = h.id; ok(); }
        catch (e) { toast(e.message, 'err'); b.disabled = false; }
      });
    });
  }

  /** Arranque común: login + me() + horario (opcional). Devuelve el objeto me. */
  async function boot(container, opts) {
    opts = opts || {};
    if (DEMO) document.body.insertAdjacentHTML('afterbegin', `<div class="demo-banner">MODO DEMO · datos de prueba guardados solo en este navegador <button onclick="AW.resetDemo()">reiniciar demo</button></div>`);
    for (let i = 0; i < 2; i++) {
      await ensureLogin(container);
      try {
        container.innerHTML = '<div class="loader"></div>';
        const me = await api('me');
        renderUserChip(me);
        if (opts.needHorario && !me.user.horario) await askHorario(container, me);
        return me;
      } catch (e) {
        if (e.code === 'AUTH') continue;
        container.innerHTML = `<section class="card"><h2>Ups</h2><p>${esc(e.message)}</p></section>`;
        throw e;
      }
    }
  }
  function renderUserChip(me) {
    const el = $('#userchip'); if (!el) return;
    const h = me.horarios.find(x => x.id === me.user.horario);
    el.innerHTML = `<span>${esc(me.user.name)}${h ? ' · <b>' + esc(h.name) + '</b>' : ''}</span>
      ${me.isAdmin ? '<a href="admin.html">Panel</a>' : ''}<button onclick="AW.logout()">Salir</button>`;
  }

  // ---------- medios ----------
  function imgUrl(id, size) {
    if (!id) return '';
    if (MOCK) return Mock.fileUrl(id) || '';
    return `https://drive.google.com/thumbnail?id=${id}&sz=w${size || 800}`;
  }
  function videoEmbed(n) {
    if (MOCK) {
      const u = Mock.fileUrl(n.fileId);
      return u ? `<video src="${u}" controls playsinline></video>`
        : `<div class="novideo"><img src="${imgUrl(n.thumbId)}"><span>Video demo</span></div>`;
    }
    return `<iframe src="https://drive.google.com/file/d/${n.fileId}/preview" allow="autoplay; fullscreen" allowfullscreen></iframe>`;
  }

  /** Crea una miniatura JPEG desde una foto o un video (frame). */
  function makeThumb(file, maxSide) {
    maxSide = maxSide || 1600;
    return new Promise((ok, fail) => {
      const url = URL.createObjectURL(file);
      const draw = (src, w, h) => {
        const k = Math.min(1, maxSide / Math.max(w, h));
        const c = document.createElement('canvas');
        c.width = Math.round(w * k); c.height = Math.round(h * k);
        c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
        c.toBlob(b => { URL.revokeObjectURL(url); b ? ok(b) : fail(new Error('No se pudo procesar')); }, 'image/jpeg', 0.85);
      };
      if (file.type.startsWith('image/')) {
        const img = new Image();
        img.onload = () => draw(img, img.naturalWidth, img.naturalHeight);
        img.onerror = () => fail(new Error('Formato de foto no soportado. Usa JPG o PNG.'));
        img.src = url;
      } else {
        const v = document.createElement('video');
        v.muted = true; v.playsInline = true; v.preload = 'auto';
        let done = false;
        const t = setTimeout(() => { if (!done) { done = true; URL.revokeObjectURL(url); ok(null); } }, 8000);
        v.onloadedmetadata = () => { v.currentTime = Math.min(1.5, (v.duration || 2) * 0.3); };
        v.onseeked = () => { if (done) return; done = true; clearTimeout(t); draw(v, v.videoWidth, v.videoHeight); };
        v.onerror = () => { if (!done) { done = true; clearTimeout(t); URL.revokeObjectURL(url); ok(null); } };
        v.src = url;
      }
    });
  }

  function blobToBase64(blob) {
    return new Promise((ok, fail) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result).split(',')[1]);
      r.onerror = fail;
      r.readAsDataURL(blob);
    });
  }

  /** Sube un archivo a Drive en trozos de 8 MB. onProgress(0..1) */
  async function uploadFile(file, purpose, onProgress, fileName) {
    if (MOCK) { onProgress && onProgress(1); return Mock.storeFile(file); }
    const { uploadId } = await api('startUpload', {
      fileName: fileName || file.name, mimeType: file.type || 'application/octet-stream', size: file.size, purpose
    });
    let offset = 0;
    while (offset < file.size) {
      const part = file.slice(offset, offset + CHUNK);
      const data = await blobToBase64(part);
      let r, tries = 0;
      while (true) {
        try { r = await api('uploadChunk', { uploadId, offset, data }); break; }
        catch (e) { if (++tries >= 3 || e.code === 'AUTH') throw e; await new Promise(s => setTimeout(s, 1500 * tries)); }
      }
      offset += part.size;
      onProgress && onProgress(offset / file.size);
      if (r.done) return r.fileId;
    }
    throw new Error('La subida no terminó');
  }

  const ICONS = {
    trophy: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"><path d="M20 8h24v14a12 12 0 0 1-24 0V8z"/><path d="M20 13H10v5a10 10 0 0 0 10 10M44 13h10v5a10 10 0 0 1-10 10"/><path d="M32 34v10M22 56h20l-3-12H25z"/></svg>',
    photo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="6" width="18" height="14" rx="2"/><circle cx="12" cy="13" r="3.5"/><path d="M8 6l1.5-2h5L16 6"/></svg>',
    video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="14" height="12" rx="2"/><path d="M16 10l6-3v10l-6-3z"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 12l5 5 9-10"/></svg>'
  };

  // =================== MODO DEMO (sin Google) ===================
  const Mock = (function () {
    const KEY = 'awards_mock_v1';
    const files = {}; // objectURLs de esta sesión
    const HOR = [{ id: 'AM', name: 'AM' }, { id: 'PM', name: 'PM' }, { id: 'MJ', name: 'Martes y Jueves' }, { id: 'FDS', name: 'Fin de semana' }];
    const CATS = [
      ['lesionado', 'Miss/Mister Lesionado', 'photo'], ['amigo', 'El/La amiga de todos', 'photo'], ['motivadora', 'El/La más motivadora', 'photo'],
      ['espiritu', 'Espíritu de Lucha', 'photo'], ['modelo', 'El/La mejor modelo de ejercicios', 'photo'], ['impuntual', 'Rey/Reina de la impuntualidad', 'photo'],
      ['kamikaze', 'El/La más kamikaze', 'photo'], ['caluga', 'El/La más Tony Caluga', 'photo'], ['revelacion', 'Alumno revelación', 'photo'],
      ['coqueta', 'El/La más coqueta', 'photo'], ['conversadora', 'El/La más conversadora', 'photo'], ['companero', 'Mejor compañer@', 'photo'],
      ['seca', 'El/La más seca', 'photo'], ['caida', 'Caída épica', 'video'], ['chascarro', 'Mejor chascarro', 'video'], ['paliza', 'Mejor Paliza a un profe', 'video']
    ].map(c => ({ id: c[0], name: c[1], type: c[2] }));
    const NAMES = ['Cami', 'Nico', 'Fran', 'Benja', 'Javi', 'Sofi', 'Mati', 'Coni', 'Seba', 'Vale', 'Tomás', 'Isi', 'Rocío', 'Diego', 'Flo', 'Pancho'];
    const COLORS = [['#ff6b6b', '#5f27cd'], ['#feca57', '#ff9f43'], ['#48dbfb', '#0abde3'], ['#1dd1a1', '#10ac84'], ['#f368e0', '#5f27cd'], ['#ff9ff3', '#ee5253']];
    function avatar(name, i) {
      const [a, b] = COLORS[i % COLORS.length];
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="750"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="600" height="750" fill="url(#g)"/><circle cx="300" cy="300" r="120" fill="rgba(255,255,255,.35)"/><path d="M120 750c0-120 80-220 180-220s180 100 180 220z" fill="rgba(255,255,255,.35)"/><text x="300" y="330" font-family="Arial" font-weight="bold" font-size="110" text-anchor="middle" fill="#fff">${name.slice(0, 2).toUpperCase()}</text></svg>`;
      return 'data:image/svg+xml;base64,' + btoa(svg);
    }
    function seed() {
      const s = { users: [], noms: [], votes: [], cfg: {}, ovr: {}, thumbs: {} };
      const now = Date.now();
      s.cfg.voteStart = new Date(now - 3600e3).toISOString();
      s.cfg.voteEnd = new Date(now + 7 * 86400e3).toISOString();
      let k = 0;
      CATS.forEach(c => {
        const groups = c.type === 'photo' ? HOR.map(h => h.id) : ['GENERAL'];
        groups.forEach(h => {
          const count = c.type === 'photo' ? 3 : 4;
          for (let i = 0; i < count; i++) {
            const name = NAMES[(k * 7 + i * 3) % NAMES.length];
            const tid = 't' + (++k);
            s.thumbs[tid] = avatar(name, k);
            s.noms.push({
              id: 'n' + k, categoryId: c.id, horario: h, nomineeName: name, description: c.type === 'video' ? 'Clip de prueba #' + (i + 1) : '',
              fileId: 'f' + k, thumbId: tid, mimeType: c.type === 'video' ? 'video/mp4' : 'image/jpeg', ext: c.type === 'video' ? 'mp4' : 'jpg',
              submitterEmail: 'alguien@gmail.com', submitterName: 'Alguien', status: i === 2 && h === 'PM' ? 'pending' : 'approved', createdAt: new Date().toISOString()
            });
          }
        });
      });
      // votantes falsos
      for (let u = 0; u < 46; u++) {
        const h = HOR[u % 4].id, email = 'votante' + u + '@gmail.com';
        s.users.push({ email, name: 'Votante ' + u, horario: h });
        CATS.forEach(c => {
          const g = c.type === 'photo' ? h : 'GENERAL';
          const opts = s.noms.filter(n => n.categoryId === c.id && n.horario === g && n.status === 'approved');
          if (!opts.length || Math.random() < 0.15) return;
          const pick = opts[Math.floor(Math.pow(Math.random(), 1.6) * opts.length)];
          s.votes.push({ email, categoryId: c.id, horario: g, nominationId: pick.id });
        });
      }
      return s;
    }
    function load() { try { return JSON.parse(localStorage.getItem(KEY)) || seed(); } catch (e) { return seed(); } }
    function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { console.warn('demo storage lleno'); } }
    let S = load(); save(S);
    const err = (code, m) => { const e = new Error(m); e.code = code; return e; };
    const phase = () => {
      const now = Date.now(), t = x => x ? new Date(x).getTime() : null;
      const ns = t(S.cfg.nomStart), ne = t(S.cfg.nomEnd), vs = t(S.cfg.voteStart), ve = t(S.cfg.voteEnd);
      return {
        now: new Date().toISOString(), nomStart: S.cfg.nomStart || '', nomEnd: S.cfg.nomEnd || '', voteStart: S.cfg.voteStart || '', voteEnd: S.cfg.voteEnd || '',
        nomOpen: (ns === null || now >= ns) && (ne === null || now <= ne), voteOpen: vs !== null && now >= vs && (ve === null || now <= ve), voteEnded: ve !== null && now > ve
      };
    };
    const pub = n => Object.assign({}, n);
    function results() {
      const noms = S.noms.filter(n => n.status === 'approved');
      const groups = [];
      CATS.forEach(c => (c.type === 'photo' ? HOR.map(h => h.id) : ['GENERAL']).forEach(h => {
        const key = c.id + '|' + h, list = noms.filter(n => n.categoryId === c.id && n.horario === h);
        const cnt = {}; list.forEach(n => cnt[n.id] = 0); const voters = {};
        S.votes.forEach(v => { if (v.categoryId === c.id && v.nominationId in cnt) { cnt[v.nominationId]++; voters[v.email] = 1; } });
        const o = S.ovr[key] || {};
        const nominees = list.map(n => {
          const ed = o.counts && o.counts[n.id] != null;
          return Object.assign(pub(n), { realVotes: cnt[n.id], votes: ed ? Number(o.counts[n.id]) : cnt[n.id], edited: !!ed });
        }).sort((a, b) => b.votes - a.votes);
        let w = (o.winnerIds || []).filter(id => id in cnt); const manual = w.length > 0;
        if (!manual && nominees.length && nominees[0].votes > 0) w = nominees.filter(n => n.votes === nominees[0].votes).map(n => n.id);
        groups.push({
          key, categoryId: c.id, horario: h, nominees, votesCast: nominees.reduce((s, n) => s + n.votes, 0),
          realVotesCast: nominees.reduce((s, n) => s + n.realVotes, 0), voters: Object.keys(voters).length,
          winnerIds: w, manualWinner: manual, tie: !manual && w.length > 1, edited: !!(o.counts || manual)
        });
      }));
      const all = {}; S.votes.forEach(v => all[v.email] = 1);
      const by = {}; Object.keys(all).forEach(e => { const u = S.users.find(x => x.email === e); const h = (u && u.horario) || '?'; by[h] = (by[h] || 0) + 1; });
      return { groups, totals: { votes: S.votes.length, participants: Object.keys(all).length, participantsByHorario: by, registered: S.users.length, nominations: noms.length } };
    }
    const A = {
      me(u) {
        let x = S.users.find(y => y.email === u.email);
        if (!x) { x = { email: u.email, name: u.email.split('@')[0], horario: '' }; S.users.push(x); save(S); }
        return { user: x, isAdmin: true, event: 'Acrobacia Libre Awards 2027', horarios: HOR, categories: CATS, phase: phase(), maxUploadMB: 500 };
      },
      setHorario(u, p) { const x = S.users.find(y => y.email === u.email); if (x.horario) throw err('LOCKED', 'Tu horario ya quedó registrado'); x.horario = p.horario; save(S); return { horario: p.horario }; },
      createNomination(u, p) {
        const x = S.users.find(y => y.email === u.email); const c = CATS.find(k => k.id === p.categoryId);
        if (!x.horario) throw err('NO_HORARIO', 'Primero elige tu horario');
        const n = {
          id: 'n' + Date.now(), categoryId: c.id, horario: c.type === 'photo' ? x.horario : 'GENERAL', nomineeName: p.nomineeName, description: p.description || '',
          fileId: p.fileId, thumbId: p.thumbId, mimeType: c.type === 'video' ? 'video/mp4' : 'image/jpeg', ext: (String(p.fileName || '').split('.').pop() || 'mp4').toLowerCase(),
          submitterEmail: u.email, submitterName: x.name, status: 'pending', createdAt: new Date().toISOString()
        };
        S.noms.push(n); save(S); return n;
      },
      myNominations(u) { return S.noms.filter(n => n.submitterEmail === u.email); },
      deleteMyNomination(u, p) { S.noms = S.noms.filter(n => !(n.id === p.id && n.submitterEmail === u.email && n.status === 'pending')); save(S); return {}; },
      getBallot(u) {
        const x = S.users.find(y => y.email === u.email); const ph = phase();
        const out = { phase: ph, horario: x.horario, categories: [], myVotes: {} };
        if (!ph.voteOpen) return out;
        CATS.forEach(c => { const g = c.type === 'photo' ? x.horario : 'GENERAL'; out.categories.push({ id: c.id, name: c.name, type: c.type, horario: g, nominees: S.noms.filter(n => n.status === 'approved' && n.categoryId === c.id && n.horario === g) }); });
        S.votes.filter(v => v.email === u.email).forEach(v => out.myVotes[v.categoryId] = v.nominationId);
        return out;
      },
      vote(u, p) {
        if (!phase().voteOpen) throw err('CLOSED', 'La votación no está abierta');
        S.votes = S.votes.filter(v => !(v.email === u.email && v.categoryId === p.categoryId));
        const x = S.users.find(y => y.email === u.email); const c = CATS.find(k => k.id === p.categoryId);
        S.votes.push({ email: u.email, categoryId: p.categoryId, horario: c.type === 'photo' ? x.horario : 'GENERAL', nominationId: p.nominationId }); save(S); return p;
      },
      adminData() {
        return {
          event: 'Acrobacia Libre Awards 2027', horarios: HOR, categories: CATS, phase: phase(), admins: S.cfg.admins || '', fixedAdmins: ['(demo)'],
          nominations: S.noms, users: S.users, results: results(), links: { sheet: '#', folder: '#', media: '#' }
        };
      },
      adminSetStatus(u, p) { (p.ids || [p.id]).forEach(id => { const n = S.noms.find(k => k.id === id); if (n) n.status = p.status; }); save(S); return {}; },
      adminUpdateNomination(u, p) {
        const n = S.noms.find(k => k.id === p.id);
        if (p.nomineeName !== undefined) n.nomineeName = p.nomineeName; if (p.description !== undefined) n.description = p.description;
        if (p.categoryId) { n.categoryId = p.categoryId; if (CATS.find(c => c.id === p.categoryId).type === 'video') n.horario = 'GENERAL'; }
        if (p.horario && n.horario !== 'GENERAL') n.horario = p.horario; save(S); return n;
      },
      adminSaveConfig(u, p) { ['nomStart', 'nomEnd', 'voteStart', 'voteEnd', 'admins'].forEach(k => { if (p[k] !== undefined) S.cfg[k] = p[k]; }); save(S); return phase(); },
      adminSaveOverride(u, p) { S.ovr[p.key] = { counts: p.counts || null, winnerIds: p.winnerIds || null }; save(S); return {}; },
      adminClearOverride(u, p) { delete S.ovr[p.key]; save(S); return {}; },
      adminSetUserHorario(u, p) { const x = S.users.find(y => y.email === p.email); x.horario = p.horario || ''; save(S); return x; },
      adminGetImages(u, p) { const o = {}; (p.ids || []).forEach(id => o[id] = S.thumbs[id] || null); return o; }
    };
    return {
      call(action, token, p) {
        return new Promise((ok, fail) => setTimeout(() => {
          try {
            if (!token) throw err('AUTH', 'Inicia sesión');
            if (!A[action]) throw err('BAD', 'Acción ' + action);
            ok(JSON.parse(JSON.stringify(A[action]({ email: token.slice(5) }, p))));
          } catch (e) { fail(e); }
        }, 120));
      },
      storeFile(file) {
        const id = 'up' + Date.now() + Math.random().toString(36).slice(2, 6);
        files[id] = URL.createObjectURL(file);
        if (file.type.startsWith('image/') && file.size < 400000) {
          blobToBase64(file).then(b => { S.thumbs[id] = 'data:' + file.type + ';base64,' + b; save(S); });
        }
        return Promise.resolve(id);
      },
      fileUrl(id) { return files[id] || S.thumbs[id] || null; },
      reset() { localStorage.removeItem(KEY); }
    };
  })();

  window.AW = {
    api, boot, toast, esc, $, $$, fmtDate, imgUrl, videoEmbed, makeThumb, uploadFile, blobToBase64, ICONS, logout,
    isMock: MOCK, resetDemo() { Mock.reset(); localStorage.removeItem(TOKEN_KEY); location.reload(); }
  };
})();
