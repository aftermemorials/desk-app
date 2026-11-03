// Read-only desk app (plan B). Data = AES-GCM ciphertext on textdb.dev; path+key live only in the URL fragment (#t=path.key).
const POLL = 15000; let D = null, ERR = null, tab = 'home';
const $ = s => document.querySelector(s);
function frag() { const m = location.hash.match(/t=([\w-]+)\.([\w-]+)/); if (m) { localStorage.t = m[1] + '.' + m[2]; } const t = (m ? m[1] + '.' + m[2] : localStorage.t) || ''; const [p, k] = t.split('.'); return p && k ? { p, k } : null; }
const ub = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));
async function decrypt(blob, k) {
  const [v, iv, ct] = blob.trim().split('.'); if (v !== 'v1') throw new Error('bad format');
  const key = await crypto.subtle.importKey('raw', ub(k), 'AES-GCM', false, ['decrypt']);
  const gz = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ub(iv) }, key, ub(ct));
  const txt = await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  return JSON.parse(txt);
}
async function load() {
  const f = frag();
  if (!f) { ERR = 'No access token. Open the link Gerry got on Telegram (it ends in #t=…).'; return render(); }
  try {
    const r = await fetch('https://textdb.dev/api/data/' + f.p + '?_=' + Date.now(), { cache: 'no-store', referrerPolicy: 'no-referrer' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const b = await r.text(); if (!b.startsWith('v1.')) throw new Error('no data published yet');
    D = await decrypt(b, f.k); ERR = null;
  } catch (e) { ERR = 'Could not load desk data: ' + e.message; }
  render();
}
const usd = v => (v < 0 ? '-$' : '$') + Math.abs(+v || 0).toFixed(2);
const ago = t => { if (!t) return 'never'; const s = Date.now() / 1000 - t; return s < 60 ? Math.round(s) + 's ago' : s < 3600 ? Math.round(s / 60) + 'm ago' : Math.round(s / 3600) + 'h ago'; };
const tm = t => new Date(t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function chart(id, pts, color) {
  const c = document.getElementById(id); if (!c || pts.length < 2) return;
  const dpr = devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight; c.width = w * dpr; c.height = h * dpr;
  const x = c.getContext('2d'); x.scale(dpr, dpr);
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]); const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const X = v => (v - x0) / ((x1 - x0) || 1) * (w - 4) + 2, Y = v => h - 6 - (v - y0) / ((y1 - y0) || 1) * (h - 12);
  const gr = x.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, color + '55'); gr.addColorStop(1, color + '00');
  x.beginPath(); pts.forEach((p, i) => i ? x.lineTo(X(p[0]), Y(p[1])) : x.moveTo(X(p[0]), Y(p[1])));
  x.strokeStyle = color; x.lineWidth = 2; x.stroke(); x.lineTo(X(x1), h); x.lineTo(X(x0), h); x.fillStyle = gr; x.fill();
}
const V = {
  home() {
    const pnl = D.stack - D.start, open = D.positions.filter(p => p.status === 'open');
    let h = `<div class="card"><h3>Paper stack</h3><div class="big">${usd(D.stack)}</div><div class="sub"><span class="${pnl >= 0 ? 'g' : 'r'}">${pnl >= 0 ? '+' : ''}${usd(pnl)}</span> since start · free ${usd(D.free)}</div><canvas id="bal"></canvas></div>`;
    h += `<div class="card"><h3>Open positions</h3>` + (open.length ? open.map(p => { const last = p.series.length ? p.series[p.series.length - 1][1] : p.entry, ch = 100 * (last / p.entry - 1);
      return `<div class="row"><div>${esc(p.name)}<small>${usd(p.size)} @ ${(+p.entry).toPrecision(4)} · stop -${p.stop_pct}%${p.trail_on ? ' · trail on' : ''}</small></div><div class="${ch >= 0 ? 'g' : 'r'}">${ch.toFixed(1)}%</div></div><canvas id="p${p.id}" style="height:80px"></canvas><a class="btn" href="${esc(p.url)}" target="_blank" rel="noopener">Sell on FOMO</a>`; }).join('')
      : `<div class="state" style="padding:24px">No open positions. The desk is watching migrations.</div>`) + `</div>`;
    const c = D.closed || {}; h += `<div class="card"><h3>Closed (paper)</h3><div class="row"><div>Trades</div><div>${c.n || 0}</div></div><div class="row"><div>Wins</div><div>${c.w || 0}</div></div><div class="row"><div>Net P&amp;L after fees</div><div class="${(c.pnl || 0) >= 0 ? 'g' : 'r'}">${usd(c.pnl)}</div></div><div class="row"><div>Fees</div><div>${usd(c.f)}</div></div></div>`;
    setTimeout(() => { chart('bal', D.balance.length > 1 ? D.balance : [[D.ts - 3600, D.start], [D.ts, D.stack]], '#00d35a'); open.forEach(p => chart('p' + p.id, p.series, '#64d2ff')); });
    return h;
  },
  agents() {
    const A = D.agents, col = { scanner: 'cy', auditor: 'y', analyst: 'pk', executor: 'g', risk: 'o' };
    const kpi = { scanner: a => [a.waiting ?? 0, 'in waiting room'], auditor: a => [a.last?.length ? (a.last[0].passed ? '8/8' : 'L' + a.last[0].red_layer + ' red') : '—', 'last audit'],
      analyst: a => [a.last?.[0]?.score ?? '—', 'last score · ' + a.mode], executor: () => [usd(D.free), 'free'], risk: () => [D.positions.filter(p => p.status === 'open').length, 'open'] };
    let h = '<div class="grid">' + Object.keys(col).map(k => { const a = A[k] || {}; const stale = a.beat && Date.now() / 1000 - a.beat > 120; const [v, l] = kpi[k](a);
      return `<div class="agent"><div><div class="n"><span class="dot ${!a.on ? 'off' : stale || !a.beat ? 'stale' : ''}"></span>${k[0].toUpperCase() + k.slice(1)}</div><div class="s">${a.on ? 'on' : 'paused'} · ${ago(a.beat)}</div></div><div><div class="k ${col[k]}">${esc(v)}</div><div class="s">${esc(l)}</div></div><div class="s">${a.skips} skips / 24h</div></div>`; }).join('') + '</div>';
    const au = A.auditor?.last || []; h += `<div class="card" style="margin-top:12px"><h3>Recent audits</h3>` + (au.length ? au.map(a => `<div class="row"><div>${esc(a.mint.slice(0, 4) + '…' + a.mint.slice(-4))}<small>${a.layers.map(l => esc(l.name + ': ' + (l.value || l.status))).slice(0, a.red_layer || 8).join(' · ')}</small></div><div class="layers">${a.layers.map(l => `<span class="${l.status}"></span>`).join('')}</div></div>`).join('') : '<div class="state" style="padding:20px">No audits yet.</div>') + '</div>';
    return h;
  },
  activity() {
    if (!D.activity.length) return '<div class="state">No activity yet.</div>';
    return '<div class="card">' + D.activity.map(a => `<div class="row"><div>${esc(a.text)}<small>${esc(a.agent)} · ${tm(a.ts)}${a.url ? ` · <a href="${esc(a.url)}" target="_blank" rel="noopener">FOMO</a>` : ''}</small></div><div class="${a.kind === 'skip' ? 'r' : a.kind === 'pass' || a.kind === 'fill' ? 'g' : ''}" style="font-size:12px">${esc(a.kind)}</div></div>`).join('') + '</div>';
  },
  account() {
    const S = D.settings; const keys = ['desk.mode', 'analyst.mode', 'executor.stack_pct', 'executor.min_ticket_usd', 'risk.stop_pct', 'risk.trail_pct', 'risk.timeout_h', 'scanner.min_liquidity_usd'];
    return `<div class="card"><h3>FOMO</h3><div class="row"><div>@${esc(D.links.handle)}</div><div class="o">${esc(D.mode)}</div></div><a class="btn" href="${esc(D.links.profile)}" target="_blank" rel="noopener">My FOMO profile</a><a class="btn sec" href="${esc(D.links.signup)}" target="_blank" rel="noopener">Invite link</a></div>
    <div class="card"><h3>Settings (change on Telegram: set &lt;setting&gt; to &lt;v&gt;)</h3>${keys.map(k => `<div class="row"><div>${k}</div><div>${esc(S[k])}</div></div>`).join('')}</div>
    <div class="card"><h3>Change log</h3>${D.changes.length ? D.changes.map(c => `<div class="row"><div>${esc(c.key)}<small>${tm(c.ts)} · ${esc(c.source)}</small></div><div>${esc(c.old)} → ${esc(c.new)}</div></div>`).join('') : '<div class="state" style="padding:20px">No changes yet.</div>'}</div>
    <div class="sub" style="text-align:center">Read-only. Research &amp; alerts only — no wallet, no orders.</div>`;
  }
};
function render() {
  $('#title').textContent = tab[0].toUpperCase() + tab.slice(1);
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.t === tab));
  if (D) { $('#mode').textContent = D.mode; $('#mode').className = 'pill' + (D.mode === 'LIVE' ? ' live' : ''); }
  if (!D) { $('#view').innerHTML = `<div class="state ${ERR ? 'err' : ''}">${esc(ERR || 'Loading…')}</div>`; return; }
  $('#view').innerHTML = (ERR ? `<div class="state err" style="padding:10px">${esc(ERR)} (showing last data)</div>` : '') + V[tab]() + `<div class="stamp">data ${ago(D.ts)} · refreshes every 15s</div>`;
}
document.querySelectorAll('nav button').forEach(b => b.onclick = () => { tab = b.dataset.t; render(); });
if (location.hash) history.replaceState(null, '', location.pathname + location.search + location.hash);
load(); setInterval(load, POLL);
