// Надёжный упорядоченный канал между двумя игроками через публичные MQTT-брокеры.
// Подключаемся ко всем доступным брокерам сразу и шлём через все: дубликаты отсекаются по номеру сообщения.
// Неподтверждённые сообщения переотправляются, состояние канала сохраняется и переживает перезагрузку страницы.
import { Mqtt, BROKERS } from './mqtt.js';

const PREFIX = 'srazhenie-v1';
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function randomCode(n = 5) {
  const b = crypto.getRandomValues(new Uint8Array(n));
  return [...b].map(x => ALPHABET[x % ALPHABET.length]).join('');
}

export function randomHex(bytes = 16) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
}

export function normalizeCode(s) {
  return (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/O/g, '0').slice(0, 8);
}

export class Channel {
  // st: { room, role: 'host'|'guest', token, peer, nextSeq, inSeq, out: [{s, m}] }
  constructor(st, { onmessage, onstatus }) {
    this.st = st;
    this.onmessage = onmessage; // (payload)
    this.onstatus = onstatus; // ({ brokers, peerOnline, error })
    this.buffer = new Map();
    this.peerSeen = 0;
    this.conns = [];
    this.error = null;
  }

  static fresh(room, role) {
    return { room, role, token: randomHex(8), peer: null, nextSeq: 0, inSeq: 0, out: [] };
  }

  get myTopic() { return `${PREFIX}/${this.st.room}/${this.st.role === 'host' ? 'h' : 'g'}`; }
  get peerTopic() { return `${PREFIX}/${this.st.room}/${this.st.role === 'host' ? 'g' : 'h'}`; }

  async start() {
    const tries = BROKERS.map(async url => {
      const c = new Mqtt(url, 'sr-' + randomHex(6));
      c.onmessage = (topic, text) => this._rx(text);
      c.onstate = () => { this._status(); if (c.up) this._flush(); };
      c.subscribe(this.peerTopic);
      try {
        await c.connect();
        this.conns.push(c);
        this._status();
        this._flush();
        this._raw({ p: 1 });
        return true;
      } catch (e) {
        c.close();
        return false;
      }
    });
    const ok = await Promise.all(tries);
    if (!ok.some(Boolean)) {
      this.error = 'Не удалось подключиться к серверу связи';
      this._status();
      throw new Error(this.error);
    }
    this._timer = setInterval(() => this._tick(), 2000);
    this._vis = () => { if (!document.hidden) { this.conns.forEach(c => c.kick()); this._tick(); } };
    document.addEventListener('visibilitychange', this._vis);
    window.addEventListener('online', this._vis);
  }

  stop() {
    clearInterval(this._timer);
    document.removeEventListener('visibilitychange', this._vis);
    window.removeEventListener('online', this._vis);
    this.conns.forEach(c => c.close());
    this.conns = [];
  }

  get connected() { return this.conns.some(c => c.up); }
  get peerOnline() { return Date.now() - this.peerSeen < 12000; }

  send(m) {
    const s = ++this.st.nextSeq;
    this.st.out.push({ s, m });
    this._raw({ s, m });
  }

  _raw(obj) {
    obj.f = this.st.token;
    if (this.st.peer) obj.to = this.st.peer;
    const text = JSON.stringify(obj);
    for (const c of this.conns) c.publish(this.myTopic, text);
  }

  _flush() {
    for (const x of this.st.out) this._raw({ s: x.s, m: x.m });
  }

  _tick() {
    this._raw({ p: 1, a: this.st.inSeq });
    if (this.st.out.length) this._flush();
    this._status();
  }

  _status() {
    if (this.onstatus) this.onstatus({ connected: this.connected, peerOnline: this.peerOnline, error: this.error });
  }

  _rx(text) {
    let o;
    try { o = JSON.parse(text); } catch (e) { return; }
    if (!o || typeof o.f !== 'string' || o.f === this.st.token) return;
    if (o.to && o.to !== this.st.token) {
      return; // сообщение другому участнику комнаты
    }
    if (this.st.peer && o.f !== this.st.peer) {
      // Посторонний в комнате: хозяин сообщает, что место занято.
      if (this.st.role === 'host' && o.s) this._rawTo(o.f, { full: 1 });
      return;
    }
    if (o.full) {
      this.error = 'В этой партии уже два игрока';
      this._status();
      return;
    }
    if (!this.st.peer) {
      // Гость закрепляется за первым откликнувшимся хозяином, хозяин — за первым гостем с сообщением join.
      if (this.st.role === 'host' && !(o.m && o.m.t === 'join')) return;
      this.st.peer = o.f;
    }
    this.peerSeen = Date.now();
    if (typeof o.a === 'number') this.st.out = this.st.out.filter(x => x.s > o.a);
    if (typeof o.s === 'number') {
      if (o.s > this.st.inSeq) this.buffer.set(o.s, o.m);
      while (this.buffer.has(this.st.inSeq + 1)) {
        const m = this.buffer.get(this.st.inSeq + 1);
        this.buffer.delete(this.st.inSeq + 1);
        this.st.inSeq++;
        this.onmessage(m);
      }
      this._raw({ a: this.st.inSeq });
    }
    this._status();
  }

  _rawTo(token, obj) {
    obj.f = this.st.token;
    obj.to = token;
    const text = JSON.stringify(obj);
    for (const c of this.conns) c.publish(this.myTopic, text);
  }
}

export async function sha256(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join('');
}
