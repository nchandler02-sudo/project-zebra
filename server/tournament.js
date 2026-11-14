'use strict';
/**
 * Rock Paper Scissors tournament (the on-demand break game).
 *
 * Elimination by lives. Every round the survivors are paired at random; with an odd number one player faces "Dr. Bot".
 * Each throw has a 15 s clock (it ends early once everyone in a live match has locked in). A tie is thrown again.
 * A player who does not lock in forfeits the match (both absent: coin flip). Losing a match costs one life; at zero
 * lives you are out. Rounds repeat until one player has lives left: the champion.
 *
 * Small and medium rooms get extra lives so the tournament always runs at least MIN_ROUNDS rounds (see livesFor).
 * Big rooms (16+) are plain single elimination, which is already 4+ rounds.
 *
 * Transport-agnostic. The Room owns it, calls tick(), pick() and the two view methods, and broadcasts.
 * Throws stay hidden until the reveal stage: views only expose "locked in" flags during a throw.
 */

const crypto = require('crypto');

const PICKS = ['rock', 'paper', 'scissors'];
const BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
const THROW_MS = (Number(process.env.ZEBRA_RPS_SECONDS) || 15) * 1000;
const REVEAL_MS = Number(process.env.ZEBRA_RPS_REVEAL_MS) || 4500;
const PAIR_MS = Number(process.env.ZEBRA_RPS_PAIR_MS) || 4500;
const MAX_TIES = 4; // after this many ties in a row a match is settled by coin flip
const MIN_ROUNDS = Number(process.env.ZEBRA_RPS_MIN_ROUNDS) || 4;
const MAX_LIVES = 4;
const AWARDS = { champion: 30, finalist: 15 }; // leaderboard points for the champion and the player they beat last
const BOT_NAME = 'Dr. Bot';

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const randomPick = () => PICKS[crypto.randomInt(3)];
const coin = () => (crypto.randomInt(2) ? 'a' : 'b');

/**
 * Fewest rounds a tournament of n players with L lives can possibly last (a guarantee, not an estimate).
 *  - One life: each round at least floor(alive / 2) players survive (the odd one may lose to the bot), so count the halvings.
 *  - More lives: every player but the champion must lose L times, and a round holds at most ceil(n / 2) losses; it also
 *    can never be shorter than L rounds, because one player has to lose L separate rounds.
 */
function minRounds(n, lives) {
  if (n < 2) return 0;
  if (lives <= 1) { let rounds = 0, alive = n; while (alive > 1) { alive = Math.floor(alive / 2); rounds++; } return rounds; }
  return Math.max(lives, Math.ceil(((n - 1) * lives) / Math.ceil(n / 2)));
}
/** The fewest lives that still guarantee MIN_ROUNDS rounds for n players. */
function livesFor(n) {
  for (let lives = 1; lives < MAX_LIVES; lives++) if (minRounds(n, lives) >= MIN_ROUNDS) return lives;
  return MAX_LIVES;
}

class Tournament {
  /**
   * @param {{id:number,name:string}[]} entrants
   * @param {(pid:number)=>boolean} isPresent  true while the player is still connected to the room
   * @param {(champion:number, finalist:number|null)=>void} onDone  called once when a champion is crowned
   */
  constructor(entrants, isPresent, onDone) {
    this.isPresent = isPresent;
    this.onDone = onDone;
    this.names = new Map(entrants.map((e) => [e.id, e.name]));
    this.entrants = entrants.length;
    this.maxLives = livesFor(entrants.length);
    this.lives = new Map(entrants.map((e) => [e.id, this.maxLives]));
    this.botFaced = new Map(entrants.map((e) => [e.id, 0]));
    this.alive = entrants.map((e) => e.id);
    this.out = new Map(); // pid -> round they were knocked out in
    this.matches = [];
    this.roundNo = 0;
    this.throwNo = 0;
    this.stage = 'pairing'; // pairing -> throw -> reveal -> (throw again for ties | pairing | done)
    this.endsAt = 0;
    this.stageMs = 0;
    this.champion = null;
    this.finalist = null;
    this.lastSec = -1;
    this.newRound(Date.now());
  }

