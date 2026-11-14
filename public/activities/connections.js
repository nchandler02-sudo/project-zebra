/* Connections: Differentials. Host (projector) and phone UI. See server/activities/connections.js. */
(function () {
  'use strict';
  var LEVEL_NAME = { 1: 'Yellow', 2: 'Green', 3: 'Blue', 4: 'Purple' };

  var CSS = [
    ':root{--cn1:#f2d45c;--cn2:#86d98a;--cn3:#7cc4ee;--cn4:#b9a2ee;--cn-ink:#1b1300}',
    '.cn-l1{--lc:var(--cn1)}.cn-l2{--lc:var(--cn2)}.cn-l3{--lc:var(--cn3)}.cn-l4{--lc:var(--cn4)}',
    /* phone */
    '.cnp{display:flex;flex-direction:column;gap:10px;color:var(--ink);padding-bottom:84px}',
    '.cnp-top{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:14px;color:var(--ink-dim)}',
    '.cnp-top b{color:var(--ink);font-variant-numeric:tabular-nums}',
    '.cnp-msg{min-height:24px;text-align:center;font-size:16px;font-weight:700}',
    '.cnp-msg.good{color:var(--ok,#5fd3a5)}.cnp-msg.bad{color:var(--danger,#ff8a8a)}.cnp-msg.near{color:var(--signal,#ffb020)}',
    '.cnp-banner{background:var(--lc);color:var(--cn-ink);border-radius:12px;padding:10px 12px;min-height:48px;display:flex;flex-direction:column;justify-content:center;gap:2px;text-align:center;overflow-wrap:anywhere}',
    '.cnp-banner strong{font-size:14px;text-transform:uppercase;letter-spacing:.04em}.cnp-banner span{font-size:14px}',
    '.cnp-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}',
    '@media(min-width:460px){.cnp-grid{grid-template-columns:repeat(4,minmax(0,1fr))}}',
    '.cnp-tile{min-height:60px;padding:8px 6px;border-radius:12px;border:2px solid var(--line);background:var(--surface);color:var(--ink);font:inherit;font-size:15px;font-weight:600;line-height:1.2;text-align:center;overflow-wrap:anywhere;hyphens:auto;cursor:pointer;touch-action:manipulation;display:flex;align-items:center;justify-content:center}',
    '.cnp-tile.sel{background:var(--signal,#ffb020);color:var(--signal-ink,#1b1200);border-color:var(--signal,#ffb020)}',
    '.cnp-tile:disabled{opacity:.6}',
    '.cnp-shake{animation:cnshake .35s}@keyframes cnshake{20%{transform:translateX(-6px)}40%{transform:translateX(6px)}60%{transform:translateX(-4px)}80%{transform:translateX(4px)}}',
    '.cnp-lives{display:flex;gap:6px;align-items:center;justify-content:center;font-size:13px;color:var(--ink-dim)}',
    '.cnp-dot{width:12px;height:12px;border-radius:50%;background:var(--signal,#ffb020)}.cnp-dot.off{background:var(--line)}',
    '.cnp-bar{position:fixed;left:0;right:0;bottom:0;display:flex;gap:10px;padding:10px 16px calc(10px + env(safe-area-inset-bottom));background:var(--ground-2,#1d1422);border-top:1px solid var(--line);z-index:5}',
    '.cnp-btn{flex:1;min-height:52px;border-radius:14px;border:2px solid var(--line);background:var(--surface);color:var(--ink);font:inherit;font-size:16px;font-weight:700;cursor:pointer;touch-action:manipulation}',
    '.cnp-btn.go{background:var(--signal,#ffb020);border-color:var(--signal,#ffb020);color:var(--signal-ink,#1b1200)}',
    '.cnp-btn:disabled{opacity:.45}',
    '.cnp-card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:12px;text-align:center}',
    '.cnp-big{font-size:26px;font-weight:800;color:var(--signal,#ffb020)}',
    '.cnp-note{font-size:14px;color:var(--ink-dim);text-align:center}',
    '.cnp-row{display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid var(--line);font-size:16px}',
    /* host */
    '.cnh{display:flex;flex-direction:column;gap:2.2rem;padding:3rem 5rem;color:var(--text);height:100%;box-sizing:border-box}',
    '.cnh-head{display:flex;justify-content:space-between;align-items:baseline;gap:2rem}',
    '.cnh-title{font-size:4.4rem;margin:0}',
    '.cnh-time{font-size:7rem;font-weight:800;font-variant-numeric:tabular-nums;color:var(--accent);line-height:1}',
    '.cnh-sub{font-size:2.6rem;color:var(--muted)}',
    '.cnh-rows{display:flex;flex-direction:column;gap:1.8rem}',
    '.cnh-row{display:grid;grid-template-columns:14rem 1fr 14rem;gap:2rem;align-items:center;font-size:3rem}',
    '.cnh-track{height:4.4rem;border-radius:2.2rem;background:var(--panel-2);overflow:hidden}',
    '.cnh-fill{height:100%;width:0;background:var(--lc);transition:width .6s ease}',
    '.cnh-count{text-align:right;font-variant-numeric:tabular-nums;font-weight:700}',
    '.cnh-grp{background:var(--lc);color:var(--cn-ink);border-radius:1.6rem;padding:1.6rem 2.4rem;display:flex;flex-direction:column;gap:.6rem}',
    '.cnh-grp h3{margin:0;font-size:2.8rem;text-transform:uppercase;letter-spacing:.05em}',
    '.cnh-items{font-size:3.2rem;font-weight:700}',
    '.cnh-exp{font-size:2.3rem}',
    '.cnh-stats{display:flex;gap:3rem;font-size:2.6rem;color:var(--muted);flex-wrap:wrap}',
    '.cnh-stats b{color:var(--text)}',
    '.cnh-btn{align-self:flex-start;font:inherit;font-size:2.4rem;font-weight:700;padding:1rem 2.6rem;border-radius:1.2rem;border:2px solid var(--line);background:var(--panel-2);color:var(--text);cursor:pointer}',
    '.cnh-top5{display:flex;flex-direction:column;gap:1rem;font-size:3.6rem}',
    '.cnh-top5 div{display:flex;justify-content:space-between;background:var(--panel);border:1px solid var(--line);border-radius:1.2rem;padding:1rem 2.4rem}'
  ].join('\n');

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function clearNode(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function secs(ms) { return Math.max(0, Math.ceil(ms / 1000)); }
  function fmt(s) { var m = Math.floor(s / 60); var r = s % 60; return m + ':' + (r < 10 ? '0' : '') + r; }

  /** Remember the deadline of this view and run one interval that writes the countdown into node. */
  function startTimer(ctx, view, node, prefix) {
    var L = ctx.local;
    if (L.timer) { clearInterval(L.timer); L.timer = null; }
    L.endsAt = ctx.endsAt(view);
    function tick() { if (!node.isConnected && L.timer) { clearInterval(L.timer); L.timer = null; return; } node.textContent = (prefix || '') + fmt(secs(L.endsAt - Date.now())); }
    tick();
    L.timer = setInterval(tick, 250);
  }
  function syncDeadline(ctx, view) { ctx.local.endsAt = ctx.endsAt(view); }
  function stopTimer(ctx) { if (ctx.local.timer) { clearInterval(ctx.local.timer); ctx.local.timer = null; } }

  /* ---------------- host ---------------- */
  function renderHost(root, view, ctx) {
    var L = ctx.local;
    var key = view.stage + ':' + view.pi;
    if (L.hostKey !== key || ctx.firstRender) {
      stopTimer(ctx);
      L.hostKey = key;
      L.h = null;
      clearNode(root);
      buildHost(root, view, ctx);
    }
    if (L.h && L.h.update) L.h.update(view);
    if (view.endsInMs != null) syncDeadline(ctx, view);
  }

  function buildHost(root, view, ctx) {
    var L = ctx.local;
    var wrap = el('div', 'cnh');
    root.appendChild(wrap);
    var head = el('div', 'cnh-head');
    wrap.appendChild(head);

    if (view.stage === 'play') {
      head.appendChild(el('h2', 'disp cnh-title', 'Connections ' + (view.pi + 1) + ' of ' + view.total));
      var time = el('div', 'cnh-time');
      head.appendChild(time);
      startTimer(ctx, view, time);
      wrap.appendChild(el('div', 'cnh-sub', 'Sort 16 clinical items into 4 groups on your phone. Beware the decoys.'));
      var rowsBox = el('div', 'cnh-rows');
      wrap.appendChild(rowsBox);
      var rows = [];
      (view.rows || []).forEach(function (r) {
        var row = el('div', 'cnh-row cn-l' + r.level);
        row.appendChild(el('div', '', LEVEL_NAME[r.level]));
        var track = el('div', 'cnh-track');
        var fill = el('div', 'cnh-fill');
        track.appendChild(fill);
        row.appendChild(track);
        var cnt = el('div', 'cnh-count', '0');
        row.appendChild(cnt);
        rowsBox.appendChild(row);
        rows.push({ fill: fill, cnt: cnt });
      });
      var stats = el('div', 'cnh-sub');
      wrap.appendChild(stats);
      var btn = el('button', 'cnh-btn', 'Reveal now');
      btn.type = 'button';
      btn.addEventListener('click', function () { ctx.sendHost('next'); });
      wrap.appendChild(btn);
      L.h = {
        update: function (v) {
          var n = Math.max(1, v.players || 1);
          (v.rows || []).forEach(function (r, i) {
            if (!rows[i]) return;
            rows[i].fill.style.width = Math.min(100, Math.round((r.solved / n) * 100)) + '%';
            rows[i].cnt.textContent = r.solved + ' / ' + (v.players || 0);
          });
          stats.textContent = (v.finished || 0) + ' of ' + (v.players || 0) + ' players finished';
        },
      };
    } else if (view.stage === 'reveal') {
      head.appendChild(el('h2', 'disp cnh-title', view.title || 'The answers'));
      var t2 = el('div', 'cnh-time');
      t2.style.fontSize = '4.5rem';
      head.appendChild(t2);
      startTimer(ctx, view, t2, 'Next in ');
      (view.rows || []).forEach(function (r) {
        var g = el('div', 'cnh-grp cn-l' + r.level);
        g.appendChild(el('h3', '', r.category + '  (' + r.solved + ' solved)'));
        g.appendChild(el('div', 'cnh-items', r.items.join('  /  ')));
        g.appendChild(el('div', 'cnh-exp', r.explain));
        wrap.appendChild(g);
      });
      var st = el('div', 'cnh-stats');
      wrap.appendChild(st);
      var b2 = el('button', 'cnh-btn', view.last ? 'Final results' : 'Next puzzle');
      b2.type = 'button';
      b2.addEventListener('click', function () { ctx.sendHost('next'); });
      wrap.appendChild(b2);
      L.h = {
        update: function (v) {
          clearNode(st);
          var a = el('div');
          a.appendChild(document.createTextNode('Room solve rate '));
          a.appendChild(el('b', '', (v.solveRate || 0) + '%'));
          st.appendChild(a);
          if (v.decoy) {
            var d = el('div');
            d.appendChild(document.createTextNode('Most mis-picked tile '));
            d.appendChild(el('b', '', v.decoy.text));
            d.appendChild(document.createTextNode(' (' + v.decoy.count + ' wrong guesses). It belongs with: ' + v.decoy.category));
            st.appendChild(d);
          } else {
            st.appendChild(el('div', '', 'No wrong guesses this round.'));
          }
        },
      };
    } else {
      head.appendChild(el('h2', 'disp cnh-title', 'Connections: final standings'));
      var box = el('div', 'cnh-top5');
      wrap.appendChild(box);
      L.h = {
        update: function (v) {
          clearNode(box);
          (v.top || []).forEach(function (r, i) {
            var row = el('div');
            row.appendChild(el('span', '', (i + 1) + '. ' + r.name));
            row.appendChild(el('b', '', r.pts + ' pts'));
            box.appendChild(row);
          });
          if (!(v.top || []).length) box.appendChild(el('div', '', 'No scores yet.'));
        },
      };
      wrap.appendChild(el('div', 'cnh-sub', 'Press End to close the activity.'));
    }
  }

  /* ---------------- phone ---------------- */
  function renderPhone(root, view, ctx) {
    var L = ctx.local;
    var key = view.stage + ':' + view.pi;
    if (L.phoneKey !== key || ctx.firstRender) {
      stopTimer(ctx);
      L.phoneKey = key;
      L.sel = [];
      L.pending = false;
      L.msg = null;
      L.p = null;
      clearNode(root);
      if (view.stage === 'play') buildPlay(root, view, ctx);
      else if (view.stage === 'reveal') buildReveal(root, view, ctx);
      else buildDone(root, view, ctx);
    }
    if (L.p && L.p.update) L.p.update(view);
    if (view.endsInMs != null) syncDeadline(ctx, view);
  }

  function buildPlay(root, view, ctx) {
    var L = ctx.local;
    var wrap = el('div', 'cnp');
    root.appendChild(wrap);
    var top = el('div', 'cnp-top');
    var left = el('span', '', 'Puzzle ' + (view.pi + 1) + ' of ' + view.total);
    var timeB = el('b', '', '');
    top.appendChild(left); top.appendChild(timeB);
    wrap.appendChild(top);
    startTimer(ctx, view, timeB);
    var lives = el('div', 'cnp-lives');
    wrap.appendChild(lives);
    var msg = el('div', 'cnp-msg');
    msg.setAttribute('aria-live', 'polite');
    wrap.appendChild(msg);
    var banners = el('div');
    banners.style.cssText = 'display:flex;flex-direction:column;gap:8px';
    wrap.appendChild(banners);
    var grid = el('div', 'cnp-grid');
    wrap.appendChild(grid);
    var bar = el('div', 'cnp-bar');
    var clr = el('button', 'cnp-btn', 'Deselect');
    clr.type = 'button';
    var go = el('button', 'cnp-btn go', 'Submit');
    go.type = 'button';
    bar.appendChild(clr); bar.appendChild(go);
    wrap.appendChild(bar);

    var tileBtns = {};
    var sig = null;
    var last = view;

    function setMsg(text, kind) {
      msg.textContent = text || '';
      msg.className = 'cnp-msg' + (kind ? ' ' + kind : '');
    }
    function paintSel() {
      Object.keys(tileBtns).forEach(function (k) { tileBtns[k].classList.toggle('sel', L.sel.indexOf(Number(k)) >= 0); });
      var playing = last.status === 'playing';
      go.disabled = !(playing && L.sel.length === 4 && !L.pending);
      clr.disabled = !(playing && L.sel.length > 0);
    }
    function shake() {
      grid.classList.remove('cnp-shake');
      void grid.offsetWidth;
      grid.classList.add('cnp-shake');
    }
    function rebuild(v) {
      clearNode(banners); clearNode(grid); tileBtns = {};
      var solvedTiles = {};
      v.solved.forEach(function (g) {
        g.tiles.forEach(function (i) { solvedTiles[i] = true; });
        var b = el('div', 'cnp-banner cn-l' + g.level);
        b.appendChild(el('strong', '', g.category));
        b.appendChild(el('span', '', g.items.join(', ')));
        banners.appendChild(b);
      });
      v.tiles.forEach(function (text, i) {
        if (solvedTiles[i]) return;
        var t = el('button', 'cnp-tile', text);
        t.type = 'button';
        t.addEventListener('click', function () {
          if (last.status !== 'playing') return;
          var at = L.sel.indexOf(i);
          if (at >= 0) L.sel.splice(at, 1);
          else if (L.sel.length < 4) L.sel.push(i);
          paintSel();
        });
        grid.appendChild(t);
        tileBtns[i] = t;
      });
    }
    function paintLives(v) {
      clearNode(lives);
      lives.appendChild(el('span', '', 'Mistakes left '));
      for (var i = 0; i < v.maxMistakes; i++) lives.appendChild(el('span', 'cnp-dot' + (i < v.maxMistakes - v.mistakes ? '' : ' off')));
      lives.appendChild(el('span', '', ' ' + v.pts + ' pts'));
    }
    clr.addEventListener('click', function () { L.sel = []; paintSel(); });
    go.addEventListener('click', function () {
      if (L.sel.length !== 4 || L.pending || last.status !== 'playing') return;
      L.pending = true;
      L.sent = L.sel.slice();
      paintSel();
      ctx.send({ a: 'submit', tiles: L.sel.slice() });
    });

    L.p = {
      update: function (v) {
        last = v;
        var s = v.solved.map(function (g) { return g.tiles.join('.'); }).join('|');
        if (s !== sig) { sig = s; L.sel = L.sel.filter(function (i) { return !!tileBtns[i]; }); rebuild(v); }
        paintLives(v);
        if (v.status === 'solved') setMsg('Board complete. Waiting for the others.', 'good');
        else if (v.status === 'failed') setMsg('Out of mistakes. The answers come at the reveal.', 'bad');
        else if (L.msg) setMsg(L.msg.text, L.msg.kind);
        Object.keys(tileBtns).forEach(function (k) { tileBtns[k].disabled = v.status !== 'playing'; });
        paintSel();
      },
      ack: function (d) {
        L.pending = false;
        if (!d.ok) { L.msg = { text: d.error || 'Not accepted.', kind: 'bad' }; }
        else if (d.result === 'correct') { L.msg = { text: 'Correct! +' + d.pts + ' pts', kind: 'good' }; L.sel = []; }
        else if (d.result === 'oneaway') { L.msg = { text: 'One away!', kind: 'near' }; L.sel = []; shake(); }
        else { L.msg = { text: 'Not a group.', kind: 'bad' }; L.sel = []; shake(); }
        setMsg(L.msg.text, L.msg.kind);
        paintSel();
        clearTimeout(L.msgTimer);
        L.msgTimer = setTimeout(function () { L.msg = null; if (last.status === 'playing') setMsg('', ''); }, 3000);
      },
    };
  }

  function groupBlocks(parent, groups) {
    groups.forEach(function (g) {
      var b = el('div', 'cnp-banner cn-l' + g.level);
      b.appendChild(el('strong', '', g.category));
      b.appendChild(el('span', '', g.items.join(', ')));
      var ex = el('span', '', g.explain);
      ex.style.fontSize = '13px'; ex.style.opacity = '.85';
      b.appendChild(ex);
      parent.appendChild(b);
    });
  }

  function buildReveal(root, view, ctx) {
    var L = ctx.local;
    var wrap = el('div', 'cnp');
    root.appendChild(wrap);
    var top = el('div', 'cnp-top');
    top.appendChild(el('span', '', 'Puzzle ' + (view.pi + 1) + ' of ' + view.total));
    var timeB = el('b', '', '');
    top.appendChild(timeB);
    wrap.appendChild(top);
    startTimer(ctx, view, timeB, 'Next ');
    var card = el('div', 'cnp-card');
    var res = el('div', 'cnp-big');
    var sub = el('div', 'cnp-note');
    card.appendChild(res); card.appendChild(sub);
    wrap.appendChild(card);
    groupBlocks(wrap, view.groups || []);
    L.p = {
      update: function (v) {
        res.textContent = v.status === 'solved' ? 'Solved! +' + v.pts + ' pts' : (v.status === 'failed' ? 'Out of mistakes' : (v.solved.length ? v.solved.length + ' of 4 groups' : 'No groups found'));
        sub.textContent = 'This puzzle: ' + v.pts + ' pts. Run total: ' + v.runPts + ' pts. Rank ' + v.rank + ' of ' + v.players + '.';
      },
    };
  }

  function buildDone(root, view, ctx) {
    var L = ctx.local;
    var wrap = el('div', 'cnp');
    root.appendChild(wrap);
    var card = el('div', 'cnp-card');
    var big = el('div', 'cnp-big');
    var sub = el('div', 'cnp-note');
    card.appendChild(big); card.appendChild(sub);
    wrap.appendChild(card);
    wrap.appendChild(el('div', 'cnp-note', 'Top 5'));
    var list = el('div');
    wrap.appendChild(list);
    L.p = {
      update: function (v) {
        big.textContent = v.rank ? 'You placed #' + v.rank : 'Run complete';
        sub.textContent = v.runPts + ' pts in this run';
        clearNode(list);
        (v.top || []).forEach(function (r, i) {
          var row = el('div', 'cnp-row');
          row.appendChild(el('span', '', (i + 1) + '. ' + r.name));
          row.appendChild(el('b', '', r.pts + ' pts'));
          list.appendChild(row);
        });
      },
    };
  }

  window.ZebraAct.register('connections', {
    css: CSS,
    renderHost: renderHost,
    renderPhone: renderPhone,
    onAck: function (d, ctx) {
      var p = ctx && ctx.local && ctx.local.p;
      if (p && typeof p.ack === 'function' && d) p.ack(d);
    },
  });
})();
