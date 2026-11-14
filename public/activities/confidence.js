/* Confidence Bets client: projector + phone. See server/activities/confidence.js. */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var LET = ['A', 'B', 'C', 'D'];

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function sv(tag, attrs, text) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }
  function empty(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function stopTimer(local) { if (local.timer) { clearInterval(local.timer); local.timer = null; } }
  function startTimer(local, endsAt, node) {
    stopTimer(local);
    function upd() {
      var s = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      node.textContent = String(s);
      node.classList.toggle('cb-low', s <= 5);
    }
    upd();
    local.timer = setInterval(upd, 250);
  }

  var CSS = [
    '.cb-host{width:100%;height:100%;display:flex;flex-direction:column;gap:1.6rem;padding:3rem 5rem;color:var(--ink,#fbf1de);font-family:var(--body,system-ui)}',
    '.cb-head{display:flex;justify-content:space-between;align-items:center;font-size:2.2rem;color:var(--muted,#d8c6a6)}',
    '.cb-timer{font-size:5rem;font-weight:800;color:var(--accent,#ffc23d);min-width:6rem;text-align:right;font-variant-numeric:tabular-nums}',
    '.cb-timer.cb-low{color:#ff6a2b}',
    '.cb-q{font-size:3.6rem;line-height:1.2;font-weight:700}',
    '.cb-opts{display:grid;grid-template-columns:1fr 1fr;gap:1.2rem}',
    '.cb-opt{font-size:2.6rem;padding:1.2rem 1.6rem;border:.2rem solid var(--line,#6b5a45);border-radius:1.2rem;background:var(--panel,#1e151e);display:flex;gap:1.2rem;align-items:center}',
    '.cb-opt b{color:var(--accent,#ffc23d);font-size:2.6rem}',
    '.cb-opt.cb-ok{border-color:#86d98a;background:rgba(134,217,138,.22)}',
    '.cb-opt.cb-dim{opacity:.45}',
    '.cb-why{font-size:2.3rem;line-height:1.3;color:var(--muted,#d8c6a6)}',
    '.cb-stats{display:flex;gap:2.4rem;align-items:flex-end;font-size:2.2rem}',
    '.cb-bigpct{font-size:5.5rem;font-weight:800;color:var(--accent,#ffc23d);line-height:1}',
    '.cb-bars{display:flex;gap:1.4rem;align-items:flex-end;height:11rem}',
    '.cb-bcol{display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;width:6rem;font-size:1.6rem}',
    '.cb-bar{width:100%;background:var(--accent,#ffc23d);border-radius:.4rem .4rem 0 0;min-height:.3rem}',
    '.cb-note{font-size:2rem;color:var(--muted,#d8c6a6)}',
    '.cb-done{display:grid;grid-template-columns:1.5fr 1fr;gap:3rem;align-items:start}',
    '.cb-chart{width:100%;height:auto;max-height:46rem}',
    '.cb-take{font-size:3rem;font-weight:700;line-height:1.2;grid-column:1/3}',
    '.cb-list{font-size:2.4rem;margin:0;padding:0;list-style:none}',
    '.cb-list li{display:flex;justify-content:space-between;padding:.4rem 0;border-bottom:.1rem solid var(--line,#6b5a45)}',
    '.cb-h{font-size:2rem;letter-spacing:.1em;text-transform:uppercase;color:var(--accent,#ffc23d);margin:0 0 .6rem}',
    /* phone */
    '.cbp{display:flex;flex-direction:column;gap:12px;padding:12px 0;color:var(--ink,#fbf1de);max-width:100%}',
    '.cbp-top{display:flex;justify-content:space-between;align-items:center;font-size:14px;color:var(--ink-dim,#d8c6a6)}',
    '.cbp-timer{font-size:28px;font-weight:800;color:var(--signal,#ffb020);font-variant-numeric:tabular-nums}',
    '.cbp-timer.cb-low{color:#ff6a2b}',
    '.cbp-q{font-size:18px;line-height:1.3;font-weight:600;overflow-wrap:anywhere}',
    '.cbp-opt{min-height:56px;width:100%;text-align:left;font-size:16px;padding:10px 14px;border-radius:14px;border:2px solid var(--line,#5a4560);background:var(--surface,#2a1e2b);color:var(--ink,#fbf1de);display:flex;gap:10px;align-items:center;overflow-wrap:anywhere}',
    '.cbp-opt b{color:var(--signal,#ffb020);flex:none}',
    '.cbp-opt.cb-sel{border-color:var(--signal,#ffb020);background:rgba(255,176,32,.18)}',
    '.cbp-opt.cb-ok{border-color:#86d98a;background:rgba(134,217,138,.2)}',
    '.cbp-opt.cb-bad{border-color:#ff6a6a;background:rgba(255,80,80,.18)}',
    '.cbp-opt:disabled{opacity:.7}',
    '.cbp-lab{font-size:14px;color:var(--ink-dim,#d8c6a6)}',
    '.cbp-stakes{display:grid;grid-template-columns:repeat(5,1fr);gap:6px}',
    '.cbp-stake{min-height:52px;font-size:20px;font-weight:800;border-radius:12px;border:2px solid var(--line,#5a4560);background:var(--surface,#2a1e2b);color:var(--ink,#fbf1de)}',
    '.cbp-stake.cb-sel{border-color:var(--signal,#ffb020);background:var(--signal,#ffb020);color:var(--signal-ink,#1b1200)}',
    '.cbp-lock{min-height:56px;font-size:18px;font-weight:800;border-radius:14px;border:0;background:var(--signal,#ffb020);color:var(--signal-ink,#1b1200)}',
    '.cbp-lock:disabled{opacity:.45}',
    '.cbp-big{font-size:40px;font-weight:800;text-align:center;margin:6px 0}',
    '.cbp-mid{font-size:16px;text-align:center;color:var(--ink-dim,#d8c6a6);overflow-wrap:anywhere}',
    '.cbp-row{display:flex;align-items:center;gap:8px;font-size:14px}',
    '.cbp-row span.cbp-k{flex:none;width:56px}',
    '.cbp-track{flex:1;height:14px;background:rgba(255,255,255,.1);border-radius:7px;overflow:hidden}',
    '.cbp-fill{height:100%;background:var(--signal,#ffb020)}'
  ].join('');

  /* ---------- host ---------- */
  function hostAsk(root, v, ctx) {
    var L = ctx.local;
    var key = 'ask' + v.n;
    if (L.hkey !== key) {
      L.hkey = key;
      empty(root);
      var w = el('div', 'cb-host');
      var head = el('div', 'cb-head');
      L.hnum = el('span', 'disp');
      L.hlocked = el('span');
      L.htimer = el('div', 'cb-timer');
      head.appendChild(L.hnum); head.appendChild(L.hlocked); head.appendChild(L.htimer);
      w.appendChild(head);
      w.appendChild(el('div', 'cb-q', v.q));
      var g = el('div', 'cb-opts');
      v.options.forEach(function (o, i) {
        var d = el('div', 'cb-opt'); d.appendChild(el('b', null, LET[i])); d.appendChild(el('span', null, o)); g.appendChild(d);
      });
      w.appendChild(g);
      w.appendChild(el('div', 'cb-note', 'Pick an answer, then stake 1-5 on how sure you are. Overconfidence costs the most.'));
      root.appendChild(w);
      startTimer(L, ctx.endsAt(v), L.htimer);
    }
    L.hnum.textContent = 'Confidence Bets  ' + v.n + ' / ' + v.total;
    L.hlocked.textContent = v.locked + ' of ' + v.connected + ' locked in';
  }

  function hostReveal(root, v, ctx) {
    var L = ctx.local;
    stopTimer(L);
    var key = 'rev' + v.n;
    if (L.hkey === key) return;
    L.hkey = key;
    empty(root);
    var w = el('div', 'cb-host');
    var head = el('div', 'cb-head');
    head.appendChild(el('span', 'disp', 'Answer  ' + v.n + ' / ' + v.total));
    head.appendChild(el('span', null, 'Next question coming up'));
    w.appendChild(head);
    w.appendChild(el('div', 'cb-q', v.q));
    var g = el('div', 'cb-opts');
    v.options.forEach(function (o, i) {
      var d = el('div', 'cb-opt' + (i === v.correct ? ' cb-ok' : ' cb-dim'));
      d.appendChild(el('b', null, LET[i])); d.appendChild(el('span', null, o)); g.appendChild(d);
    });
    w.appendChild(g);
    if (v.why) w.appendChild(el('div', 'cb-why', v.why));
    var st = el('div', 'cb-stats');
    var left = el('div');
    left.appendChild(el('div', 'cb-bigpct', v.pct == null ? '-' : v.pct + '%'));
    left.appendChild(el('div', null, 'of the room was right' + (v.unanswered ? '  (' + v.unanswered + ' did not answer)' : '')));
    st.appendChild(left);
    var bars = el('div', 'cb-bars');
    (v.byStake || []).forEach(function (b, i) {
      var c = el('div', 'cb-bcol');
      var pct = b.n ? Math.round(100 * b.right / b.n) : 0;
      c.appendChild(el('div', null, b.n ? pct + '%' : ''));
      var bar = el('div', 'cb-bar'); bar.style.height = (b.n ? Math.max(2, pct) : 0) + '%'; c.appendChild(bar);
      c.appendChild(el('div', null, 'S' + (i + 1) + ' (' + b.n + ')'));
      bars.appendChild(c);
    });
    st.appendChild(bars);
    w.appendChild(st);
    root.appendChild(w);
  }

  function curveSvg(curve) {
    var W = 900, H = 560, ml = 110, mr = 50, mt = 40, mb = 110;
    var pw = W - ml - mr, ph = H - mt - mb;
    var svg = sv('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'cb-chart', role: 'img', 'aria-label': 'Room calibration curve' });
    function X(s) { return ml + (s - 1) / 4 * pw; }
    function Y(p) { return mt + ph - p / 100 * ph; }
    var i, t;
    for (i = 0; i <= 5; i++) {
      var p = i * 20;
      svg.appendChild(sv('line', { x1: ml, x2: W - mr, y1: Y(p), y2: Y(p), stroke: '#6b5a45', 'stroke-width': 1.5 }));
      svg.appendChild(sv('text', { x: ml - 14, y: Y(p) + 10, 'text-anchor': 'end', fill: '#d8c6a6', 'font-size': 30 }, p + '%'));
    }
    for (i = 1; i <= 5; i++) {
      svg.appendChild(sv('text', { x: X(i), y: H - mb + 44, 'text-anchor': 'middle', fill: '#fbf1de', 'font-size': 34, 'font-weight': 700 }, String(i)));
    }
    svg.appendChild(sv('text', { x: ml + pw / 2, y: H - 12, 'text-anchor': 'middle', fill: '#d8c6a6', 'font-size': 28 }, 'Stake (1 = guessing, 5 = certain)'));
    svg.appendChild(sv('text', { x: 28, y: mt + ph / 2, 'text-anchor': 'middle', fill: '#d8c6a6', 'font-size': 28, transform: 'rotate(-90 28 ' + (mt + ph / 2) + ')' }, '% correct'));
    svg.appendChild(sv('line', { x1: X(1), y1: Y(20), x2: X(5), y2: Y(100), stroke: '#86d98a', 'stroke-width': 5, 'stroke-dasharray': '16 10' }));
    svg.appendChild(sv('text', { x: X(5) - 8, y: Y(100) + 44, 'text-anchor': 'end', fill: '#86d98a', 'font-size': 26 }, 'ideal'));
    var pts = curve.filter(function (c) { return c.n > 0; });
    if (pts.length > 1) {
      svg.appendChild(sv('polyline', { points: pts.map(function (c) { return X(c.stake) + ',' + Y(c.pct); }).join(' '), fill: 'none', stroke: '#ffc23d', 'stroke-width': 7, 'stroke-linejoin': 'round' }));
    }
    pts.forEach(function (c) {
      svg.appendChild(sv('circle', { cx: X(c.stake), cy: Y(c.pct), r: 15, fill: '#ffc23d', stroke: '#150f18', 'stroke-width': 4 }));
      var above = c.pct < 85;
      svg.appendChild(sv('text', { x: X(c.stake), y: Y(c.pct) + (above ? -28 : 46), 'text-anchor': 'middle', fill: '#fbf1de', 'font-size': 30, 'font-weight': 700 }, c.pct + '%  (n=' + c.n + ')'));
    });
    return svg;
  }

  function hostDone(root, v, ctx) {
    var L = ctx.local;
    stopTimer(L);
    if (L.hkey === 'done') return;
    L.hkey = 'done';
    empty(root);
    var w = el('div', 'cb-host');
    w.appendChild(el('div', 'cb-head disp', 'Confidence Bets: how calibrated was the room?'));
    var g = el('div', 'cb-done');
    var left = el('div');
    left.appendChild(curveSvg(v.curve || []));
    g.appendChild(left);
    var right = el('div');
    right.appendChild(el('h3', 'cb-h', 'Top 5 by points'));
    var ol = el('ul', 'cb-list');
    (v.top || []).forEach(function (p, i) {
      var li = el('li'); li.appendChild(el('span', null, (i + 1) + '. ' + p.name)); li.appendChild(el('span', 'num', String(p.score))); ol.appendChild(li);
    });
    right.appendChild(ol);
    right.appendChild(el('h3', 'cb-h', 'Best calibrated'));
    right.appendChild(el('div', 'cb-list', v.best ? v.best.name + '  (Brier ' + v.best.brier.toFixed(2) + ', lower is better)' : 'Needs 6+ answered questions'));
    g.appendChild(right);
    g.appendChild(el('div', 'cb-take', v.takeaway || ''));
    w.appendChild(g);
    root.appendChild(w);
  }

  /* ---------- phone ---------- */
  function phoneAsk(root, v, ctx) {
    var L = ctx.local;
    var key = 'ask' + v.n;
    if (L.pkey !== key) {
      L.pkey = key;
      L.pick = v.pick != null ? v.pick : null;
      L.stake = v.stake != null ? v.stake : null;
      empty(root);
      var w = el('div', 'cbp');
      var top = el('div', 'cbp-top');
      top.appendChild(el('span', null, 'Question ' + v.n + ' of ' + v.total));
      L.ptimer = el('span', 'cbp-timer');
      top.appendChild(L.ptimer);
      w.appendChild(top);
      w.appendChild(el('div', 'cbp-q', v.q));
      L.pbtns = v.options.map(function (o, i) {
        var b = el('button', 'cbp-opt'); b.type = 'button';
        b.appendChild(el('b', null, LET[i])); b.appendChild(el('span', null, o));
        b.addEventListener('click', function () { if (L.locked) return; L.pick = i; paint(); });
        w.appendChild(b);
        return b;
      });
      w.appendChild(el('div', 'cbp-lab', 'How sure are you? 1 = guessing, 5 = certain'));
      var sg = el('div', 'cbp-stakes');
      L.sbtns = [1, 2, 3, 4, 5].map(function (s) {
        var b = el('button', 'cbp-stake', String(s)); b.type = 'button';
        b.addEventListener('click', function () { if (L.locked) return; L.stake = s; paint(); });
        sg.appendChild(b);
        return b;
      });
      w.appendChild(sg);
      L.plock = el('button', 'cbp-lock', 'Lock in'); L.plock.type = 'button';
      L.plock.addEventListener('click', function () {
        if (L.locked || L.pick == null || L.stake == null) return;
        L.locked = true; paint();
        ctx.send({ a: 'lock', pick: L.pick, stake: L.stake });
      });
      w.appendChild(L.plock);
      L.pmsg = el('div', 'cbp-mid', '');
      w.appendChild(L.pmsg);
      root.appendChild(w);
      L.locked = false;
      startTimer(L, ctx.endsAt(v), L.ptimer);
      L.ptimer.className = 'cbp-timer';
    }
    if (v.locked) { L.locked = true; L.pick = v.pick; L.stake = v.stake; }
    paint();
    function paint() {
      L.pbtns.forEach(function (b, i) { b.classList.toggle('cb-sel', L.pick === i); b.disabled = !!L.locked; });
      L.sbtns.forEach(function (b, i) { b.classList.toggle('cb-sel', L.stake === i + 1); b.disabled = !!L.locked; });
      L.plock.disabled = !!L.locked || L.pick == null || L.stake == null;
      L.plock.textContent = L.locked ? 'Locked in' : 'Lock in';
      L.pmsg.textContent = L.locked ? 'Locked. Waiting for the others...' : (L.pick == null ? 'Pick an answer' : L.stake == null ? 'Now choose how sure you are' : '');
    }
  }

  function phoneReveal(root, v, ctx) {
    var L = ctx.local;
    stopTimer(L);
    var key = 'rev' + v.n;
    if (L.pkey === key) return;
    L.pkey = key;
    empty(root);
    var w = el('div', 'cbp');
    var head = v.result === 'right' ? 'Right!' : v.result === 'wrong' ? 'Wrong' : 'No answer';
    w.appendChild(el('div', 'cbp-big', head));
    w.appendChild(el('div', 'cbp-big', (v.pts > 0 ? '+' : '') + v.pts + ' pts'));
    if (v.stake) w.appendChild(el('div', 'cbp-mid', 'You staked ' + v.stake));
    v.options.forEach(function (o, i) {
      var cls = 'cbp-opt' + (i === v.correct ? ' cb-ok' : (i === v.pick ? ' cb-bad' : ''));
      var b = el('div', cls); b.appendChild(el('b', null, LET[i])); b.appendChild(el('span', null, o)); w.appendChild(b);
    });
    w.appendChild(el('div', 'cbp-mid', 'Total score: ' + v.score));
    root.appendChild(w);
  }

  function phoneDone(root, v, ctx) {
    var L = ctx.local;
    stopTimer(L);
    if (L.pkey === 'done') return;
    L.pkey = 'done';
    empty(root);
    var w = el('div', 'cbp');
    w.appendChild(el('div', 'cbp-big', '#' + v.rank + ' of ' + v.players));
    w.appendChild(el('div', 'cbp-mid', 'Score: ' + v.score));
    w.appendChild(el('div', 'cbp-lab', 'Your accuracy at each stake'));
    (v.byStake || []).forEach(function (b) {
      var r = el('div', 'cbp-row');
      r.appendChild(el('span', 'cbp-k', 'Stake ' + b.stake));
      var tr = el('div', 'cbp-track'), f = el('div', 'cbp-fill'); f.style.width = (b.pct || 0) + '%'; tr.appendChild(f);
      r.appendChild(tr);
      r.appendChild(el('span', null, b.n ? b.pct + '% (' + b.n + ')' : '-'));
      w.appendChild(r);
    });
    w.appendChild(el('div', 'cbp-mid', v.coaching || ''));
    root.appendChild(w);
  }

  function resetOnStage(ctx, stage) {
    // a stage change resets the remembered key so the new stage always draws
    if (ctx.firstRender) { ctx.local.hkey = null; ctx.local.pkey = null; stopTimer(ctx.local); }
  }

  ZebraAct.register('confidence', {
    css: CSS,
    renderHost: function (root, v, ctx) {
      resetOnStage(ctx);
      if (v.stage === 'ask') hostAsk(root, v, ctx);
      else if (v.stage === 'reveal') hostReveal(root, v, ctx);
      else hostDone(root, v, ctx);
    },
    renderPhone: function (root, v, ctx) {
      resetOnStage(ctx);
      if (v.stage === 'ask') phoneAsk(root, v, ctx);
      else if (v.stage === 'reveal') phoneReveal(root, v, ctx);
      else phoneDone(root, v, ctx);
    },
    onAck: function (d, ctx) {
      if (d && d.ok === false && ctx && ctx.local) { ctx.local.locked = false; ctx.local.pkey = null; }
    }
  });
})();
