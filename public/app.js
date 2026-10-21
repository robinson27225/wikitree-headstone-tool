'use strict';
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let S = { settings: {}, batches: [], stones: [], people: [] };
const view = { tab: 'todo', batch: '', q: '' };

// The Mac version talks to its server; the browser version (window.HWWeb) runs the same API in the page.
const WEB = !!window.HWWeb;
async function api(path, body, method) {
  if (WEB) return window.HWWeb.api(path, body, method);
  const res = await fetch(path, body === undefined && !method ? {} : { method: method || 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || res.statusText);
  return json;
}
const imgSrc = (stoneId) => (WEB ? window.HWWeb.imageUrl(stoneId, 'full') : `/img/${stoneId}`);
const thumbSrc = (stoneId) => (WEB ? window.HWWeb.imageUrl(stoneId, 'thumb') : `/thumb/${stoneId}`);
const personHref = (id) => `#/person/${id}`;

// Save a file result from the API (CSV, TSV, backup) through the browser
async function download(path) {
  const r = await api(path);
  const url = URL.createObjectURL(new Blob([r.text], { type: r.type + ';charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: r.filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
async function refresh() { S = await api('/api/state'); }
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2200); }

// One line saying how a photo was read
function readNote(o) {
  const both = o.engines.includes('Apple Vision') && o.engines.includes('PaddleOCR');
  if (both) return `Read with Apple Vision and PaddleOCR (${o.passes} image sizes). ${o.disagreements.length ? '' : 'All readings agreed.'}`;
  if (o.engines.includes('PaddleOCR')) return `Read with PaddleOCR at ${o.passes} image sizes; the readings voted letter by letter. ${o.disagreements.length ? '' : 'All readings agreed.'}`;
  return `Read with ${o.engines.join(' + ')} only. Install PaddleOCR (npm install) for a second reading.`;
}

function dispDate(iso) {
  const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(iso || '');
  if (!m || +m[1] === 0) return /^0000/.test(iso || '') ? '' : iso || '';
  return +m[3] ? `${+m[3]} ${MON[+m[2] - 1]} ${+m[1]}` : +m[2] ? `${MON[+m[2] - 1]} ${+m[1]}` : String(+m[1]);
}
const fullName = (p) => [p.given, p.surname, p.suffix].filter(Boolean).join(' ') || '(unnamed)';
const stone = (id) => S.stones.find((s) => s.id === id) || {};
const batchOf = (id) => S.batches.find((b) => b.id === id) || { cemetery: {} };
const wtUrl = (id) => `https://www.wikitree.com/wiki/${encodeURIComponent(id)}`;

/* ---------- router ---------- */
function nav(path) { location.hash = '#' + path; }
window.addEventListener('hashchange', () => route());
async function route() {
  await refresh();
  renderNav();
  const m = location.hash.match(/^#\/person\/(\w+)/);
  m ? await renderPerson(m[1]) : renderList();
  window.scrollTo(0, 0);
}
function renderNav() {
  $('#topnav').innerHTML = `<button id="n-import" class="primary">Import photos…</button><button id="n-check">Check WikiTree for all</button><button id="n-plot">Plot map…</button><button id="n-csv">Export CSV</button><button id="n-settings">Settings</button>`;
  $('#n-import').onclick = importDialog; $('#n-check').onclick = checkAll; $('#n-plot').onclick = plotDialog; $('#n-csv').onclick = () => download('/api/export.csv'); $('#n-settings').onclick = settingsDialog;
}

/* ---------- worklist ---------- */
function wtBadge(p) {
  if (p.wikitreeId) return `<a href="${wtUrl(p.wikitreeId)}" target="_blank" rel="noopener">${esc(p.wikitreeId)}</a>`;
  const t = { unchecked: ['Not checked', ''], match: ['Match found', 'ok'], possible: ['Possible match', 'warn'], none: ['Not on WikiTree', 'bad'], skipped: ['Needs name', 'warn'], error: ['Lookup failed', 'bad'] }[p.wt.state] || ['', ''];
  return `<span class="badge ${t[1]}">${t[0]}</span>`;
}
function filtered() {
  const q = view.q.trim().toLowerCase();
  return S.people.filter((p) => {
    if (view.batch && p.batchId !== view.batch) return false;
    if (q && !`${fullName(p)} ${p.maiden} ${p.wikitreeId}`.toLowerCase().includes(q)) return false;
    switch (view.tab) {
      case 'todo': return p.status === 'todo';
      case 'need': return p.status === 'todo' && !p.wikitreeId;
      case 'onwt': return p.status === 'todo' && !!p.wikitreeId;
      case 'done': return p.status === 'done';
      case 'skip': return p.status === 'skip';
      default: return true;
    }
  }).sort((a, b) => (a.surname || '~').localeCompare(b.surname || '~') || a.given.localeCompare(b.given));
}
function renderList() {
  const app = $('#app');
  if (!S.people.length && !S.stones.length) {
    app.innerHTML = `<div class="empty"><h2>No headstones yet</h2><p>${WEB ? 'Import headstone photos from your computer.' : 'Import a folder of photos or an album from Photos.'} Each headstone is read for names, dates and GPS, and every person becomes a line on this worklist.</p><button class="primary" id="e-import">Import photos…</button></div>`;
    $('#e-import').onclick = importDialog; return;
  }
  const c = (f) => S.people.filter(f).length;
  const tabs = [['todo', 'To do'], ['need', 'Need profile'], ['onwt', 'On WikiTree'], ['done', 'Done'], ['skip', 'Skipped'], ['all', 'All']];
  const rows = filtered();
  app.innerHTML = `
    <h1>Worklist</h1>
    <div class="chips">
      <span class="chip"><b>${c((p) => p.status === 'todo' && !p.wikitreeId)}</b> need a profile</span>
      <span class="chip"><b>${c((p) => p.status === 'todo' && p.wikitreeId)}</b> on WikiTree, to source</span>
      <span class="chip"><b>${c((p) => p.status === 'done')}</b> done</span>
      <span class="chip"><b>${S.stones.length}</b> photos</span>
    </div>
    <div class="toolbar">
      <div class="tabs">${tabs.map(([k, l]) => `<button data-tab="${k}" aria-pressed="${view.tab === k}">${l}</button>`).join('')}</div>
      <select id="f-batch" aria-label="Cemetery / album"><option value="">All albums</option>${S.batches.map((b) => `<option value="${b.id}" ${view.batch === b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select>
      <input id="f-q" type="search" placeholder="Search names or IDs" value="${esc(view.q)}">
      <span class="spacer"></span><span class="muted">${rows.length} shown</span>
    </div>
    <table><thead><tr><th></th><th>Name</th><th>Born</th><th>Died</th><th>WikiTree</th><th>Find a Grave</th><th>FamilySearch</th><th>WT photo</th><th>Status</th><th></th></tr></thead>
    <tbody>${rows.map((p) => `<tr data-id="${p.id}">
      <td class="thumb"><a href="${personHref(p.id)}"><img loading="lazy" src="${thumbSrc(p.stoneId)}" alt=""></a></td>
      <td><a class="name" href="${personHref(p.id)}">${esc(fullName(p))}</a>${p.maiden ? `<div class="sub">née ${esc(p.maiden)}</div>` : ''}<div class="sub">${esc(batchOf(p.batchId).cemetery.name || batchOf(p.batchId).name || '')}</div></td>
      <td>${esc(dispDate(p.birth))}</td><td>${esc(dispDate(p.death))}</td>
      <td>${wtBadge(p)}${p.wikitreeId ? '' : `<br><input class="wtid" placeholder="WikiTree ID" aria-label="WikiTree ID for ${esc(fullName(p))}" value="">`}</td>
      <td>${p.findagrave ? `<a target="_blank" rel="noopener" href="https://www.findagrave.com/memorial/${esc(p.findagrave)}">${esc(p.findagrave)}</a>` : '<span class="muted">–</span>'}</td>
      <td>${p.familysearch ? `<a target="_blank" rel="noopener" href="https://ancestors.familysearch.org/en/${esc(p.familysearch)}">${esc(p.familysearch)}</a>` : '<span class="muted">–</span>'}</td>
      <td>${stone(p.stoneId).photoUrl ? `<a target="_blank" rel="noopener" href="${esc(stone(p.stoneId).photoUrl)}">✓</a>` : '<span class="muted">–</span>'}</td>
      <td><select class="status" aria-label="Status"><option value="todo" ${p.status === 'todo' ? 'selected' : ''}>To do</option><option value="done" ${p.status === 'done' ? 'selected' : ''}>Done</option><option value="skip" ${p.status === 'skip' ? 'selected' : ''}>Skip</option></select></td>
      <td>${p.flags && p.flags.length ? `<span class="flags" title="${esc(p.flags.join('; '))}">⚠ ${p.flags.length}</span>` : ''}</td>
    </tr>`).join('') || `<tr><td colspan="10" class="muted" style="text-align:center;padding:30px">Nothing here.</td></tr>`}</tbody></table>`;
  app.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { view.tab = b.dataset.tab; renderList(); }));
  $('#f-batch').onchange = (e) => { view.batch = e.target.value; renderList(); };
  $('#f-q').oninput = (e) => { view.q = e.target.value; const pos = e.target.selectionStart; renderList(); const q = $('#f-q'); q.focus(); q.setSelectionRange(pos, pos); };
  app.querySelectorAll('tr[data-id]').forEach((tr) => {
    const id = tr.dataset.id;
    const w = tr.querySelector('.wtid');
    if (w) w.onchange = async () => { await api(`/api/people/${id}`, { wikitreeId: w.value }); toast('Saved WikiTree ID'); await refresh(); renderList(); };
    tr.querySelector('.status').onchange = async (e) => { await api(`/api/people/${id}`, { status: e.target.value }); await refresh(); renderList(); };
  });
}

/* ---------- person page ---------- */
async function renderPerson(id) {
  let d;
  try { d = await api(`/api/people/${id}`); } catch { $('#app').innerHTML = '<div class="empty"><h2>Person not found</h2><a href="#/">Back to worklist</a></div>'; return; }
  const { person: p, stone: st, batch, siblings } = d;
  const order = filtered().map((x) => x.id);
  const next = order[order.indexOf(id) + 1];
  const cem = batch.cemetery;
  const enc = encodeURIComponent;
  const deathY = (p.death || '').slice(0, 4).replace(/^0000$/, ''), birthY = (p.birth || '').slice(0, 4).replace(/^0000$/, '');
  const links = {
    wtSearch: `https://www.wikitree.com/index.php?title=Special:SearchPerson&wpFirst=${enc(p.given.split(' ')[0])}&wpLast=${enc(p.surname)}&wpBirthDate=${birthY}&wpDeathDate=${deathY}`,
    fgSearch: `https://www.findagrave.com/memorial/search?firstname=${enc(p.given.split(' ')[0])}&lastname=${enc(p.surname)}&deathyear=${deathY}&deathyearfilter=5${cem.name ? '&cemeteryName=' + enc(cem.name) : ''}`,
    fsSearch: `https://www.familysearch.org/search/tree/results?q.givenName=${enc(p.given)}&q.surname=${enc(p.surname)}&q.deathLikeDate.from=${deathY}&q.deathLikeDate.to=${deathY}`,
  };
  $('#app').innerHTML = `
  <div class="crumbs"><a href="#/">← Worklist</a> ${next ? `· <a href="${personHref(next)}">Next person →</a>` : ''}</div>
  <h1 id="pname">${esc(fullName(p))}</h1>
  <div class="person-grid">
    <div>
      <div class="card photo" id="photo"><img src="${imgSrc(st.id)}" alt="Headstone photo of ${esc(fullName(p))}"></div>
      ${siblings.length ? `<div class="card"><h2>Also on this stone</h2>${siblings.map((s) => `<div><a href="${personHref(s.id)}">${esc(fullName(s))}</a> <span class="muted">${esc(dispDate(s.birth))}–${esc(dispDate(s.death))}</span></div>`).join('')}<div style="margin-top:8px"><button class="small" id="addperson">+ Add another person from this stone</button></div></div>` : `<div class="card"><button class="small" id="addperson">+ Add another person from this stone</button></div>`}
      <div class="card"><h2>Text read from the photo</h2><pre class="ocr">${esc(st.inscription || '(nothing recognised)')}</pre>
        ${st.ocr ? `<p class="muted" style="margin:8px 0 0;font-size:13px">${esc(readNote(st.ocr))}</p>
        ${st.ocr.disagreements.length ? `<div style="margin-top:6px;font-size:13px"><b>The readings differed on these lines:</b>${st.ocr.disagreements.map((x) => `<div style="margin:4px 0;padding:6px 8px;background:${x.severity === 'minor' ? 'var(--bg)' : 'var(--warn-bg)'};border-radius:6px"><div>Used: <b>${esc(x.used)}</b> <span class="muted">(${esc(x.engine === 'paddle' ? "PaddleOCR's reading" : x.engine === 'vision' ? "Apple Vision's reading" : x.severity === 'minor' ? 'small difference, a clear majority of readings agreed' : 'letters voted across all the readings')})</span></div><div class="muted">${x.vision ? `Apple Vision: ${esc(x.vision)}<br>` : ''}PaddleOCR${st.ocr.passes > 1 ? ` (${st.ocr.passes} image sizes)` : ''}: ${esc(x.paddle)}</div></div>`).join('')}</div>` : ''}` : ''}
        <div class="row" style="margin-top:8px"><button class="small" id="rescan">Re-read photo</button><span class="muted" style="font-size:12px">${esc(st.name)}</span></div></div>
    </div>
    <div>
      <div class="card"><h2>Person <span class="savestate" id="save"></span></h2>
        <div class="fields">
          <div><label for="f-given">Given names</label><input id="f-given" data-k="given" value="${esc(p.given)}"></div>
          <div><label for="f-surname">Surname</label><input id="f-surname" data-k="surname" value="${esc(p.surname)}"></div>
          <div><label for="f-maiden">Maiden name</label><input id="f-maiden" data-k="maiden" value="${esc(p.maiden)}"></div>
          <div><label for="f-suffix">Suffix</label><input id="f-suffix" data-k="suffix" value="${esc(p.suffix)}" placeholder="Jr, Sr, III"></div>
          <div><label for="f-birth">Date of birth</label><input id="f-birth" data-k="birth" data-date value="${esc(dispDate(p.birth))}" placeholder="1905 or 5 Jan 1905"></div>
          <div><label for="f-death">Date of death</label><input id="f-death" data-k="death" data-date value="${esc(dispDate(p.death))}" placeholder="1919 or 12 Feb 1919"></div>
          <div class="full"><label for="f-wt">WikiTree ID</label><div class="idrow"><input id="f-wt" data-k="wikitreeId" value="${esc(p.wikitreeId)}" placeholder="Taylor-133877">${p.wikitreeId ? `<a id="wtlink" target="_blank" rel="noopener" href="${wtUrl(p.wikitreeId)}">Open ↗</a>` : ''}</div></div>
          <div><label for="f-fg">Find a Grave memorial</label><div class="idrow"><input id="f-fg" data-k="findagrave" value="${esc(p.findagrave)}" placeholder="ID or URL">${p.findagrave ? `<a target="_blank" rel="noopener" href="https://www.findagrave.com/memorial/${esc(p.findagrave)}">Open ↗</a>` : ''}</div></div>
          <div><label for="f-fs">FamilySearch ID</label><div class="idrow"><input id="f-fs" data-k="familysearch" value="${esc(p.familysearch)}" placeholder="ID or URL">${p.familysearch ? `<a target="_blank" rel="noopener" href="https://ancestors.familysearch.org/en/${esc(p.familysearch)}">Open ↗</a>` : ''}</div></div>
          <div class="full"><label for="f-photo">Headstone photo on WikiTree</label>
            <div class="idrow"><input id="f-photo" data-stone="photoUrl" value="${esc(st.photoUrl)}" placeholder="Paste the photo's link, its image page, or file name (Bears-1.jpg)">${st.photoUrl ? `<a target="_blank" rel="noopener" href="${esc(d.photoPage || st.photoUrl)}">Open ↗</a>` : ''}</div>
            <div class="muted" style="font-size:12px;margin-top:3px">Upload the photo to the person's WikiTree profile first. One photo is shared by everyone on this stone.</div>
            ${st.photoUrl ? `<img class="wtphoto" src="${esc(st.photoUrl)}" alt="Headstone photo on WikiTree" onerror="this.remove()" style="margin-top:6px;max-height:110px;border-radius:6px;display:block">` : ''}</div>
          <div class="full"><label for="f-notes">Notes</label><textarea id="f-notes" data-k="notes" rows="2">${esc(p.notes)}</textarea></div>
          <div><label for="f-status">Status</label><select id="f-status" data-k="status"><option value="todo" ${p.status === 'todo' ? 'selected' : ''}>To do</option><option value="done" ${p.status === 'done' ? 'selected' : ''}>Done</option><option value="skip" ${p.status === 'skip' ? 'selected' : ''}>Skip</option></select></div>
        </div>
        ${p.flags && p.flags.length ? `<p class="flags" style="margin:10px 0 0">⚠ Check: ${esc(p.flags.join('; '))}</p>` : ''}
      </div>
      <div class="card"><h2>WikiTree match</h2>
        <div class="row" style="margin-bottom:6px"><span id="wtstate"></span><button class="small" id="wtcheck">Check WikiTree</button>
          <a class="btn small" target="_blank" rel="noopener" href="${links.wtSearch}">Search on WikiTree ↗</a><a class="btn small" target="_blank" rel="noopener" href="https://www.wikitree.com/wiki/Special:AddPerson">Add person ↗</a></div>
        <div id="cands"></div>
        <div class="row" style="margin-top:8px"><a class="btn small" target="_blank" rel="noopener" href="${links.fgSearch}">Search Find a Grave ↗</a><a class="btn small" target="_blank" rel="noopener" href="${links.fsSearch}">Search FamilySearch ↗</a></div>
      </div>
      <div class="card"><h2>Location and photo</h2>
        <div class="fields">
          <div><label for="f-lat">GPS latitude</label><input id="f-lat" data-stone="lat" value="${st.lat == null ? '' : (+st.lat).toFixed(6)}"></div>
          <div><label for="f-lon">GPS longitude</label><input id="f-lon" data-stone="lon" value="${st.lon == null ? '' : (+st.lon).toFixed(6)}"></div>
          <div class="full"><label for="f-taken">Photo taken (yyyy:mm:dd hh:mm:ss)</label><input id="f-taken" data-stone="takenAt" value="${esc(st.takenAt)}"></div>
        </div>
        <details style="margin-top:10px" ${st.plot || st.section || st.row || st.monument || st.reference ? 'open' : ''}><summary>Plot map details <span class="muted">(optional, shared by everyone on this stone)</span></summary>
          <div class="fields" style="margin-top:8px">
            <div><label for="f-section">Section</label><input id="f-section" data-stone="section" value="${esc(st.section)}"></div>
            <div><label for="f-plot">Plot</label><input id="f-plot" data-stone="plot" value="${esc(st.plot)}"></div>
            <div><label for="f-row">Row</label><input id="f-row" data-stone="row" value="${esc(st.row)}"></div>
            <div><label for="f-monument">Monument (heading on the stone)</label><input id="f-monument" data-stone="monument" value="${esc(st.monument)}"></div>
            <div class="full"><label for="f-reference">Reference</label><input id="f-reference" data-stone="reference" value="${esc(st.reference)}"></div>
          </div></details>
        <p class="muted" style="margin:10px 0 0">${esc([cem.name, cem.city, cem.county, cem.state].filter(Boolean).join(', ') || 'No cemetery set')} · <a href="#" id="editcem">edit cemetery</a>${st.lat != null ? ` · <a target="_blank" rel="noopener" href="https://www.google.com/maps?q=${st.lat},${st.lon}">map ↗</a>` : ' · <span class="flags">no GPS in photo</span>'}</p>
      </div>
      <div class="card"><h2>Monumental inscription source</h2>
        <pre class="cite" id="cite">${esc(d.citation)}</pre>
        <div class="row"><button class="primary small" id="copycite">Copy citation</button><span class="muted" style="font-size:12px">Paste into the Sources section of the profile.</span></div>
        ${S.settings.photographer && S.settings.photographer.name ? '' : '<p class="flags" style="margin:8px 0 0;font-size:13px">Add your name and WikiTree ID under Settings to get "Photographed by: …" in the citation.</p>'}
      </div>
    </div>
  </div>
  <script type="application/json" id="headstone-person-data"></script>`;

  const sourcerBlock = async () => { try { $('#headstone-person-data').textContent = JSON.stringify(await api(`/api/people/${id}/sourcer.json`)); } catch {} };
  sourcerBlock();
  const showWt = (q) => {
    const wt = q.wt || { state: 'unchecked', candidates: [] };
    const msg = { unchecked: 'Not checked yet.', match: 'Strong match found.', possible: 'Possible match — please verify.', none: 'No matching profile found; this person probably needs a new profile.', skipped: wt.note || 'Needs a given name and surname.', error: 'Lookup failed: ' + (wt.note || '') }[wt.state] || '';
    $('#wtstate').innerHTML = `<span class="badge ${wt.state === 'match' ? 'ok' : wt.state === 'possible' ? 'warn' : wt.state === 'none' || wt.state === 'error' ? 'bad' : ''}">${esc(msg)}</span>${wt.autoFilled && q.wikitreeId === wt.best ? ' <span class="muted">ID filled in automatically.</span>' : ''}`;
    $('#cands').innerHTML = (wt.candidates || []).map((c) => `<div class="cand"><div><a target="_blank" rel="noopener" href="${wtUrl(c.wikitreeId)}"><b>${esc(c.wikitreeId)}</b></a> ${esc(c.name)} <span class="badge">${c.score}</span></div>
      <button class="small" data-use="${esc(c.wikitreeId)}" ${q.wikitreeId === c.wikitreeId ? 'disabled' : ''}>${q.wikitreeId === c.wikitreeId ? 'In use' : 'Use this ID'}</button>
      <div class="meta">b. ${esc(dispDate(c.birthDate))} ${esc(c.birthLocation)}<br>d. ${esc(dispDate(c.deathDate))} ${esc(c.deathLocation)}<br>Matched: ${esc(c.reasons.join(', ') || 'nothing')}</div></div>`).join('');
    $('#cands').querySelectorAll('[data-use]').forEach((b) => (b.onclick = async () => { $('#f-wt').value = b.dataset.use; await save({ wikitreeId: b.dataset.use }); route(); }));
  };
  showWt(p);

  async function save(fields) {
    $('#save').textContent = 'Saving…';
    const r = await api(`/api/people/${id}`, fields);
    $('#save').textContent = 'Saved';
    $('#cite').textContent = r.citation;
    $('#pname').textContent = fullName(r.person);
    for (const k of ['birth', 'death']) { const el = $(`#f-${k}`); if (el) { el.classList.toggle('invalid', r.badDates.includes(k)); if (!r.badDates.includes(k)) el.value = dispDate(r.person[k]); } }
    sourcerBlock();
    return r;
  }
  document.querySelectorAll('[data-k]').forEach((el) => (el.onchange = async () => {
    const r = await save({ [el.dataset.k]: el.value });
    if (['wikitreeId', 'findagrave', 'familysearch'].includes(el.dataset.k)) route();
    else if (el.dataset.k === 'status') toast('Status saved');
    void r;
  }));
  document.querySelectorAll('[data-stone]').forEach((el) => (el.onchange = async () => {
    const saved = await api(`/api/stones/${st.id}`, { [el.dataset.stone]: el.value });
    $('#cite').textContent = (await api(`/api/people/${id}/citation`)).citation; sourcerBlock();
    if (el.dataset.stone === 'photoUrl') { toast(saved.photoUrl ? 'Photo link saved' : 'Photo link cleared'); route(); }
  }));
  $('#wtcheck').onclick = async (e) => { e.target.disabled = true; e.target.textContent = 'Checking…'; const q = await api(`/api/people/${id}/check`, {}); route(); void q; };
  $('#copycite').onclick = async () => { await navigator.clipboard.writeText($('#cite').textContent); toast('Citation copied'); };
  $('#rescan').onclick = async (e) => {
    e.target.textContent = 'Reading…'; e.target.disabled = true;
    try {
      const r = await api(`/api/stones/${st.id}/rescan`, {});
      toast(`${r.added} new person(s) found`);
      await refresh();
      // Untouched people are replaced by the new reading, so their pages have new addresses
      const next = S.people.find((q) => q.id === id) || S.people.find((q) => q.stoneId === st.id);
      if (next && next.id !== id) nav(`/person/${next.id}`); else if (!next) nav('/'); else route();
    } catch (err) { toast(err.message); route(); }
  };
  $('#addperson').onclick = async () => { const n = await api('/api/people', { stoneId: st.id }); nav(`/person/${n.id}`); };
  $('#editcem').onclick = (e) => { e.preventDefault(); batchDialog(batch); };
  $('#photo').onclick = () => $('#photo').classList.toggle('zoomed');
}

/* ---------- dialogs ---------- */
function openDialog(html) { const d = $('#dlg'); d.innerHTML = html; d.showModal(); return d; }
function cemFields(c = {}) {
  const f = (k, l, ph = '', full = false) => `<div class="${full ? 'full' : ''}"><label for="c-${k}">${l}</label><input id="c-${k}" data-c="${k}" value="${esc(c[k] || '')}" placeholder="${esc(ph)}"></div>`;
  return `<div class="grid2">${f('name', 'Cemetery name', 'Fairmont Cemetery', true)}${f('space', 'WikiTree Space page', 'Fairmont_Cemetery_Raton_NM_USA', true)}${f('category', 'WikiTree category (for the plot map)', 'Category:Fairmont_Cemetery,_Raton,_New_Mexico', true)}${f('tablePage', 'Plot map table page title', 'Fairmont Cemetery Raton NM USA Plot Map Table', true)}${f('city', 'City', 'Raton')}${f('county', 'County', 'Colfax')}${f('state', 'State / province', 'New Mexico')}${f('country', 'Country', 'United States of America')}</div>`;
}
const readCem = (root) => Object.fromEntries([...root.querySelectorAll('[data-c]')].map((e) => [e.dataset.c, e.value.trim()]));

function batchDialog(batch) {
  const d = openDialog(`<h2>Cemetery for “${esc(batch.name)}”</h2>${cemFields(batch.cemetery)}<div class="row" style="margin-bottom:6px"><button class="small" id="findgps">Find cemetery from photo GPS</button><span class="muted" id="gpsmsg" style="font-size:12px">Fills in the name, town, county, state and WikiTree Space page.</span></div><div class="row"><button class="small" id="findcat">Look up category on WikiTree</button><span class="muted" id="findmsg" style="font-size:12px">Uses the Space page above, or profiles from this album already on WikiTree.</span></div><div class="actions"><button id="x">Cancel</button><button class="primary" id="ok">Save</button></div>`);
  $('#findgps', d).onclick = async () => {
    $('#gpsmsg', d).textContent = 'Looking…';
    try {
      const r = await api(`/api/batches/${batch.id}/find-cemetery`, { force: true });
      const c = r.cemetery || {};
      for (const k of ['name', 'space', 'city', 'county', 'state', 'country']) if (c[k] && $('#c-' + k, d)) $('#c-' + k, d).value = c[k];
      $('#gpsmsg', d).textContent = (r.found ? 'Found. ' : '') + (r.notes || []).join(' ');
    } catch (e) { $('#gpsmsg', d).textContent = e.message; }
  };
  $('#findcat', d).onclick = async () => {
    $('#findmsg', d).textContent = 'Looking…';
    try {
      await api(`/api/batches/${batch.id}`, { cemetery: { space: $('#c-space', d).value.trim(), name: $('#c-name', d).value.trim(), city: $('#c-city', d).value.trim() } });
      const r = await api(`/api/batches/${batch.id}/wikitree-check`, { force: true });
      if (r.category) { $('#c-category', d).value = r.category; $('#findmsg', d).textContent = `Found (${r.source}).`; }
      else $('#findmsg', d).textContent = ((r.lookup && r.lookup.notes) || []).join(' ') || 'No cemetery category found.';
    } catch (e) { $('#findmsg', d).textContent = e.message; }
  };
  $('#x', d).onclick = () => d.close();
  $('#ok', d).onclick = async () => { await api(`/api/batches/${batch.id}`, { cemetery: readCem(d) }); d.close(); toast('Cemetery saved'); route(); };
}

function settingsDialog() {
  const ph = S.settings.photographer || {};
  const d = openDialog(`<h2>Settings</h2>
    <div class="grid2"><div><label for="s-name">Photographer name</label><input id="s-name" value="${esc(ph.name)}" placeholder="Azure Robinson"></div>
    <div><label for="s-id">Photographer WikiTree ID</label><input id="s-id" value="${esc(ph.wikitreeId)}" placeholder="Robinson-27225"></div>
    <div class="full"><label for="s-country">Default country</label><input id="s-country" value="${esc(S.settings.defaultCountry)}"></div></div>
    ${S.batches.length ? `<h2 style="margin-top:14px">Albums and cemeteries</h2>${S.batches.map((b) => `<div class="row" style="margin-bottom:6px"><span>${esc(b.name)} <span class="muted">— ${esc(b.cemetery.name || 'no cemetery set')}</span></span><span class="spacer"></span><button class="small" data-b="${b.id}">Edit</button></div>`).join('')}` : ''}
    <h2 style="margin-top:14px">Text reading</h2><div id="engines" class="muted">Checking…</div>
    ${WEB ? `<div style="margin-top:8px"><label for="s-passes">Thoroughness: how many times each photo is read (about 3 seconds each; the readings vote letter by letter)</label><select id="s-passes" style="width:auto"><option value="3" ${S.settings.passes == 3 ? 'selected' : ''}>3 readings (fastest)</option><option value="5" ${!S.settings.passes || S.settings.passes == 5 ? 'selected' : ''}>5 readings (recommended)</option><option value="7" ${S.settings.passes == 7 ? 'selected' : ''}>7 readings (most careful)</option></select></div>` : ''}
    <h2 style="margin-top:14px">Your data</h2>
    <div class="row"><button class="small" id="backup">Download backup (JSON)</button><span class="muted" style="font-size:12px">${WEB ? 'Your worklist is kept in this browser only. Clearing site data erases it, so download a backup now and then.' : 'The worklist file is data/worklist.json.'}</span></div>
    <div class="actions"><button id="x">Close</button><button class="primary" id="ok">Save</button></div>`);
  api('/api/engines').then((r) => { $('#engines', d).innerHTML = r.engines.map((e) => `<div>${e.available ? '✓' : '✗'} <b>${esc(e.name)}</b> ${e.available ? '' : esc(e.note || '')}</div>`).join('') + '<div style="margin-top:4px;font-size:13px">Photos are read with every engine that is installed and the results are combined.</div>'; }).catch(() => {});
  $('#backup', d).onclick = () => download('/api/backup.json');
  d.querySelectorAll('[data-b]').forEach((b) => (b.onclick = () => batchDialog(S.batches.find((x) => x.id === b.dataset.b))));
  $('#x', d).onclick = () => d.close();
  $('#ok', d).onclick = async () => {
    await api('/api/settings', { photographer: { name: $('#s-name', d).value.trim(), wikitreeId: $('#s-id', d).value.trim() }, defaultCountry: $('#s-country', d).value.trim(), ...(WEB ? { passes: +$('#s-passes', d).value } : {}) });
    d.close(); toast('Settings saved'); route();
  };
}

async function pollJob(job, d, onDone) {
  const bar = $('.progress > div', d), log = $('.log', d), cur = $('#cur', d);
  for (;;) {
    const j = await api(`/api/jobs/${job.id}`);
    bar.style.width = j.total ? `${Math.round((j.done / j.total) * 100)}%` : '5%';
    cur.textContent = j.status === 'running' ? `${j.current || 'Working…'} ${j.total ? `(${j.done}/${j.total})` : ''}` : j.status === 'done' ? `Finished: ${j.done} done.` : `Error: ${j.error}`;
    log.textContent = j.log.join('\n'); log.scrollTop = log.scrollHeight;
    if (j.status !== 'running') { onDone(j); return; }
    await new Promise((r) => setTimeout(r, 700));
  }
}

function importDialog() {
  const sourceHtml = WEB ? `
      <div class="full"><label for="i-files">Headstone photos</label>
        <input id="i-files" type="file" multiple accept="image/*,.heic,.heif">
        <div class="muted" style="font-size:12px;margin-top:3px">Choose several at once (JPEG, PNG or HEIC). Photos stay on this computer; nothing is uploaded. Keep this page open until the import finishes. For GPS, use the original photos (not copies from messaging apps, which strip it).</div></div>`
    : `
      <div class="full"><label>Source</label><div class="row"><label style="margin:0;color:inherit"><input type="radio" name="kind" value="album" checked style="width:auto"> Photos album</label><label style="margin:0;color:inherit"><input type="radio" name="kind" value="folder" style="width:auto"> Folder</label></div></div>
      <div class="full" id="src-album"><label for="i-album">Album</label><select id="i-album"><option>Loading albums…</option></select></div>
      <div class="full" id="src-folder" hidden><label for="i-folder">Folder path</label><div class="idrow"><input id="i-folder" placeholder="~/Pictures/Fairmont"><button id="choose" type="button">Choose…</button></div></div>`;
  const d = openDialog(`<h2>Import headstone photos</h2>
    <div class="grid2">${sourceHtml}
    </div>
    <h2 style="margin-top:6px">Cemetery</h2>
    <p class="muted" style="margin:0 0 6px;font-size:13px">Leave the cemetery name blank to find it from the photos' GPS (OpenStreetMap, then WikiTree). Fill it in to use your own.</p>${cemFields({ country: S.settings.defaultCountry })}
    <label style="color:inherit"><input type="checkbox" id="i-wt" checked style="width:auto"> Check WikiTree for each person after reading</label>
    <div id="prog" hidden><div class="progress"><div></div></div><div id="cur" class="muted"></div><div class="log"></div></div>
    <div class="actions"><button id="x">Cancel</button><button class="primary" id="go">Import</button></div>`);
  if (!WEB) {
    const sel = $('#i-album', d);
    api('/api/albums').then((r) => { sel.innerHTML = r.albums.map((a) => `<option>${esc(a)}</option>`).join('') || '<option value="">(no albums)</option>'; })
      .catch((e) => { sel.innerHTML = `<option value="">${esc(e.message)}</option>`; });
    d.querySelectorAll('[name=kind]').forEach((r) => (r.onchange = () => { const album = d.querySelector('[name=kind]:checked').value === 'album'; $('#src-album', d).hidden = !album; $('#src-folder', d).hidden = album; }));
    $('#choose', d).onclick = async () => { const r = await api('/api/choose-folder', {}); if (r.path) $('#i-folder', d).value = r.path; };
  }
  $('#x', d).onclick = () => d.close();
  $('#go', d).onclick = async (e) => {
    let req;
    if (WEB) {
      const files = [...$('#i-files', d).files];
      if (!files.length) { toast('Choose some photos first'); return; }
      req = { kind: 'files', files, source: 'photos' };
    } else {
      const kind = d.querySelector('[name=kind]:checked').value;
      const source = kind === 'album' ? $('#i-album', d).value : $('#i-folder', d).value.trim();
      if (!source) { toast('Choose an album or folder'); return; }
      req = { kind, source };
    }
    e.target.disabled = true; $('#prog', d).hidden = false;
    const job = await api('/api/import', { ...req, cemetery: readCem(d), checkWikiTree: $('#i-wt', d).checked });
    await pollJob(job, d, () => { $('#x', d).textContent = 'Close'; $('#x', d).onclick = () => { d.close(); route(); }; });
    await refresh(); renderList();
  };
}

async function plotDialog() {
  if (!S.batches.length) { toast('Import some photos first'); return; }
  const d = openDialog(`<h2>Cemetery plot map</h2>
    <p class="muted" style="margin-top:0">Optional. Gives the table for a WikiTree Space page that the Cemetery Plot Map app reads, so everyone on these stones can be mapped.</p>
    <div class="row" style="margin-bottom:10px"><label for="pm-batch" style="margin:0">Album</label><select id="pm-batch" style="width:auto">${S.batches.map((b) => `<option value="${b.id}" ${b.id === view.batch ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></div>
    <div id="pm-body"></div>
    <div class="actions"><button id="x">Close</button></div>`);
  $('#x', d).onclick = () => d.close();
  const load = async () => {
    const body = $('#pm-body', d);
    const bid = $('#pm-batch', d).value;
    body.textContent = 'Checking WikiTree for the cemetery category…';
    let chk = null, chkErr = '';
    try { chk = await api(`/api/batches/${bid}/wikitree-check`, { force: load.force }); } catch (e) { chkErr = e.message; }
    load.force = false;
    await refresh();
    const r = await api(`/api/batches/${bid}/plotmap`);
    const catNote = chkErr ? `<span class="badge bad">${esc(chkErr)}</span>`
      : chk && chk.category ? `<span class="badge ok">Found on WikiTree${chk.source && chk.source !== 'entered by you' ? ` (${esc(chk.source)})` : ''}</span>${chk.source === 'entered by you' ? ' <span class="muted">entered by you</span>' : ''}`
      : `<span class="badge warn">Not found; this is a guess</span> <span class="muted">${esc((chk && chk.lookup && chk.lookup.notes || []).join(' '))}</span>`;
    const pg = chk && chk.page;
    const pageNote = !pg ? '' : !pg.exists
      ? `<span class="badge">Page doesn't exist on WikiTree yet</span> create it with the link below`
      : pg.missing.length ? `<span class="badge warn">Page exists but is missing ${esc(pg.missing.map((c) => c.replace(/_/g, ' ')).join(' and '))}</span>`
      : `<span class="badge ok">Page exists and has both categories</span>`;
    body.innerHTML = `
      ${r.warnings.length ? `<div class="card" style="background:var(--warn-bg);color:var(--warn)"><b>Before you publish</b><ul style="margin:6px 0 0 18px;padding:0">${r.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
      ${r.cemetery && r.cemetery.name ? `<p class="muted" style="margin:0 0 8px">Cemetery: <b>${esc([r.cemetery.name, r.cemetery.city, r.cemetery.county, r.cemetery.state].filter(Boolean).join(', '))}</b>${r.cemetery.gpsSource ? ` · found from the photos' GPS (${esc(r.cemetery.gpsSource.replace(/\s*\(.*\)/, ''))})` : ''}</p>` : '<p class="muted" style="margin:0 0 8px">No cemetery is set and none could be found from the photos\' GPS.</p>'}
      <h2>1. Space page</h2>
      <p style="margin:0 0 6px">${pageNote}</p>
      <p style="margin:0 0 6px">Create or edit <a target="_blank" rel="noopener" href="${esc(r.pageUrl)}"><b>Space:${esc(r.title.replace(/ /g, '_'))}</b> ↗</a> and paste the table below into it.</p>
      <h2 style="margin-top:12px">2. Table <span class="muted">(${r.rowCount} rows)</span></h2>
      <textarea id="pm-table" rows="9" readonly style="font:12px ui-monospace,Menlo,monospace;white-space:pre">${esc(r.markup)}</textarea>
      <div class="row" style="margin:6px 0 12px"><button class="primary small" id="pm-copy">Copy table</button><button class="small" id="pm-tsv">Download TSV for the map's Import data</button></div>
      <h2>3. Categories <span class="muted">(both are needed)</span></h2>
      <p style="margin:0 0 6px">${catNote} <button class="small" id="pm-recheck">Look up again</button></p>
      <textarea id="pm-cats" rows="2" readonly style="font:12px ui-monospace,Menlo,monospace">${esc(r.categoryLines.join('\n'))}</textarea>
      <div class="row" style="margin-top:6px"><button class="small" id="pm-copycats">Copy categories</button><span class="muted" style="font-size:12px">The cemetery's own category lets the map find the page; Plotting Pages lists the cemetery as map ready.</span></div>`;
    $('#pm-tsv', d).onclick = () => download(`/api/batches/${bid}/plotmap.tsv`);
    $('#pm-recheck', d).onclick = () => { load.force = true; load(); };
    $('#pm-copy', d).onclick = async () => { await navigator.clipboard.writeText(r.markup); toast('Table copied'); };
    $('#pm-copycats', d).onclick = async () => { await navigator.clipboard.writeText(r.categoryLines.join('\n')); toast('Categories copied'); };
  };
  $('#pm-batch', d).onchange = load;
  load();
}

async function checkAll() {
  const d = openDialog(`<h2>Checking WikiTree</h2><div class="progress"><div></div></div><div id="cur" class="muted"></div><div class="log"></div><div class="actions"><button id="x">Close</button></div>`);
  $('#x', d).onclick = () => { d.close(); route(); };
  const job = await api('/api/check-all', { onlyUnchecked: false });
  await pollJob(job, d, () => {});
}

route();
