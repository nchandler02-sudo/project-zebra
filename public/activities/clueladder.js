/* Clue Ladder client: projector (renderHost) and phone (renderPhone). */
(function () {
  'use strict';

  var CSS = [
    '.cl-host{width:100%;height:100%;padding:3.2rem 5rem;display:flex;flex-direction:column;gap:2rem;color:var(--ink,#fbf1de);text-align:left}',
    '.cl-host *{box-sizing:border-box}',
    '.cl-top{display:flex;align-items:center;justify-content:space-between;gap:2rem}',
    '.cl-tag{font-size:2.4rem;color:var(--muted,#d8c6a6)}',
    '.cl-pts{font-size:2.6rem;color:var(--accent,#ffc23d)}',
    '.cl-timer{font-size:3.4rem;color:var(--accent,#ffc23d);font-variant-numeric:tabular-nums}',
    '.cl-bar{height:1rem;border-radius:1rem;background:rgba(255,255,255,.1);overflow:hidden}',
    '.cl-bar>i{display:block;height:100%;width:100%;background:var(--accent,#ffc23d);transform-origin:left}',
    '.cl-clues{display:flex;flex-direction:column;gap:1.6rem;flex:1;min-height:0;justify-content:center}',
    '.cl-clue{display:flex;gap:2rem;align-items:flex-start;font-size:3.6rem;line-height:1.2;padding:1.6rem 2.4rem;border:.2rem solid var(--line,rgba(238,200,140,.3));border-radius:1.6rem;background:var(--panel,rgba(30,21,30,.8))}',
    '.cl-clue.cl-new{border-color:var(--accent,#ffc23d);animation:clpop .5s ease-out}',
    '@keyframes clpop{from{transform:scale(.97);opacity:.2}to{transform:none;opacity:1}}',
    '.cl-clue b{flex:none;min-width:5rem;height:5rem;border-radius:50%;background:var(--accent,#ffc23d);color:var(--accent-ink,#1b1300);display:flex;align-items:center;justify-content:center;font-size:3rem}',
    '.cl-clue.cl-big{font-size:5rem}',
    '.cl-counts{display:flex;gap:4rem;font-size:3rem;color:var(--muted,#d8c6a6)}',
    '.cl-counts strong{color:var(--ink,#fbf1de);font-size:4rem;font-variant-numeric:tabular-nums}',
    '.cl-dx{font-size:7rem;color:var(--accent,#ffc23d);line-height:1.05}',
    '.cl-pearl{font-size:2.8rem;line-height:1.3;color:var(--ink,#fbf1de);border-left:.6rem solid var(--accent,#ffc23d);padding-left:2rem}',
    '.cl-cols{display:flex;gap:3rem;flex:1;min-height:0}',
    '.cl-col{flex:1;min-width:0;display:flex;flex-direction:column;gap:1rem}',
    '.cl-h{font-size:2.2rem;color:var(--muted,#d8c6a6)}',
    '.cl-small .cl-clue{font-size:2rem;padding:.8rem 1.4rem;gap:1.2rem;border-radius:1rem}',
    '.cl-small .cl-clue b{min-width:3rem;height:3rem;font-size:1.8rem}',
    '.cl-solvers{display:grid;grid-template-columns:1fr 1fr;gap:.6rem 2rem}',
    '.cl-row{display:flex;align-items:center;justify-content:space-between;gap:1rem;font-size:2.2rem}',
    '.cl-row span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.cl-rungs{display:flex;gap:.4rem;flex:none}',
    '.cl-rungs i{width:1.6rem;height:2.4rem;border-radius:.4rem;background:rgba(255,255,255,.14)}',
    '.cl-rungs i.on{background:var(--accent,#ffc23d)}',
    '.cl-wrong{font-size:2.6rem}',
    '.cl-wrong li{margin:.4rem 0}',
    '.cl-none{font-size:2.2rem;color:var(--muted,#d8c6a6)}',
    '.cl-top5{font-size:4rem;display:flex;flex-direction:column;gap:1.4rem;margin-top:1rem}',
    '.cl-top5 div{display:flex;justify-content:space-between;gap:2rem;border-bottom:.2rem solid var(--line,rgba(238,200,140,.3));padding-bottom:.8rem}',

    '.cl-ph{width:100%;max-width:560px;margin:0 auto;padding:12px 14px 24px;display:flex;flex-direction:column;gap:12px;color:var(--ink,#fbf1de);font-family:var(--font-ui,system-ui,sans-serif);text-align:left}',
    '.cl-ph *{box-sizing:border-box}',
    '.cl-ph-top{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:14px;color:var(--ink-dim,#d8c6a6)}',
    '.cl-ph-timer{font-variant-numeric:tabular-nums;font-weight:700;color:var(--signal,#ffb020);font-size:18px}',
    '.cl-ph-clue{background:var(--surface,#2a1e2b);border:1px solid var(--line,#5a4458);border-radius:14px;padding:12px 14px;font-size:17px;line-height:1.35;display:flex;gap:10px;overflow-wrap:anywhere}',
    '.cl-ph-clue b{flex:none;width:26px;height:26px;border-radius:50%;background:var(--signal,#ffb020);color:var(--signal-ink,#1b1200);display:flex;align-items:center;justify-content:center;font-size:14px}',
    '.cl-ph-clue.cl-new{border-color:var(--signal,#ffb020)}',
    '.cl-ph form{display:flex;flex-direction:column;gap:8px}',
    '.cl-ph input{width:100%;min-height:52px;font-size:18px;padding:10px 14px;border-radius:12px;border:2px solid var(--line,#5a4458);background:var(--ground-2,#1d1422);color:var(--ink,#fbf1de);font-family:inherit}',
    '.cl-ph input:focus{outline:none;border-color:var(--signal,#ffb020)}',
    '.cl-ph button{min-height:52px;font-size:18px;font-weight:700;border-radius:12px;border:0;background:var(--signal,#ffb020);color:var(--signal-ink,#1b1200);font-family:inherit;cursor:pointer}',
    '.cl-ph button:disabled{opacity:.5}',
    '.cl-ph-fb{min-height:24px;font-size:16px;color:var(--ink-dim,#d8c6a6)}',
    '.cl-ph-fb.ok{color:var(--ok,#5fd3a5);font-weight:700}',
    '.cl-ph-fb.bad{color:var(--danger,#ff8a8a)}',
    '.cl-ph-box{border:1px solid var(--line,#5a4458);background:var(--surface-2,#3a2a3a);border-radius:14px;padding:14px;font-size:17px;line-height:1.35}',
    '.cl-ph-box.good{border-color:var(--ok,#5fd3a5)}',
    '.cl-ph-dx{font-size:26px;font-weight:700;color:var(--signal,#ffb020);overflow-wrap:anywhere}',
    '.cl-ph-rank{font-size:40px;font-weight:700;color:var(--signal,#ffb020)}',
    '.cl-ph-top5 div{display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid var(--line,#5a4458)}',
  ].join('\n');

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function clearTimer(local) {
    if (local.timer) { clearInterval(local.timer); local.timer = null; }
  }
  function secs(ms) { return Math.max(0, Math.ceil(ms / 1000)); }
  function pts(view, i) { return (view.points && view.points[i]) || 0; }

  /** Start a 250 ms timer that writes the countdown into local.timerEl and shrinks local.barEl. */
  function startTimer(local, total) {
    clearTimer(local);
    var tick = function () {
      var left = local.endsAt - Date.now();
      if (local.timerEl) local.timerEl.textContent = secs(left) + 's';
      if (local.barEl && total) local.barEl.style.transform = 'scaleX(' + Math.max(0, Math.min(1, left / total)) + ')';
    };
    tick();
    local.timer = setInterval(tick, 250);
  }

  /** Append any clues not yet shown to listEl. mk(text, n, isNew) builds one row. */
  function syncClues(local, listEl, clues, mk) {
    var shown = local.shown || 0;
    for (var i = shown; i < clues.length; i++) listEl.appendChild(mk(clues[i], i, shown > 0 || i > 0));
    var kids = listEl.children;
    for (var k = 0; k < kids.length; k++) if (k < clues.length - 1) kids[k].classList.remove('cl-new');
    local.shown = clues.length;
  }

  // ---------------- projector ----------------
  function hostPlay(root, view, ctx) {
    var L = ctx.local;
    var key = 'play:' + view.caseNo;
    if (L.key !== key) {
      clearTimer(L);
      ctx.clear();
      L.key = key; L.shown = 0;
      var wrap = el('div', 'cl-host');
      var top = el('div', 'cl-top');
      L.tagEl = el('div', 'cl-tag disp');
      L.ptsEl = el('div', 'cl-pts disp');
      L.timerEl = el('div', 'cl-timer disp');
      top.appendChild(L.tagEl); top.appendChild(L.ptsEl); top.appendChild(L.timerEl);
      var bar = el('div', 'cl-bar'); L.barEl = el('i'); bar.appendChild(L.barEl);
      L.listEl = el('div', 'cl-clues');
      var counts = el('div', 'cl-counts');
      var a = el('div'); a.appendChild(document.createTextNode('Solved ')); L.solvedEl = el('strong'); a.appendChild(L.solvedEl);
      var b = el('div'); b.appendChild(document.createTextNode('Still guessing ')); L.guessEl = el('strong'); b.appendChild(L.guessEl);
      counts.appendChild(a); counts.appendChild(b);
      wrap.appendChild(top); wrap.appendChild(bar); wrap.appendChild(L.listEl); wrap.appendChild(counts);
      root.appendChild(wrap);
    }
    L.tagEl.textContent = 'Case ' + view.caseNo + ' of ' + view.total;
    L.ptsEl.textContent = 'Worth ' + pts(view, view.clueIndex) + ' pts';
    L.endsAt = ctx.endsAt(view);
    var total = L.total && L.lastIdx === view.clueIndex ? L.total : view.endsInMs;
    L.total = total; L.lastIdx = view.clueIndex;
    startTimerOnce(L, total, view.clueIndex);
    L.solvedEl.textContent = view.solved;
    L.guessEl.textContent = view.guessing;
    syncClues(L, L.listEl, view.clues, function (text, i, isNew) {
      var row = el('div', 'cl-clue' + (isNew ? ' cl-new' : '') + (view.clues.length <= 2 ? ' cl-big' : ''));
      row.appendChild(el('b', 'disp', String(i + 1)));
      row.appendChild(el('span', null, text));
      return row;
    });
    if (view.clues.length > 2) for (var k = 0; k < L.listEl.children.length; k++) L.listEl.children[k].classList.remove('cl-big');
  }

  // Restart the interval only when the clue index changes, so the bar resets smoothly.
  function startTimerOnce(L, total, idx) {
    if (L.timerFor !== idx || !L.timer) { L.timerFor = idx; startTimer(L, total); }
  }

  function ladder(clue) {
    var r = el('div', 'cl-rungs');
    for (var i = 0; i < 4; i++) r.appendChild(el('i', i === clue ? 'on' : (i < clue ? 'on' : '')));
    return r;
  }

  function hostReveal(root, view, ctx) {
    var L = ctx.local;
    var key = 'reveal:' + view.caseNo;
    if (L.key === key) { L.endsAt = ctx.endsAt(view); return; }
    clearTimer(L);
    ctx.clear();
    L.key = key; L.timerFor = null; L.total = 0; L.shown = 0;
    L.endsAt = ctx.endsAt(view);
    var wrap = el('div', 'cl-host');
    var top = el('div', 'cl-top');
    top.appendChild(el('div', 'cl-tag disp', 'Case ' + view.caseNo + ' of ' + view.total));
    L.timerEl = el('div', 'cl-timer disp');
    top.appendChild(L.timerEl);
    wrap.appendChild(top);
    wrap.appendChild(el('div', 'cl-dx disp', view.diagnosis));
    if (view.teaching) wrap.appendChild(el('div', 'cl-pearl', view.teaching));
    var cols = el('div', 'cl-cols');
    var c1 = el('div', 'cl-col cl-small');
    view.clues.forEach(function (t, i) {
      var row = el('div', 'cl-clue');
      row.appendChild(el('b', 'disp', String(i + 1)));
      row.appendChild(el('span', null, t));
      c1.appendChild(row);
    });
    var c2 = el('div', 'cl-col');
    c2.appendChild(el('div', 'cl-h disp', 'Solved it'));
    if (!view.solvers.length) c2.appendChild(el('div', 'cl-none', 'Nobody got this one.'));
    else {
      var g = el('div', 'cl-solvers');
      view.solvers.forEach(function (s) {
        var row = el('div', 'cl-row');
        row.appendChild(el('span', null, s.name));
        row.appendChild(ladder(s.clue));
        g.appendChild(row);
      });
      c2.appendChild(g);
      if (view.moreSolvers) c2.appendChild(el('div', 'cl-none', '+' + view.moreSolvers + ' more'));
    }
    c2.appendChild(el('div', 'cl-h disp', 'Most common wrong guesses'));
    if (!view.commonWrong.length) c2.appendChild(el('div', 'cl-none', 'No repeated wrong answers.'));
    else {
      var ul = el('ul', 'cl-wrong');
      view.commonWrong.forEach(function (w) { ul.appendChild(el('li', null, w.guess + '  x' + w.count)); });
      c2.appendChild(ul);
    }
    cols.appendChild(c1); cols.appendChild(c2);
    wrap.appendChild(cols);
    root.appendChild(wrap);
    L.barEl = null;
    clearTimer(L);
    L.timer = setInterval(function () {
      if (L.timerEl) L.timerEl.textContent = (view.lastCase ? 'Results in ' : 'Next case in ') + secs(L.endsAt - Date.now()) + 's';
    }, 250);
    L.timerEl.textContent = (view.lastCase ? 'Results in ' : 'Next case in ') + secs(L.endsAt - Date.now()) + 's';
  }

  function hostDone(root, view, ctx) {
    var L = ctx.local;
    if (L.key === 'done') return;
    clearTimer(L);
    ctx.clear();
    L.key = 'done';
    var wrap = el('div', 'cl-host');
    wrap.appendChild(el('div', 'cl-dx disp', 'Clue Ladder results'));
    var t = el('div', 'cl-top5');
    if (!view.top.length) t.appendChild(el('div', null, 'No points this time.'));
    view.top.forEach(function (r, i) {
      var d = el('div');
      d.appendChild(el('span', null, (i + 1) + '. ' + r.name));
      d.appendChild(el('span', 'num', r.score + ' pts'));
      t.appendChild(d);
    });
    wrap.appendChild(t);
    root.appendChild(wrap);
  }

  // ---------------- phone ----------------
  function phonePlay(root, view, ctx) {
    var L = ctx.local;
    var key = 'play:' + view.caseNo;
    if (L.key !== key) {
      clearTimer(L);
      ctx.clear();
      L.key = key; L.shown = 0; L.timerFor = null;
      var wrap = el('div', 'cl-ph');
      var top = el('div', 'cl-ph-top');
      L.tagEl = el('span');
      L.timerEl = el('span', 'cl-ph-timer');
      top.appendChild(L.tagEl); top.appendChild(L.timerEl);
      L.listEl = el('div');
      L.listEl.style.cssText = 'display:flex;flex-direction:column;gap:8px';
      L.form = el('form');
      L.input = el('input');
      L.input.type = 'text'; L.input.maxLength = 80; L.input.autocomplete = 'off';
      L.input.setAttribute('autocapitalize', 'off'); L.input.setAttribute('autocorrect', 'off');
      L.input.setAttribute('aria-label', 'Your diagnosis');
      L.input.placeholder = 'Type the diagnosis';
      L.btn = el('button', null, 'Guess');
      L.btn.type = 'submit';
      L.form.appendChild(L.input); L.form.appendChild(L.btn);
      L.form.addEventListener('submit', function (e) {
        e.preventDefault();
        var v = L.input.value.trim();
        if (!v || L.busy) return;
        L.sentText = v;
        ctx.send({ k: 'guess', text: v });
      });
      L.fb = el('div', 'cl-ph-fb');
      L.fb.setAttribute('aria-live', 'polite');
      L.status = el('div', 'cl-ph-box');
      wrap.appendChild(top); wrap.appendChild(L.listEl); wrap.appendChild(L.form); wrap.appendChild(L.fb); wrap.appendChild(L.status);
      root.appendChild(wrap);
    }
    L.tagEl.textContent = 'Case ' + view.caseNo + '/' + view.total + '  -  ' + pts(view, view.clueIndex) + ' pts now';
    L.endsAt = ctx.endsAt(view);
    if (L.timerFor !== view.clueIndex || !L.timer) { L.timerFor = view.clueIndex; L.barEl = null; startTimer(L, 0); }
    syncClues(L, L.listEl, view.clues, function (text, i, isNew) {
      var row = el('div', 'cl-ph-clue' + (isNew ? ' cl-new' : ''));
      row.appendChild(el('b', null, String(i + 1)));
      row.appendChild(el('span', null, text));
      return row;
    });
    var playing = view.status === 'guessing';
    L.form.style.display = playing ? '' : 'none';
    L.status.style.display = playing ? 'none' : '';
    if (view.status === 'solved') {
      L.status.className = 'cl-ph-box good';
      L.status.textContent = 'Solved at clue ' + view.solvedClue + ' for ' + view.solvedPts + ' points. Watch the rest of the ladder.';
    } else if (view.status === 'out') {
      L.status.className = 'cl-ph-box';
      L.status.textContent = 'Out of guesses for this case. Watch for the answer.';
    }
    if (!playing) L.fb.textContent = '';
    else if (!L.fb.textContent) L.fb.textContent = view.guessesLeft + ' guesses left';
  }

  function phoneReveal(root, view, ctx) {
    var L = ctx.local;
    var key = 'reveal:' + view.caseNo;
    if (L.key === key) return;
    clearTimer(L);
    ctx.clear();
    L.key = key; L.timerFor = null;
    var wrap = el('div', 'cl-ph');
    wrap.appendChild(el('div', 'cl-ph-top', 'Case ' + view.caseNo + '/' + view.total + ' answer'));
    wrap.appendChild(el('div', 'cl-ph-dx', view.diagnosis));
    var res = el('div', 'cl-ph-box' + (view.status === 'solved' ? ' good' : ''));
    res.textContent = view.status === 'solved'
      ? 'You got it at clue ' + view.solvedClue + ': +' + view.solvedPts + ' points.'
      : (view.status === 'out' ? 'You ran out of guesses. No points this case.' : 'Not solved. No points this case.');
    wrap.appendChild(res);
    if (view.teaching) wrap.appendChild(el('div', 'cl-ph-box', view.teaching));
    wrap.appendChild(el('div', 'cl-ph-top', view.lastCase ? 'Final results next.' : 'Next case starts soon.'));
    root.appendChild(wrap);
  }

  function phoneDone(root, view, ctx) {
    var L = ctx.local;
    if (L.key === 'done:' + view.rank + ':' + view.myScore) return;
    clearTimer(L);
    ctx.clear();
    L.key = 'done:' + view.rank + ':' + view.myScore;
    var wrap = el('div', 'cl-ph');
    wrap.appendChild(el('div', 'cl-ph-top', 'Clue Ladder finished'));
    wrap.appendChild(el('div', 'cl-ph-rank', view.rank ? '#' + view.rank : 'No points'));
    wrap.appendChild(el('div', 'cl-ph-top', view.myScore + ' points this run' + (view.rank ? ' (rank ' + view.rank + ' of ' + view.ranked + ')' : '')));
    var box = el('div', 'cl-ph-box cl-ph-top5');
    box.appendChild(el('div', null, 'Top 5'));
    view.top.forEach(function (r, i) {
      var d = el('div');
      d.appendChild(el('span', null, (i + 1) + '. ' + r.name));
      d.appendChild(el('span', null, String(r.score)));
      box.appendChild(d);
    });
    wrap.appendChild(box);
    root.appendChild(wrap);
  }

  ZebraAct.register('clueladder', {
    css: CSS,
    renderHost: function (root, view, ctx) {
      if (view.stage === 'play') hostPlay(root, view, ctx);
      else if (view.stage === 'reveal') hostReveal(root, view, ctx);
      else if (view.stage === 'done') { hostDone(root, view, ctx); }
    },
    renderPhone: function (root, view, ctx) {
      if (view.stage === 'play') phonePlay(root, view, ctx);
      else if (view.stage === 'reveal') phoneReveal(root, view, ctx);
      else if (view.stage === 'done') phoneDone(root, view, ctx);
    },
    onAck: function (d, ctx) {
      var L = ctx.local;
      if (!L || !L.fb || !d) return;
      L.fb.textContent = d.msg || '';
      L.fb.className = 'cl-ph-fb ' + (d.correct ? 'ok' : 'bad');
      if (d.ok && L.input && !d.ambiguous) L.input.value = '';
      if (d.ok && d.correct && L.form) L.form.style.display = 'none';
    },
  });
})();
