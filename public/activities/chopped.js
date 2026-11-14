/* Medical Chopped client: projector + phone. See server/activities/chopped.js. */
(function () {
  'use strict';

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
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
      node.classList.toggle('ch-low', s <= 10);
    }
    upd();
    local.timer = setInterval(upd, 250);
  }
  /** True when the visible structure must be rebuilt. Resets timers and per-stage state on change. */
  function changed(root, local, key) {
    if (local.key === key && root.firstChild) return false;
    stopTimer(local);
    local.key = key;
    local.saved = false;
    empty(root);
    return true;
  }

  var KIND = { 'leading': 'Leading', 'must-not-miss': 'Must not miss', 'reasonable': 'Reasonable', 'rare-but-valid': 'Rare but valid' };

  var CSS = [
    /* projector */
    '.ch-host{width:100%;height:100%;display:flex;flex-direction:column;gap:1.4rem;padding:2.4rem 4.5rem;color:var(--ink,#fbf1de);font-family:var(--body,system-ui);overflow:hidden}',
    '.ch-head{display:flex;justify-content:space-between;align-items:center;gap:2rem;font-size:2.2rem;color:var(--muted,#d8c6a6)}',
    '.ch-head b{color:var(--accent,#ffc23d)}',
    '.ch-timer{font-size:5.4rem;font-weight:800;color:var(--accent,#ffc23d);min-width:7rem;text-align:right;font-variant-numeric:tabular-nums;line-height:1}',
    '.ch-timer.ch-low{color:#ff6a2b}',
    '.ch-sub{font-size:2.2rem;color:var(--muted,#d8c6a6)}',
    '.ch-stages{display:flex;flex-direction:column;gap:1rem;flex:1;min-height:0;justify-content:flex-start}',
    '.ch-stage{padding:1rem 1.8rem;border-radius:1.2rem;border:.2rem solid var(--line,#6b5a45);background:var(--panel,#1e151e);opacity:.78}',
    '.ch-stage.ch-new{opacity:1;border-color:var(--accent,#ffc23d);background:var(--panel-2,rgba(58,41,52,.88));box-shadow:0 0 2.4rem var(--glow,rgba(255,194,61,.16))}',
    '.ch-lab{font-size:1.6rem;letter-spacing:.12em;text-transform:uppercase;color:var(--accent,#ffc23d);margin-bottom:.3rem}',
    '.ch-txt{line-height:1.25;margin:0}',
    '.ch-s1 .ch-txt{font-size:3.2rem}.ch-s2 .ch-txt{font-size:2.9rem}.ch-s3 .ch-txt{font-size:2.5rem}.ch-s4 .ch-txt{font-size:2.2rem}',
    '.ch-cols{display:grid;grid-template-columns:1.4fr 1fr;gap:3rem;flex:1;min-height:0}',
    '.ch-h{font-size:2rem;letter-spacing:.1em;text-transform:uppercase;color:var(--accent,#ffc23d);margin:0 0 .8rem}',
    '.ch-bar{display:grid;grid-template-columns:30rem 1fr 5rem;gap:1.2rem;align-items:center;font-size:2.4rem;margin:.5rem 0}',
    '.ch-bar i{display:block;height:2.4rem;background:var(--accent,#ffc23d);border-radius:.4rem;min-width:.4rem}',
    '.ch-list{font-size:2.5rem;margin:0;padding:0;list-style:none}',
    '.ch-list li{display:flex;justify-content:space-between;gap:1.4rem;padding:.4rem 0;border-bottom:.1rem solid var(--line,#6b5a45)}',
    '.ch-chop{margin-top:1.2rem;padding:1.2rem 1.8rem;border-radius:1.2rem;border:.3rem solid #ff6a2b;background:rgba(255,106,43,.16);font-size:2.8rem;font-weight:700}',
    '.ch-safe{margin-top:1.2rem;font-size:2.2rem;color:var(--muted,#d8c6a6)}',
    '.ch-dx{font-size:6rem;font-weight:800;color:var(--accent,#ffc23d);line-height:1.05;margin:0}',
    '.ch-dxl{font-size:2rem;display:grid;grid-template-columns:1fr 1fr;gap:.2rem 2.4rem;margin:0;padding:0;list-style:none}',
    '.ch-dxl li{display:flex;gap:1rem;justify-content:space-between;padding:.3rem 0;border-bottom:.1rem solid var(--line,#6b5a45)}',
    '.ch-k{font-size:1.5rem;color:var(--muted,#d8c6a6);white-space:nowrap}',
    '.ch-k.mnm{color:#ff8a5c;font-weight:700}',
    '.ch-teach{font-size:2.2rem;line-height:1.3;margin:0}',
    '.ch-btn{align-self:flex-end;font-size:2rem;padding:.8rem 2.4rem;border-radius:1rem;border:.2rem solid var(--accent,#ffc23d);background:var(--accent,#ffc23d);color:var(--accent-ink,#1b1300);font-weight:800;cursor:pointer}',
    /* phone */
    '.chp{display:flex;flex-direction:column;gap:12px;padding:12px 0;color:var(--ink,#fff2f4);max-width:100%;overflow-wrap:anywhere}',
    '.chp-top{display:flex;justify-content:space-between;align-items:center;font-size:14px;color:var(--ink-dim,#f0a8b5);gap:8px}',
    '.chp-timer{font-size:28px;font-weight:800;color:var(--signal,#ff2c4f);font-variant-numeric:tabular-nums}',
    '.chp-timer.ch-low{color:#ff6a2b}',
    '.chp-stage{padding:10px 12px;border-radius:12px;border:2px solid var(--line,#62162b);background:var(--surface,#1a0710);opacity:.8}',
    '.chp-stage.ch-new{opacity:1;border-color:var(--signal,#ff2c4f);background:var(--surface-2,#27091a)}',
    '.chp-lab{font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--signal,#ff2c4f);margin-bottom:2px}',
    '.chp-txt{font-size:16px;line-height:1.35;margin:0}',
    '.chp input{width:100%;min-height:48px;font-size:16px;padding:8px 12px;border-radius:12px;border:2px solid var(--line,#62162b);background:var(--surface,#1a0710);color:var(--ink,#fff2f4);box-sizing:border-box}',
    '.chp input:focus{outline:none;border-color:var(--signal,#ff2c4f)}',
    '.chp-go{min-height:52px;font-size:18px;font-weight:800;border-radius:14px;border:0;background:var(--signal,#ff2c4f);color:var(--signal-ink,#fff);width:100%}',
    '.chp-go:disabled{opacity:.5}',
    '.chp-note{font-size:14px;color:var(--ink-dim,#f0a8b5)}',
    '.chp-big{font-size:36px;font-weight:800;text-align:center;margin:4px 0}',
    '.chp-ban{padding:12px;border-radius:12px;border:2px solid #ff6a2b;background:rgba(255,106,43,.16);font-size:16px;font-weight:700;text-align:center}',
    '.chp-row{display:flex;justify-content:space-between;gap:8px;font-size:15px;padding:6px 0;border-bottom:1px solid var(--line,#62162b)}',
    '.chp-h{font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:var(--signal,#ff2c4f);margin:6px 0 0}'
  ].join('');

  // ---------- shared pieces ----------
  function stageBlocks(stages, host) {
    var wrap = el('div', host ? 'ch-stages ch-s' + stages.length : 'chp-stages');
    if (!host) wrap.style.cssText = 'display:flex;flex-direction:column;gap:8px';
    stages.forEach(function (s, i) {
      var last = i === stages.length - 1;
      var box = el('div', (host ? 'ch-stage' : 'chp-stage') + (last ? ' ch-new' : ''));
      box.appendChild(el('div', host ? 'ch-lab' : 'chp-lab', (i + 1) + '. ' + s.label));
      box.appendChild(el('p', host ? 'ch-txt' : 'chp-txt', s.text));
      wrap.appendChild(box);
    });
    return wrap;
  }

  function dxList(dx, host) {
    var ul = el('ul', host ? 'ch-dxl' : 'chp-dxl');
    if (!host) ul.style.cssText = 'list-style:none;margin:0;padding:0';
    dx.forEach(function (d) {
      var li = el('li', host ? '' : 'chp-row');
      var left = el('span', '', d.name);
      var right = el('span', host ? 'ch-k' + (d.kind === 'must-not-miss' ? ' mnm' : '') : 'chp-note', (KIND[d.kind] || d.kind) + ' · ' + d.points + ' pt' + (d.points === 1 ? '' : 's'));
      if (!host && d.kind === 'must-not-miss') right.style.color = '#ff8a5c';
      li.appendChild(left); li.appendChild(right);
      ul.appendChild(li);
    });
    return ul;
  }

  // ---------- projector ----------
  function hostHead(v, ctx, withTimer) {
    var head = el('div', 'ch-head');
    var l = el('div', '');
    var b = el('b', '', 'Medical Chopped');
    l.appendChild(b);
    l.appendChild(document.createTextNode('  ·  Stage ' + (v.stageIdx + 1) + ' of 4  ·  ' + v.alive + ' still in' + (v.chopped ? ', ' + v.chopped + ' chopped' : '')));
    head.appendChild(l);
    if (withTimer) {
      var t = el('div', 'ch-timer', '');
      head.appendChild(t);
      startTimer(ctx.local, ctx.endsAt(v), t);
    }
    return head;
  }

  function nextBtn(ctx, label) {
    var b = el('button', 'ch-btn', label);
    b.type = 'button';
    b.addEventListener('click', function () { ctx.sendHost('next'); });
    return b;
  }

  function hostThink(root, v, ctx) {
    var L = ctx.local;
    if (changed(root, L, 'think:' + v.stageIdx)) {
      var w = el('div', 'ch-host');
      w.appendChild(hostHead(v, ctx, true));
      L.count = el('div', 'ch-sub', '');
      w.appendChild(L.count);
      w.appendChild(stageBlocks(v.stages, true));
      w.appendChild(nextBtn(ctx, 'Close this stage'));
      root.appendChild(w);
    }
    L.count.textContent = v.submitted + ' of ' + v.expected + ' have written a differential';
  }

  function hostResult(root, v, ctx) {
    var sig = 'result:' + JSON.stringify([v.stageIdx, v.top, v.other, v.leaders, v.chop]);
    if (!changed(root, ctx.local, sig)) return;
    var w = el('div', 'ch-host');
    w.appendChild(hostHead(v, ctx, false));
    var cols = el('div', 'ch-cols');
    var left = el('div', '');
    left.appendChild(el('h3', 'ch-h', 'What the room wrote'));
    var max = 1;
    v.top.forEach(function (t) { if (t.count > max) max = t.count; });
    v.top.forEach(function (t) {
      var r = el('div', 'ch-bar');
      r.appendChild(el('span', '', t.name));
      var i = el('i', ''); i.style.width = Math.max(2, Math.round(100 * t.count / max)) + '%';
      var wrap = el('span', ''); wrap.appendChild(i);
      r.appendChild(wrap);
      r.appendChild(el('b', '', String(t.count)));
      left.appendChild(r);
    });
    if (!v.top.length) left.appendChild(el('div', 'ch-sub', 'No recognised diagnoses this stage.'));
    left.appendChild(el('div', 'ch-sub', 'Other answers: ' + v.other));
    var right = el('div', '');
    right.appendChild(el('h3', 'ch-h', 'Leaders'));
    var ul = el('ul', 'ch-list');
    v.leaders.forEach(function (p) {
      var li = el('li', '');
      li.appendChild(el('span', '', p.name));
      li.appendChild(el('b', '', p.score + '  (+' + p.stageScore + ')'));
      ul.appendChild(li);
    });
    right.appendChild(ul);
    if (v.chop && v.chop.length) {
      right.appendChild(el('div', 'ch-chop', 'CHOPPED: ' + v.chop.map(function (c) { return c.name; }).join(', ')));
    } else {
      right.appendChild(el('div', 'ch-safe', v.stageIdx >= 3 ? 'Everyone left standing reaches the reveal.' : 'No chop this time.'));
    }
    cols.appendChild(left); cols.appendChild(right);
    w.appendChild(cols);
    w.appendChild(nextBtn(ctx, v.last ? 'Reveal the diagnosis' : 'Next stage'));
    root.appendChild(w);
  }

  function hostReveal(root, v, ctx) {
    if (!changed(root, ctx.local, 'reveal')) return;
    var w = el('div', 'ch-host');
    var head = el('div', 'ch-head');
    var b = el('b', '', 'Final diagnosis');
    head.appendChild(b);
    w.appendChild(head);
    w.appendChild(el('h1', 'ch-dx', v.diagnosis));
    var cols = el('div', 'ch-cols');
    cols.style.gridTemplateColumns = '1.5fr 1fr';
    var left = el('div', '');
    left.appendChild(el('h3', 'ch-h', 'The full differential'));
    left.appendChild(dxList(v.differential, true));
    var right = el('div', '');
    right.appendChild(el('h3', 'ch-h', 'Teaching'));
    right.appendChild(el('p', 'ch-teach', v.teaching));
    right.appendChild(el('h3', 'ch-h', 'Best stage of each survivor'));
    var ul = el('ul', 'ch-list');
    v.best.slice(0, 6).forEach(function (p) {
      var li = el('li', '');
      li.appendChild(el('span', '', p.name));
      li.appendChild(el('b', '', p.stage + ' (' + p.score + ')'));
      ul.appendChild(li);
    });
    right.appendChild(ul);
    cols.appendChild(left); cols.appendChild(right);
    w.appendChild(cols);
    w.appendChild(nextBtn(ctx, 'Final ranking'));
    root.appendChild(w);
  }

  function hostDone(root, v, ctx) {
    var sig = 'done:' + JSON.stringify([v.ranking, v.chopList]);
    if (!changed(root, ctx.local, sig)) return;
    var w = el('div', 'ch-host');
    var head = el('div', 'ch-head');
    head.appendChild(el('b', '', 'Medical Chopped: final ranking'));
    w.appendChild(head);
    var champs = v.champions || [];
    if (champs.length) w.appendChild(el('h1', 'ch-dx', 'Champion: ' + champs.join(' & ')));
    var cols = el('div', 'ch-cols');
    cols.style.gridTemplateColumns = '1.2fr 1fr';
    var left = el('div', '');
    left.appendChild(el('h3', 'ch-h', 'Survivors'));
    var ul = el('ul', 'ch-list');
    (v.ranking || []).slice(0, 8).forEach(function (p) {
      var li = el('li', '');
      li.appendChild(el('span', '', p.rank + '. ' + p.name));
      li.appendChild(el('b', '', p.score + (p.champion ? '  +20' : '')));
      ul.appendChild(li);
    });
    left.appendChild(ul);
    var right = el('div', '');
    right.appendChild(el('h3', 'ch-h', 'Chopped'));
    var ul2 = el('ul', 'ch-list');
    (v.chopList || []).slice(0, 8).forEach(function (p) {
      var li = el('li', '');
      li.appendChild(el('span', '', p.name + ' (after stage ' + p.at + ')'));
      li.appendChild(el('b', '', String(p.score)));
      ul2.appendChild(li);
    });
    if (!(v.chopList || []).length) ul2.appendChild(el('li', '', 'Nobody was chopped'));
    right.appendChild(ul2);
    cols.appendChild(left); cols.appendChild(right);
    w.appendChild(cols);
    w.appendChild(nextBtn(ctx, 'Play another case'));
    root.appendChild(w);
  }

  // ---------- phone ----------
  function phoneTop(v, ctx, withTimer) {
    var top = el('div', 'chp-top');
    top.appendChild(el('span', '', 'Stage ' + (v.stageIdx + 1) + ' of 4 · Score ' + v.cum));
    if (withTimer) {
      var t = el('span', 'chp-timer', '');
      top.appendChild(t);
      startTimer(ctx.local, ctx.endsAt(v), t);
    }
    return top;
  }

  function statusBanner(v) {
    if (v.status === 'chopped') return el('div', 'chp-ban', 'You were chopped with ' + v.cum + ' points. Keep watching: the teaching is the same.');
    if (v.status === 'watching') return el('div', 'chp-ban', 'You joined after the case began. Watch this one and play the next.');
    return null;
  }

  function phoneThink(root, v, ctx) {
    var L = ctx.local;
    if (changed(root, L, 'think:' + v.stageIdx + ':' + v.status)) {
      var w = el('div', 'chp');
      w.appendChild(phoneTop(v, ctx, true));
      var ban = statusBanner(v);
      if (ban) w.appendChild(ban);
      w.appendChild(stageBlocks(v.stages, false));
      L.inputs = [];
      if (v.status === 'alive') {
        w.appendChild(el('div', 'chp-h', 'Your differential (up to ' + v.max + ')'));
        var status = el('div', 'chp-note', 'Name up to ' + v.max + ' diagnoses, then submit. You can change them until time is up.');
        var btn = el('button', 'chp-go', 'Submit');
        btn.type = 'button';
        for (var i = 0; i < v.max; i++) {
          (function (i) {
            var inp = el('input', '');
            inp.type = 'text'; inp.maxLength = v.maxLen; inp.placeholder = 'Diagnosis ' + (i + 1);
            inp.setAttribute('autocomplete', 'off'); inp.setAttribute('autocapitalize', 'sentences'); inp.setAttribute('aria-label', 'Diagnosis ' + (i + 1));
            inp.value = v.entries[i] || '';
            inp.addEventListener('input', function () { L.dirty = true; btn.textContent = L.saved ? 'Update' : 'Submit'; });
            L.inputs.push(inp);
            w.appendChild(inp);
          })(i);
        }
        btn.addEventListener('click', function () {
          var list = L.inputs.map(function (x) { return x.value; }).filter(function (s) { return s.trim(); });
          ctx.send({ a: 'submit', entries: list });
          L.dirty = false; L.saved = list.length > 0;
          status.textContent = list.length ? 'Sent. You can still edit and resubmit until time is up.' : 'Cleared. Nothing submitted yet.';
          btn.textContent = L.saved ? 'Update' : 'Submit';
        });
        L.saved = !!v.saved;
        if (L.saved) { btn.textContent = 'Update'; status.textContent = 'Sent. You can still edit and resubmit until time is up.'; }
        w.appendChild(btn);
        w.appendChild(status);
      }
      root.appendChild(w);
    }
  }

  function phoneResult(root, v, ctx) {
    var sig = 'result:' + JSON.stringify(v);
    if (!changed(root, ctx.local, sig)) return;
    var w = el('div', 'chp');
    w.appendChild(phoneTop(v, ctx, false));
    if (v.justChopped) w.appendChild(el('div', 'chp-ban', 'You were chopped. Final score ' + v.cum + '.'));
    else { var ban = statusBanner(v); if (ban) w.appendChild(ban); }
    if (v.status === 'alive') {
      w.appendChild(el('div', 'chp-big', '+' + v.stageScore));
      w.appendChild(el('div', 'chp-note', 'This stage' + (v.bonus ? ' (includes +' + v.bonus + ' for keeping a must-not-miss diagnosis)' : '') + '. Total ' + v.cum + '. You survive.'));
      v.mine.forEach(function (m) {
        var r = el('div', 'chp-row');
        r.appendChild(el('span', '', m.text));
        r.appendChild(el('b', '', m.dup ? 'duplicate' : m.name ? '+' + m.pts + (m.early ? ' (early guess)' : '') : '0'));
        w.appendChild(r);
      });
      if (!v.mine.length) w.appendChild(el('div', 'chp-note', 'You did not submit anything this stage.'));
    }
    w.appendChild(el('div', 'chp-h', 'What the room wrote'));
    v.top.forEach(function (t) {
      var r = el('div', 'chp-row');
      r.appendChild(el('span', '', t.name));
      r.appendChild(el('b', '', String(t.count)));
      w.appendChild(r);
    });
    if (v.chop && v.chop.length && !v.justChopped) w.appendChild(el('div', 'chp-note', 'Chopped this round: ' + v.chop.map(function (c) { return c.name; }).join(', ')));
    w.appendChild(el('div', 'chp-note', 'Waiting for the host to continue.'));
    root.appendChild(w);
  }

  function phoneReveal(root, v, ctx, done) {
    var sig = (done ? 'done:' : 'reveal:') + JSON.stringify([v.status, v.cum, v.rank, v.mineBest, v.champion]);
    if (!changed(root, ctx.local, sig)) return;
    var w = el('div', 'chp');
    var ban = statusBanner(v);
    if (ban) w.appendChild(ban);
    w.appendChild(el('div', 'chp-h', 'Final diagnosis'));
    w.appendChild(el('div', 'chp-big', v.diagnosis));
    if (done) {
      if (v.status === 'alive') w.appendChild(el('div', 'chp-note', (v.champion ? 'Champion! ' : '') + 'You finished #' + v.rank + ' of ' + v.survivors + ' survivors. Leaderboard points from this case: ' + v.awarded + '.'));
      else if (v.status === 'chopped') w.appendChild(el('div', 'chp-note', 'You were chopped with ' + v.cum + ' points.'));
    } else if (v.mineBest) w.appendChild(el('div', 'chp-note', 'Your best stage: ' + v.mineBest.stage + ' (' + v.mineBest.score + ' points). Total ' + v.cum + '.'));
    w.appendChild(el('div', 'chp-h', 'Teaching'));
    w.appendChild(el('p', 'chp-txt', v.teaching));
    w.appendChild(el('div', 'chp-h', 'The full differential'));
    w.appendChild(dxList(v.differential, false));
    if (done) {
      w.appendChild(el('div', 'chp-h', 'Top survivors'));
      (v.ranking || []).forEach(function (p) {
        var r = el('div', 'chp-row');
        r.appendChild(el('span', '', p.rank + '. ' + p.name));
        r.appendChild(el('b', '', String(p.score)));
        w.appendChild(r);
      });
    }
    root.appendChild(w);
  }

  ZebraAct.register('chopped', {
    css: CSS,
    renderHost: function (root, v, ctx) {
      if (v.stage === 'think') hostThink(root, v, ctx);
      else if (v.stage === 'result') hostResult(root, v, ctx);
      else if (v.stage === 'reveal') hostReveal(root, v, ctx);
      else { stopTimer(ctx.local); hostDone(root, v, ctx); }
      if (v.stage !== 'think') stopTimer(ctx.local);
    },
    renderPhone: function (root, v, ctx) {
      if (v.stage === 'think') phoneThink(root, v, ctx);
      else {
        if (ctx.local.timer) stopTimer(ctx.local);
        if (v.stage === 'result') phoneResult(root, v, ctx);
        else phoneReveal(root, v, ctx, v.stage === 'done');
      }
    },
    onAck: function (d, ctx) {
      if (d && d.ok === false && ctx && ctx.local) ctx.local.saved = false;
    }
  });
})();
