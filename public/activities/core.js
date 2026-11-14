/* Project Zebra activity core. Loaded by the host screen (/host) and the phone page (/play).
 * Each activity registers itself from public/activities/<type>.js. See server/activities/README.md. */
(function () {
  'use strict';
  var TYPES = ['confidence', 'connections', 'debrief', 'clueladder', 'ladder', 'chopped'];
  var defs = {};
  var cssDone = {};

  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }

  var ZebraAct = {
    rerender: null, // set by the page: re-draws the current activity (called after a script finishes loading)

    register: function (type, def) {
      defs[type] = def || {};
      if (typeof ZebraAct.rerender === 'function') { try { ZebraAct.rerender(); } catch (e) { /* page not ready */ } }
    },

    /** Draw one view into root. side is 'host' or 'phone'. base: {send, sendHost, st, players}. */
    render: function (side, root, view, base) {
      if (!root || !view || !view.type) return;
      var def = defs[view.type];
      if (!def) {
        if (!root.__loading) { root.__loading = true; root.textContent = 'Loading activity…'; }
        return;
      }
      root.__loading = false;
      if (def.css && !cssDone[view.type]) {
        cssDone[view.type] = true;
        var s = document.createElement('style');
        s.textContent = def.css;
        document.head.appendChild(s);
      }
      var st = root.__act;
      if (!st || st.type !== view.type) { clear(root); st = root.__act = { type: view.type, stage: null, local: {} }; }
      var first = st.stage !== view.stage;
      st.stage = view.stage;
      var ctx = {
        side: side,
        local: st.local,
        firstRender: first,
        send: base.send || function () {},
        sendHost: base.sendHost || function () {},
        st: base.st || null,
        players: base.players || [],
        endsAt: function (v) { return Date.now() + (Number((v || view).endsInMs) || 0); },
        clear: function () { clear(root); },
      };
      var fn = side === 'host' ? def.renderHost : def.renderPhone;
      if (typeof fn === 'function') fn(root, view, ctx);
    },

    onAck: function (type, d, base) {
      var def = defs[type];
      if (def && typeof def.onAck === 'function') def.onAck(d, { local: ((base && base.root && base.root.__act) || { local: {} }).local, send: (base && base.send) || function () {} });
    },

    /** Forget everything drawn into root (activity ended). */
    reset: function (root) {
      if (!root) return;
      clear(root);
      root.__act = null; root.__loading = false;
    },
  };

  window.ZebraAct = ZebraAct;

  // Load every known activity script. A missing file just 404s and is ignored.
  TYPES.forEach(function (t) {
    var s = document.createElement('script');
    s.src = '/activities/' + t + '.js';
    s.async = true;
    s.onerror = function () { /* not built yet */ };
    document.head.appendChild(s);
  });
})();