  // ---------- flow ----------
  newRound(now) {
    this.roundNo += 1;
    this.throwNo = 0;
    const order = shuffle([...this.alive]);
    let botPid = null;
    if (order.length % 2 === 1) {
      // the odd one out plays Dr. Bot: whoever has faced the bot least, so it does not keep landing on the same person
      const least = Math.min(...order.map((p) => this.botFaced.get(p)));
      botPid = order.find((p) => this.botFaced.get(p) === least);
      order.splice(order.indexOf(botPid), 1);
      this.botFaced.set(botPid, this.botFaced.get(botPid) + 1);
    }
    this.matches = [];
    const add = (a, b) => this.matches.push({
      id: this.matches.length + 1,
      a: { pid: a, name: this.names.get(a) },
      b: b == null ? { pid: null, name: BOT_NAME, bot: true } : { pid: b, name: this.names.get(b) },
      picks: { a: null, b: null }, ties: 0, done: false, winner: null, how: null, last: null,
    });
    for (let i = 0; i < order.length; i += 2) add(order[i], order[i + 1]);
    if (botPid != null) add(botPid, null);
    this.stage = 'pairing';
    this.setTimer(now, PAIR_MS);
  }

  setTimer(now, ms) { this.endsAt = now + ms; this.stageMs = ms; this.lastSec = -1; }

  startThrow(now) {
    this.throwNo += 1;
    for (const m of this.matches) {
      if (m.done) continue;
      m.picks = { a: null, b: m.b.bot ? randomPick() : null };
    }
    this.stage = 'throw';
    this.setTimer(now, THROW_MS);
  }

  /** A human side is "ready" once locked in, or if they have left the room (nothing to wait for). */
  sideReady(m, side) {
    const s = m[side];
    return s.bot || m.picks[side] != null || !this.isPresent(s.pid);
  }
  allReady() { return this.matches.every((m) => m.done || (this.sideReady(m, 'a') && this.sideReady(m, 'b'))); }

  resolveThrow(now) {
    for (const m of this.matches) {
      if (m.done) continue;
      const pa = m.picks.a, pb = m.picks.b;
      if (pa && pb) {
        if (pa === pb) {
          m.ties += 1;
          m.last = { a: pa, b: pb, result: 'tie' };
          if (m.ties >= MAX_TIES) { const w = coin(); this.decide(m, w, 'coinflip'); m.last.result = w; }
        } else {
          const w = BEATS[pa] === pb ? 'a' : 'b';
          m.last = { a: pa, b: pb, result: w };
          this.decide(m, w, 'win');
        }
      } else if (pa || pb) {
        const w = pa ? 'a' : 'b'; // the player who did not lock in forfeits
        m.last = { a: pa, b: pb, result: w };
        this.decide(m, w, 'forfeit');
      } else {
        const w = coin();
        m.last = { a: null, b: null, result: w };
        this.decide(m, w, 'coinflip');
      }
    }
    this.stage = 'reveal';
    this.setTimer(now, REVEAL_MS);
  }

  /** The loser (if human) loses a life right away so the reveal can show it. */
  decide(m, side, how) {
    m.done = true; m.winner = side; m.how = how;
    const loser = m[side === 'a' ? 'b' : 'a'];
    if (loser.pid != null) {
      const left = Math.max(0, this.lives.get(loser.pid) - 1);
      this.lives.set(loser.pid, left);
      if (left === 0) this.out.set(loser.pid, this.roundNo);
    }
  }

  afterReveal(now) {
    if (this.matches.some((m) => !m.done)) { this.startThrow(now); return; } // ties: throw again
    this.alive = this.alive.filter((pid) => this.lives.get(pid) > 0);
    if (this.alive.length <= 1) {
      this.champion = this.alive[0] != null ? this.alive[0] : null;
      this.finalist = null; // the human the champion beat in the last round, if any
      const mine = this.champion != null && this.matches.find((m) => m.a.pid === this.champion || m.b.pid === this.champion);
      if (mine) { const opp = mine.a.pid === this.champion ? mine.b : mine.a; if (opp.pid != null) this.finalist = opp.pid; }
      this.stage = 'done';
      this.endsAt = 0;
      this.stageMs = 0;
      if (this.champion != null) this.onDone(this.champion, this.finalist);
      return;
    }
    this.newRound(now);
  }

