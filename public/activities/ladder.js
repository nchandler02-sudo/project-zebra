/* Confidence Ladder: projector and phone UI. Server logic is in server/activities/ladder.js. */
(function () {
  'use strict';
  var LETTERS = ['A', 'B', 'C', 'D'];
  var LIFE = [['fifty', '50:50'], ['room', 'Ask the room'], ['senior', 'Phone a senior']];

  var CSS = [
    '.lad-h{display:grid;grid-template-columns:minmax(0,1fr) 38rem;gap:3rem;height:100%;padding:2rem 3rem;box-sizing:border-box;color:var(--text);}',
    '.lad-h-main{display:flex;flex-direction:column;gap:2rem;min-width:0;}',
    '.lad-h-top{display:flex;justify-content:space-between;align-items:baseline;gap:2rem;}',
    '.lad-h-step{font-family:var(--display);font-size:3.4rem;text-transform:uppercase;letter-spacing:.06em;color:var(--accent);}',
    '.lad-h-timer{font-family:var(--display);font-size:5.5rem;line-height:1;font-variant-numeric:tabular-nums;}',
    '.lad-h-timer.low{color:#ff6a6a;}',
    '.lad-h-q{font-size:4.2rem;line-height:1.2;font-weight:600;}',
    '.lad-h-opts{display:grid;grid-template-columns:1fr 1fr;gap:1.4rem;}',
    '.lad-h-opt{position:relative;overflow:hidden;border:.25rem solid var(--line);border-radius:1.4rem;padding:1.4rem 1.8rem;font-size:3rem;line-height:1.2;background:var(--panel);display:flex;gap:1.2rem;align-items:center;min-height:7rem;}',
    '.lad-h-opt b{font-family:var(--display);color:var(--accent);font-size:3.4rem;}',
    '.lad-h-opt.right{border-color:#5fd3a5;background:rgba(95,211,165,.22);}',
    '.lad-h-opt.dim{opacity:.55;}',
    '.lad-h-opt .bar{position:absolute;left:0;bottom:0;height:.9rem;background:var(--accent);opacity:.8;}',
    '.lad-h-opt .pc{margin-left:auto;font-family:var(--display);font-size:3.4rem;font-variant-numeric:tabular-nums;}',
    '.lad-h-meta{font-size:2.6rem;color:var(--muted);}',
    '.lad-h-why{font-size:2.8rem;line-height:1.35;color:var(--text);border-left:.5rem solid var(--accent);padding-left:1.6rem;}',
    '.lad-h-lad{display:flex;flex-direction:column;gap:.6rem;justify-content:center;}',
    '.lad-h-rung{display:flex;align-items:center;gap:1.2rem;padding:.5rem 1.4rem;border-radius:1rem;border:.2rem solid var(--line);background:var(--panel);font-size:2.6rem;min-height:4.4rem;}',
    '.lad-h-rung .n{width:3.6rem;font-family:var(--display);color:var(--muted);}',
    '.lad-h-rung .p{font-family:var(--display);font-size:2.8rem;font-variant-numeric:tabular-nums;}',
    '.lad-h-rung .s{font-size:1.8rem;letter-spacing:.12em;color:#5fd3a5;text-transform:uppercase;}',
    '.lad-h-rung .c{margin-left:auto;min-width:5rem;text-align:center;border-radius:2rem;padding:0 1.2rem;font-family:var(--display);font-size:2.8rem;background:rgba(255,255,255,.08);}',
    '.lad-h-rung .c.on{background:var(--accent);color:var(--accent-ink);}',
    '.lad-h-rung.safe{border-color:#5fd3a5;}',
    '.lad-h-rung.cur{border-color:var(--accent);box-shadow:0 0 0 .3rem var(--glow);background:rgba(255,194,61,.14);}',
    '.lad-h-rung.top .p{color:var(--accent);}',
    '.lad-h-done{display:grid;grid-template-columns:1fr 1fr;gap:3rem;padding:2rem 3rem;color:var(--text);}',
    '.lad-h-done h2{font-family:var(--display);font-size:4rem;margin:0 0 1.2rem;color:var(--accent);text-transform:uppercase;}',
    '.lad-h-row{display:flex;gap:1.5rem;font-size:3rem;padding:.5rem 0;border-bottom:.15rem solid var(--line);}',
    '.lad-h-row .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    '.lad-h-row .pt{font-family:var(--display);font-variant-numeric:tabular-nums;color:var(--accent);}',
    /* phone */
    '.lad-p{display:flex;flex-direction:column;gap:12px;padding:14px 16px 24px;color:var(--ink);box-sizing:border-box;max-width:100%;}',
    '.lad-p-head{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:14px;color:var(--ink-dim);}',
    '.lad-p-head b{color:var(--signal);font-size:16px;}',
    '.lad-p-timer{font-family:var(--font-mono);font-size:22px;color:var(--ink);}',
    '.lad-p-timer.low{color:var(--danger);}',
    '.lad-p-q{font-family:var(--font-display);font-size:20px;line-height:1.3;overflow-wrap:anywhere;}',
    '.lad-p-opt{display:flex;gap:10px;align-items:center;min-height:56px;width:100%;box-sizing:border-box;text-align:left;padding:10px 14px;border-radius:14px;border:2px solid var(--line);background:var(--surface);color:var(--ink);font:inherit;font-size:16px;overflow-wrap:anywhere;cursor:pointer;}',
    '.lad-p-opt b{color:var(--signal);min-width:18px;}',
    '.lad-p-opt.sel{border-color:var(--signal);background:rgba(255,176,32,.16);}',
    '.lad-p-opt.right{border-color:var(--ok);background:rgba(95,211,165,.2);}',
    '.lad-p-opt.mine.wrong{border-color:var(--danger);}',
    '.lad-p-opt.gone{opacity:.3;text-decoration:line-through;}',
    '.lad-p-opt[disabled]{cursor:default;}',
    '.lad-p-opt .tag{margin-left:auto;font-size:12px;color:var(--ink-dim);white-space:nowrap;}',
    '.lad-p-btn{min-height:48px;padding:8px 14px;border-radius:12px;border:2px solid var(--line);background:var(--surface);color:var(--ink);font:inherit;font-size:15px;cursor:pointer;flex:1 1 0;}',
    '.lad-p-btn.go{background:var(--signal);color:var(--signal-ink);border-color:var(--signal);font-weight:700;}',
    '.lad-p-btn.warn{border-color:var(--danger);color:var(--danger);}',
    '.lad-p-btn[disabled]{opacity:.35;cursor:default;}',
    '.lad-p-row{display:flex;gap:8px;flex-wrap:wrap;}',
    '.lad-p-info{padding:10px 12px;border-radius:12px;background:var(--surface);border:1px solid var(--line);font-size:15px;line-height:1.35;overflow-wrap:anywhere;}',
    '.lad-p-big{font-family:var(--font-display);font-size:26px;line-height:1.2;}',
    '.lad-p-dim{color:var(--ink-dim);font-size:14px;}',
    '.lad-p-ok{color:var(--ok);}',
    '.lad-p-bad{color:var(--danger);}',
    '.lad-p-row.life .lad-p-btn{font-size:13px;padding:6px 4px;}',
  ].join('\n');

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function sigOf(v) { var c = {}; for (var k in v) if (k !== 'endsInMs') c[k] = v[k]; return JSON.stringify(c); }

  /** Re-draw only when the content changed. build(root) fills an emptied root and returns the timer element or null. */
  function sync(root, view, ctx, extraSig, build) {
    var L = ctx.local;
    if (ctx.firstRender && L.timer) { clearInterval(L.timer); L.timer = null; }
    var sig = sigOf(view) + '|' + (extraSig || '');
    if (L.sig !== sig) {
      L.sig = sig;
      clear(root);
      L.timerEl = build(root) || null;
    }
    if (L.timerEl && view.endsInMs != null) {
      if (!ctx.isRedraw) L.endsAt = ctx.endsAt(view);
      if (!L.timer) {
        var tick = function () {
          var t = L.timerEl;
          if (!t || !document.body.contains(t)) { clearInterval(L.timer); L.timer = null; return; }
          var s = Math.max(0, Math.ceil((L.endsAt - Date.now()) / 1000));
          t.textContent = String(s);
          if (t.classList) t.classList.toggle('low', s <= 5);
        };
        L.timer = setInterval(tick, 250);
        tick();
      }
    } else if (!L.timerEl && L.timer) { clearInterval(L.timer); L.timer = null; }
  }

  function prizeText(p) { return String(p); }

  // ---------- host ----------
  function hostLadder(v) {
    var lad = el('div', 'lad-h-lad');
    for (var k = v.steps; k >= 0; k--) {
      var safe = v.safe.indexOf(k) >= 0;
      var cls = 'lad-h-rung' + (safe ? ' safe' : '') + (k === v.steps ? ' top' : '');
      if (v.stage === 'ask' && k === v.step - 1) cls += ' cur';
      if (v.stage === 'reveal' && k === v.step) cls += ' cur';
      var r = el('div', cls);
      r.appendChild(el('span', 'n', k === 0 ? '' : String(k)));
      r.appendChild(el('span', 'p', k === 0 ? 'START' : prizeText(v.prizes[k - 1]) + ' pts'));
      if (safe) r.appendChild(el('span', 's', 'safe'));
      var n = v.ladder[k] || 0;
      r.appendChild(el('span', 'c' + (n ? ' on' : ''), String(n)));
      lad.appendChild(r);
    }
    return lad;
  }

  function renderHost(root, view, ctx) {
    var v = view;
    sync(root, v, ctx, '', function (root) {
      if (v.stage === 'done') return hostDone(root, v);
      var wrap = el('div', 'lad-h');
      var main = el('div', 'lad-h-main');
      var top = el('div', 'lad-h-top');
      top.appendChild(el('div', 'lad-h-step', 'Step ' + v.step + ' of ' + v.steps + ' / ' + v.prizes[v.step - 1] + ' pts'));
      var timer = el('div', 'lad-h-timer', '');
      top.appendChild(timer);
      main.appendChild(top);
      main.appendChild(el('div', 'lad-h-q', v.q));
      var opts = el('div', 'lad-h-opts');
      v.options.forEach(function (t, i) {
        var o = el('div', 'lad-h-opt' + (v.stage === 'reveal' ? (i === v.correct ? ' right' : ' dim') : ''));
        o.appendChild(el('b', null, LETTERS[i]));
        o.appendChild(el('span', null, t));
        if (v.stage === 'reveal') {
          o.appendChild(el('span', 'pc', (v.pct[i] || 0) + '%'));
          var bar = el('div', 'bar'); bar.style.width = (v.pct[i] || 0) + '%';
          o.appendChild(bar);
        }
        opts.appendChild(o);
      });
      main.appendChild(opts);
      if (v.stage === 'ask') {
        main.appendChild(el('div', 'lad-h-meta', v.locked + ' of ' + v.climbing + ' climbers locked in'));
      } else {
        if (v.why) main.appendChild(el('div', 'lad-h-why', v.why));
        main.appendChild(el('div', 'lad-h-meta', v.climbing ? v.climbing + ' still climbing. Next question soon.' : 'Nobody is climbing any more.'));
      }
      wrap.appendChild(main);
      wrap.appendChild(hostLadder(v));
      root.appendChild(wrap);
      return v.stage === 'ask' ? timer : (timer.textContent = '', null);
    });
  }

  function hostDone(root, v) {
    var wrap = el('div', 'lad-h-done');
    var a = el('div');
    a.appendChild(el('h2', null, 'Final winnings'));
    if (!v.winnings.length) a.appendChild(el('div', 'lad-h-row', 'Nobody played.'));
    v.winnings.forEach(function (w, i) {
      var r = el('div', 'lad-h-row');
      r.appendChild(el('span', null, (i + 1) + '.'));
      r.appendChild(el('span', 'nm', w.name));
      r.appendChild(el('span', 'pt', '+' + w.points));
      a.appendChild(r);
    });
    var b = el('div');
    b.appendChild(el('h2', null, 'Reached each rung'));
    for (var k = v.steps; k >= 1; k--) {
      var r2 = el('div', 'lad-h-row');
      r2.appendChild(el('span', null, 'Step ' + k));
      r2.appendChild(el('span', 'nm', v.prizes[k - 1] + ' pts' + (v.safe.indexOf(k) >= 0 ? ' (safe)' : '')));
      r2.appendChild(el('span', 'pt', String(v.reached[k - 1] || 0)));
      b.appendChild(r2);
    }
    wrap.appendChild(a); wrap.appendChild(b);
    root.appendChild(wrap);
    return null;
  }

  // ---------- phone ----------
  function lifeInfo(v, name) {
    var lr = (v.me && v.me.lifeResults) || {};
    var r = lr[name];
    if (!r) return null;
    if (name === 'room') {
      var s = 'The room (' + r.n + ' locked): ' + r.pct.map(function (p, i) { return LETTERS[i] + ' ' + p + '%'; }).join(', ');
      return s + (r.note ? '. ' + r.note : '');
    }
    if (name === 'senior') {
      return r.none ? 'No senior has answered yet.' : 'A senior (rank #' + r.rank + ') locked in ' + LETTERS[r.option] + '.';
    }
    return '50:50: two wrong answers removed.';
  }

  function renderPhone(root, view, ctx) {
    var v = view, L = ctx.local;
    if (ctx.firstRender) { L.sel = null; L.walkArm = false; L.msg = ''; }
    L.redraw = function () { var c2 = Object.create(ctx); c2.firstRender = false; c2.isRedraw = true; renderPhone(root, L.lastView, c2); };
    L.lastView = v;
    sync(root, v, ctx, [L.sel, L.walkArm, L.msg].join('~'), function (root) {
      var me = v.me;
      var wrap = el('div', 'lad-p');
      if (v.stage === 'done') {
        wrap.appendChild(el('div', 'lad-p-big', 'Ladder complete'));
        var won = me.won || 0;
        wrap.appendChild(el('div', 'lad-p-info', me.status === 'spectator' ? 'You joined too late to climb.' : 'You banked ' + won + ' points. Reached step ' + me.completed + ' of ' + v.steps + '.'));
        v.winnings.slice(0, 8).forEach(function (w, i) {
          wrap.appendChild(el('div', 'lad-p-dim', (i + 1) + '. ' + w.name + '  +' + w.points));
        });
        root.appendChild(wrap);
        return null;
      }
      var head = el('div', 'lad-p-head');
      var hl = el('span', null, 'Step ' + v.step + ' of ' + v.steps + ' / ');
      hl.appendChild(el('b', null, v.prizes[v.step - 1] + ' pts'));
      head.appendChild(hl);
      var timer = el('span', 'lad-p-timer', '');
      head.appendChild(timer);
      wrap.appendChild(head);
      var climbing = me.status === 'climbing';
      wrap.appendChild(el('div', 'lad-p-dim', climbing
        ? 'Banked ' + me.banked + ' pts. Safe: ' + me.safePoints + ' pts.'
        : me.status === 'spectator' ? 'You are watching this one.' : me.status === 'walked' ? 'You walked away with ' + me.final + ' pts. Watching now.' : me.status === 'top' ? 'You reached the top!' : 'You fell to ' + me.final + ' pts. Watching now.'));
      wrap.appendChild(el('div', 'lad-p-q', v.q));

      var reveal = v.stage === 'reveal';
      var hidden = ((me.lifeResults || {}).fifty || {}).hide || [];
      var canPick = v.stage === 'ask' && climbing && me.locked == null;
      v.options.forEach(function (t, i) {
        var cls = 'lad-p-opt';
        if (reveal) cls += i === v.correct ? ' right' : '';
        if (reveal && me.locked === i) cls += ' mine' + (i === v.correct ? '' : ' wrong');
        if (!reveal && hidden.indexOf(i) >= 0) cls += ' gone';
        if (!reveal && (L.sel === i || me.locked === i)) cls += ' sel';
        var b = el('button', cls);
        b.type = 'button';
        b.appendChild(el('b', null, LETTERS[i]));
        b.appendChild(el('span', null, t));
        if (me.locked === i) b.appendChild(el('span', 'tag', 'locked'));
        else if (reveal) b.appendChild(el('span', 'tag', (v.pct[i] || 0) + '%'));
        b.disabled = !canPick || hidden.indexOf(i) >= 0;
        b.addEventListener('click', function () { L.sel = i; L.walkArm = false; L.msg = ''; L.redraw(); });
        wrap.appendChild(b);
      });

      if (v.stage === 'ask' && climbing) {
        if (me.locked != null) {
          wrap.appendChild(el('div', 'lad-p-info', 'Locked in ' + LETTERS[me.locked] + '. Waiting for the others...'));
        } else {
          if (L.sel != null) {
            var row = el('div', 'lad-p-row');
            var go = el('button', 'lad-p-btn go', 'Final answer? ' + LETTERS[L.sel]);
            go.type = 'button';
            go.addEventListener('click', function () { var i = L.sel; L.sel = null; ctx.send({ lock: i }); });
            var no = el('button', 'lad-p-btn', 'Not yet');
            no.type = 'button';
            no.addEventListener('click', function () { L.sel = null; L.redraw(); });
            row.appendChild(go); row.appendChild(no);
            wrap.appendChild(row);
          }
          var lrow = el('div', 'lad-p-row life');
          LIFE.forEach(function (l) {
            var b2 = el('button', 'lad-p-btn', l[1]);
            b2.type = 'button';
            b2.disabled = !!me.lifelines[l[0]];
            b2.addEventListener('click', function () { ctx.send({ lifeline: l[0] }); });
            lrow.appendChild(b2);
          });
          wrap.appendChild(lrow);
          var wk = el('button', 'lad-p-btn warn', L.walkArm ? 'Confirm: walk away with ' + me.walkPoints + ' pts' : 'Walk away (' + me.walkPoints + ' pts)');
          wk.type = 'button';
          wk.addEventListener('click', function () {
            if (!L.walkArm) { L.walkArm = true; L.redraw(); return; }
            L.walkArm = false; ctx.send({ walk: true });
          });
          wrap.appendChild(wk);
        }
      }
      ['fifty', 'room', 'senior'].forEach(function (n) {
        var t = lifeInfo(v, n);
        if (t && n !== 'fifty') wrap.appendChild(el('div', 'lad-p-info', t));
      });
      if (L.msg) wrap.appendChild(el('div', 'lad-p-info lad-p-bad', L.msg));

      if (reveal) {
        var res = me.result;
        var txt = res === 'right' ? 'Correct! You climb.' : res === 'wrong' ? 'Wrong. You fall to ' + me.final + ' pts.' : res === 'timeout' ? 'Out of time. You fall to ' + me.final + ' pts.' : res === 'top' ? 'Top of the ladder!' : '';
        if (me.status === 'top') txt = 'Correct! You reached the top: ' + me.final + ' pts.';
        if (txt) wrap.appendChild(el('div', 'lad-p-info ' + (res === 'right' || me.status === 'top' ? 'lad-p-ok' : 'lad-p-bad'), txt));
        if (v.why) wrap.appendChild(el('div', 'lad-p-info', v.why));
      }
      root.appendChild(wrap);
      return v.stage === 'ask' ? timer : null;
    });
  }

  function onAck(d, ctx) {
    var L = ctx && ctx.local;
    if (!L || !d) return;
    if (d.ok === false) { L.msg = d.error || 'That did not work.'; if (L.redraw) L.redraw(); }
  }

  window.ZebraAct.register('ladder', { css: CSS, renderHost: renderHost, renderPhone: renderPhone, onAck: onAck });
})();
