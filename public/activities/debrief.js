/* Debrief Round: anonymous reflection prompt, word cloud, tag bars, moderated quotes, teaching card. */
(function () {
  'use strict';

  var CSS = [
    '.dbh{display:flex;flex-direction:column;gap:2.2rem;padding:3rem 4rem;height:100%;box-sizing:border-box;color:var(--text,#fbf1de);overflow:hidden}',
    '.dbh-top{display:flex;justify-content:space-between;align-items:baseline;gap:2rem}',
    '.dbh-theme{font-size:2rem;letter-spacing:.14em;text-transform:uppercase;color:var(--accent,#ffc23d)}',
    '.dbh-count{font-size:2.4rem;color:var(--muted,#d8c6a6)}',
    '.dbh-prompt{font-size:6rem;line-height:1.12;font-weight:700;margin:0}',
    '.dbh-prompt.sm{font-size:3.6rem}',
    '.dbh-timer{font-size:9rem;font-weight:700;color:var(--accent,#ffc23d);font-variant-numeric:tabular-nums}',
    '.dbh-hint{font-size:2.2rem;color:var(--muted,#d8c6a6)}',
    '.dbh-grid{display:grid;grid-template-columns:3fr 2fr;gap:2.4rem;flex:1;min-height:0}',
    '.dbh-col{display:flex;flex-direction:column;gap:1.8rem;min-height:0}',
    '.dbh-box{background:var(--panel,rgba(30,21,30,.8));border:2px solid var(--line,rgba(238,200,140,.3));border-radius:1.6rem;padding:1.8rem 2.2rem}',
    '.dbh-cloud{display:flex;flex-wrap:wrap;gap:.6rem 2rem;align-items:center;align-content:center;justify-content:center;flex:1;min-height:0;overflow:hidden}',
    '.dbh-cloud span{line-height:1.05;font-weight:700}',
    '.dbh-bar{display:grid;grid-template-columns:20rem 1fr 4rem;align-items:center;gap:1.2rem;font-size:2rem;margin:.7rem 0}',
    '.dbh-track{background:rgba(255,255,255,.08);border-radius:.8rem;height:2.4rem;overflow:hidden}',
    '.dbh-fill{background:var(--accent,#ffc23d);height:100%;border-radius:.8rem}',
    '.dbh-quote{font-size:2.1rem;font-style:italic;margin:.6rem 0;color:var(--text,#fbf1de)}',
    '.dbh-teach{font-size:2.2rem;line-height:1.35}',
    '.dbh-teach b{display:block;font-size:1.6rem;letter-spacing:.14em;text-transform:uppercase;color:var(--accent,#ffc23d);margin-bottom:.6rem}',
    '.dbh-h{font-size:1.6rem;letter-spacing:.14em;text-transform:uppercase;color:var(--muted,#d8c6a6);margin:0 0 .6rem}',
    '.dbh-hosthelp{font-size:1.6rem;color:var(--muted,#d8c6a6)}',
    '.dbh-hosthelp button{font:inherit;color:inherit;background:transparent;border:1px solid var(--line,#5a4458);border-radius:.6rem;padding:.2rem .8rem;cursor:pointer;margin-left:.6rem}',
    '.dbp{display:flex;flex-direction:column;gap:14px;padding:16px;box-sizing:border-box;max-width:100%;color:var(--ink,#fbf1de)}',
    '.dbp-time{font-size:14px;color:var(--ink-dim,#d8c6a6);font-variant-numeric:tabular-nums}',
    '.dbp-prompt{font-size:clamp(20px,6vw,28px);line-height:1.25;font-weight:700;margin:0;overflow-wrap:anywhere}',
    '.dbp-tags{display:flex;flex-wrap:wrap;gap:8px}',
    '.dbp-chip{min-height:48px;padding:8px 14px;border-radius:999px;border:2px solid var(--line,#5a4458);background:var(--surface,#2a1e2b);color:var(--ink,#fbf1de);font:inherit;font-size:16px;cursor:pointer;max-width:100%;text-align:left}',
    '.dbp-chip[aria-pressed="true"]{background:var(--signal,#ffb020);border-color:var(--signal,#ffb020);color:var(--signal-ink,#1b1200);font-weight:700}',
    '.dbp-in{width:100%;box-sizing:border-box;min-height:48px;padding:10px 12px;border-radius:12px;border:2px solid var(--line,#5a4458);background:var(--surface,#2a1e2b);color:var(--ink,#fbf1de);font:inherit;font-size:16px}',
    '.dbp-send{min-height:52px;border-radius:14px;border:0;background:var(--signal,#ffb020);color:var(--signal-ink,#1b1200);font:inherit;font-size:18px;font-weight:700;cursor:pointer}',
    '.dbp-send:disabled{opacity:.5}',
    '.dbp-note{font-size:14px;color:var(--ink-dim,#d8c6a6);min-height:20px}',
    '.dbp-card{background:var(--surface,#2a1e2b);border:1px solid var(--line,#5a4458);border-radius:16px;padding:16px;font-size:16px;line-height:1.45}',
    '.dbp-card b{display:block;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--signal,#ffb020);margin-bottom:6px}',
    '.dbp-big{font-size:28px;font-weight:700;color:var(--signal,#ffb020)}'
  ].join('\n');

  var COLORS = ['#ffc23d', '#7cc4ee', '#86d98a', '#f58ad4', '#b9a2ee', '#ff8a3d', '#f2e05a'];

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function fmt(ms) { var s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60); }
  function stop(local) { if (local.timer) { clearInterval(local.timer); local.timer = null; } }
  function countdown(local, node, endsAt, prefix) {
    stop(local);
    function tick() { node.textContent = (prefix || '') + fmt(endsAt - Date.now()); }
    tick();
    local.timer = setInterval(tick, 250);
  }
  function sig(view) { var c = {}; for (var k in view) if (k !== 'endsInMs') c[k] = view[k]; return JSON.stringify(c); }

  function renderHost(root, view, ctx) {
    var L = ctx.local;
    var s = sig(view);
    if (L.hsig === s && !ctx.firstRender) {
      if (view.stage === 'prompt' && L.timerNode) countdown(L, L.timerNode, ctx.endsAt(view));
      return;
    }
    L.hsig = s;
    stop(L); L.timerNode = null;
    clear(root);
    var wrap = el('div', 'dbh');
    root.appendChild(wrap);

    if (view.stage === 'prompt') {
      var top = el('div', 'dbh-top');
      top.appendChild(el('div', 'dbh-theme', 'Debrief' + (view.theme ? ' · ' + view.theme : '')));
      top.appendChild(el('div', 'dbh-count', view.responded + ' of ' + view.total + ' responded'));
      wrap.appendChild(top);
      wrap.appendChild(el('p', 'dbh-prompt', view.prompt));
      var t = el('div', 'dbh-timer');
      wrap.appendChild(t);
      wrap.appendChild(el('div', 'dbh-hint', 'Answer anonymously on your phone. Tap up to 2 chips and add a few words.'));
      L.timerNode = t;
      countdown(L, t, ctx.endsAt(view));
    } else if (view.stage === 'cloud') {
      var top2 = el('div', 'dbh-top');
      top2.appendChild(el('div', 'dbh-theme', 'Debrief' + (view.theme ? ' · ' + view.theme : '')));
      top2.appendChild(el('div', 'dbh-count', view.responded + ' responded'));
      wrap.appendChild(top2);
      wrap.appendChild(el('p', 'dbh-prompt sm', view.prompt));
      var grid = el('div', 'dbh-grid');
      var left = el('div', 'dbh-col'), right = el('div', 'dbh-col');

      var cloudBox = el('div', 'dbh-box');
      cloudBox.style.flex = '1'; cloudBox.style.display = 'flex'; cloudBox.style.flexDirection = 'column'; cloudBox.style.minHeight = '0';
      var cloud = el('div', 'dbh-cloud');
      var ws = view.words || [];
      if (!ws.length) cloud.appendChild(el('span', null, 'No written answers this time.')).style.fontSize = '2.4rem';
      var min = Infinity, max = 0;
      ws.forEach(function (w) { if (w.n < min) min = w.n; if (w.n > max) max = w.n; });
      // alphabetical order reads more naturally than frequency order in a wrapped cloud
      ws.slice().sort(function (a, b) { return a.w < b.w ? -1 : 1; }).forEach(function (w, i) {
        var sp = el('span', null, w.w);
        var f = max > min ? (w.n - min) / (max - min) : 0.5;
        sp.style.fontSize = (2.2 + f * 4.6).toFixed(2) + 'rem';
        sp.style.color = COLORS[i % COLORS.length];
        sp.title = String(w.n);
        cloud.appendChild(sp);
      });
      cloudBox.appendChild(cloud);
      left.appendChild(cloudBox);

      var bars = el('div', 'dbh-box');
      bars.appendChild(el('h3', 'dbh-h', 'What we tapped'));
      var bmax = 1;
      (view.bars || []).forEach(function (b) { if (b.count > bmax) bmax = b.count; });
      (view.bars || []).forEach(function (b) {
        var row = el('div', 'dbh-bar');
        row.appendChild(el('div', null, b.label));
        var tr = el('div', 'dbh-track'); var fl = el('div', 'dbh-fill');
        fl.style.width = (b.count / bmax * 100) + '%';
        tr.appendChild(fl); row.appendChild(tr);
        row.appendChild(el('div', null, String(b.count)));
        bars.appendChild(row);
      });
      left.appendChild(bars);

      var qs = view.quotes || [];
      if (view.quotesOn && qs.length) {
        var qb = el('div', 'dbh-box');
        qb.appendChild(el('h3', 'dbh-h', 'In your words'));
        qs.forEach(function (q) { qb.appendChild(el('div', 'dbh-quote', '“' + q.text + '”')); });
        right.appendChild(qb);
      }
      var tb = el('div', 'dbh-box dbh-teach');
      tb.appendChild(el('b', null, 'Teaching point'));
      tb.appendChild(document.createTextNode(view.teaching || ''));
      right.appendChild(tb);
      grid.appendChild(left); grid.appendChild(right);
      wrap.appendChild(grid);

      var help = el('div', 'dbh-hosthelp');
      help.appendChild(document.createTextNode('Host: '));
      var qbtn = el('button', null, view.quotesOn ? 'Hide quotes' : 'Show quotes');
      qbtn.onclick = function () { ctx.sendHost('quotes'); };
      help.appendChild(qbtn);
      qs.forEach(function (q) {
        var b = el('button', null, 'Remove quote ' + (q.i + 1));
        b.onclick = function () { ctx.sendHost('hide', { i: q.i }); };
        help.appendChild(b);
      });
      wrap.appendChild(help);
    } else {
      wrap.appendChild(el('div', 'dbh-theme', 'Debrief complete'));
      wrap.appendChild(el('p', 'dbh-prompt', view.summary || ''));
      wrap.appendChild(el('div', 'dbh-hint', (view.promptsRun || 0) + ' prompt' + (view.promptsRun === 1 ? '' : 's') + ', ' + (view.responses || 0) + ' anonymous responses. Thank you for reflecting.'));
    }
  }

  function renderPhone(root, view, ctx) {
    var L = ctx.local;
    if (view.stage === 'prompt') {
      var key = 'p|' + view.prompt;
      if (L.pkey !== key) {
        L.pkey = key;
        stop(L); clear(root);
        var sel = (view.mine && view.mine.tags ? view.mine.tags.slice() : []);
        var wrap = el('div', 'dbp');
        var time = el('div', 'dbp-time');
        wrap.appendChild(time);
        wrap.appendChild(el('p', 'dbp-prompt', view.prompt));
        var tags = el('div', 'dbp-tags');
        var chips = [];
        function paint() {
          chips.forEach(function (c, i) { c.setAttribute('aria-pressed', sel.indexOf(i) >= 0 ? 'true' : 'false'); });
        }
        (view.tags || []).forEach(function (label, i) {
          var c = el('button', 'dbp-chip', label);
          c.type = 'button';
          c.onclick = function () {
            var at = sel.indexOf(i);
            if (at >= 0) sel.splice(at, 1);
            else { if (sel.length >= (view.maxTags || 2)) sel.shift(); sel.push(i); }
            paint(); note.textContent = '';
          };
          chips.push(c); tags.appendChild(c);
        });
        wrap.appendChild(tags);
        var input = el('input', 'dbp-in');
        input.type = 'text'; input.maxLength = view.maxText || 100;
        input.placeholder = 'A few words (optional, ' + (view.maxText || 100) + ' max)';
        input.setAttribute('autocomplete', 'off'); input.setAttribute('aria-label', 'Your reflection');
        if (view.mine && view.mine.text) input.value = view.mine.text;
        wrap.appendChild(input);
        var send = el('button', 'dbp-send', view.mine ? 'Update' : 'Send');
        send.type = 'button';
        var note = el('div', 'dbp-note', view.mine ? 'Sent. You can update until time is up.' : 'Anonymous. Nobody sees who wrote what.');
        function submit() {
          if (!sel.length && !input.value.trim()) { note.textContent = 'Pick a chip or write a few words.'; return; }
          send.disabled = true;
          ctx.send({ t: 'respond', tags: sel.slice(), text: input.value });
        }
        send.onclick = submit;
        input.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } };
        wrap.appendChild(send); wrap.appendChild(note);
        root.appendChild(wrap);
        L.send = send; L.note = note;
        paint();
        L.timeNode = time;
      }
      countdown(L, L.timeNode, ctx.endsAt(view), 'Time left ');
    } else if (view.stage === 'cloud') {
      var ck = 'c|' + view.prompt + '|' + view.earned;
      if (L.pkey !== ck) {
        L.pkey = ck; stop(L); clear(root);
        var w2 = el('div', 'dbp');
        w2.appendChild(el('p', 'dbp-prompt', view.prompt));
        if (view.earned) w2.appendChild(el('div', 'dbp-big', 'Thanks, +' + view.earned));
        else w2.appendChild(el('div', 'dbp-note', 'Thanks for reading along.'));
        var card = el('div', 'dbp-card');
        card.appendChild(el('b', null, 'Teaching point'));
        card.appendChild(document.createTextNode(view.teaching || ''));
        w2.appendChild(card);
        w2.appendChild(el('div', 'dbp-note', 'Watch the screen for the word cloud.'));
        root.appendChild(w2);
      }
    } else {
      var dk = 'd|' + view.summary;
      if (L.pkey !== dk) {
        L.pkey = dk; stop(L); clear(root);
        var w3 = el('div', 'dbp');
        w3.appendChild(el('p', 'dbp-prompt', 'Debrief complete'));
        w3.appendChild(el('div', 'dbp-card', view.summary || ''));
        root.appendChild(w3);
      }
    }
  }

  function onAck(d, ctx) {
    var L = ctx.local;
    if (!L || !L.note) return;
    if (L.send) { L.send.disabled = false; L.send.textContent = 'Update'; }
    if (d && d.ok) L.note.textContent = d.earned ? 'Sent. +' + d.earned + ' points. You can update until time is up.' : 'Updated. You can update again until time is up.';
    else L.note.textContent = (d && d.error) || 'That did not go through.';
  }

  ZebraAct.register('debrief', { css: CSS, renderHost: renderHost, renderPhone: renderPhone, onAck: onAck });
})();