  // ---------- inputs ----------
  /** Lock in a throw. Returns null (ignored), 'locked' (recorded) or 'resolved' (everyone was ready, throw resolved). */
  pick(pid, pick) {
    if (this.stage !== 'throw' || !PICKS.includes(pick)) return null;
    const m = this.matches.find((x) => !x.done && (x.a.pid === pid || x.b.pid === pid));
    if (!m) return null;
    const side = m.a.pid === pid ? 'a' : 'b';
    if (m.picks[side] != null) return null; // locked in: no changing your mind
    m.picks[side] = pick;
    if (this.allReady()) { this.resolveThrow(Date.now()); return 'resolved'; }
    return 'locked';
  }

  /** Advance on the clock. Returns true when the room should broadcast. */
  tick(now) {
    if (this.stage === 'pairing' && now >= this.endsAt) { this.startThrow(now); return true; }
    if (this.stage === 'throw') {
      if (now >= this.endsAt || this.allReady()) { this.resolveThrow(now); return true; }
      const sec = Math.ceil((this.endsAt - now) / 1000);
      if (sec !== this.lastSec) { this.lastSec = sec; return true; }
      return false;
    }
    if (this.stage === 'reveal' && now >= this.endsAt) { this.afterReveal(now); return true; }
    return false;
  }

  endsInMs() { return this.stage === 'done' ? 0 : Math.max(0, this.endsAt - Date.now()); }

  // ---------- views ----------
  /** Everything the big screen may show. Current-throw picks are never included, only who has locked in. */
  hostView() {
    const side = (s) => ({ id: s.pid, name: s.name, bot: !!s.bot, lives: s.pid != null ? this.lives.get(s.pid) : null });
    return {
      stage: this.stage,
      roundNo: this.roundNo,
      throwNo: this.throwNo,
      endsInMs: this.endsInMs(),
      stageMs: this.stageMs,
      aliveCount: this.alive.length,
      entrants: this.entrants,
      maxLives: this.maxLives,
      minRounds: MIN_ROUNDS,
      throwSeconds: THROW_MS / 1000,
      awards: AWARDS,
      matches: this.matches.map((m) => ({
        id: m.id,
        a: side(m.a), b: side(m.b),
        aLocked: m.picks.a != null && !m.done, bLocked: m.picks.b != null && !m.done && !m.b.bot,
        done: m.done, winner: m.winner, how: m.how, ties: m.ties, last: m.last,
      })),
      champion: this.champion != null ? { id: this.champion, name: this.names.get(this.champion) } : null,
      finalist: this.finalist != null ? { id: this.finalist, name: this.names.get(this.finalist) } : null,
    };
  }

  /** What one player may see: their own lock-in, and the opponent's throw only after the reveal. */
  playerView(pid) {
    const m = this.matches.find((x) => x.a.pid === pid || x.b.pid === pid);
    let role = 'spectator';
    if (pid === this.champion) role = 'champion';
    else if (this.out.has(pid)) role = 'out';
    else if (this.alive.includes(pid)) role = 'alive';
    const side = m ? (m.a.pid === pid ? 'a' : 'b') : null;
    const other = side === 'a' ? 'b' : 'a';
    let last = null;
    if (m && m.last) {
      last = { mine: m.last[side], theirs: m.last[other], result: m.last.result === 'tie' ? 'tie' : m.last.result === side ? 'win' : 'lose' };
    }
    return {
      stage: this.stage,
      roundNo: this.roundNo,
      throwNo: this.throwNo,
      endsInMs: this.endsInMs(),
      stageMs: this.stageMs,
      aliveCount: this.alive.length,
      entrants: this.entrants,
      role,
      lives: this.lives.has(pid) ? this.lives.get(pid) : 0,
      maxLives: this.maxLives,
      opponent: m ? { name: m[other].name, bot: !!m[other].bot, lives: m[other].pid != null ? this.lives.get(m[other].pid) : null } : null,
      myPick: m && side && !m.done ? m.picks[side] : null,
      matchDone: !!(m && m.done),
      won: m && m.done ? m.winner === side : null,
      how: m && m.done ? m.how : null,
      ties: m ? m.ties : 0,
      last,
      champion: this.champion != null ? this.names.get(this.champion) : null,
      finalist: this.finalist != null ? this.names.get(this.finalist) : null,
      award: pid === this.champion ? AWARDS.champion : pid === this.finalist ? AWARDS.finalist : 0,
    };
  }
}

module.exports = { Tournament, PICKS, BEATS, AWARDS, BOT_NAME, livesFor, minRounds };
