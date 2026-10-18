// Минимальный клиент MQTT 3.1.1 поверх WebSocket (QoS 0): connect, subscribe, publish, ping.
// Публичные брокеры служат ретранслятором сообщений между двумя браузерами.

export const BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
];

const enc = new TextEncoder(), dec = new TextDecoder();

function str(s) {
  const b = enc.encode(s);
  return [b.length >> 8, b.length & 255, ...b];
}

function packet(type, body) {
  const len = [];
  let n = body.length;
  do {
    let byte = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) byte |= 128;
    len.push(byte);
  } while (n > 0);
  return new Uint8Array([type, ...len, ...body]);
}

export class Mqtt {
  constructor(url, clientId) {
    this.url = url;
    this.clientId = clientId;
    this.onmessage = null; // (topic, string)
    this.onstate = null; // ('up'|'down')
    this.subs = new Set();
    this.up = false;
    this.closed = false;
    this.buf = new Uint8Array(0);
    this.pid = 1;
  }

  // Разрешается после первого успешного подключения; потом переподключается сам.
  connect(timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      this._first = { resolve, reject };
      this._timer = setTimeout(() => {
        if (this._first) { this._first.reject(new Error('timeout')); this._first = null; this.close(); }
      }, timeoutMs);
      this._open();
    });
  }

  _open() {
    if (this.closed) return;
    let ws;
    try {
      ws = new WebSocket(this.url, ['mqtt']);
    } catch (e) {
      this._fail(e);
      return;
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      const body = [...str('MQTT'), 4, 0x02, 0, 30, ...str(this.clientId)];
      ws.send(packet(0x10, body));
    };
    ws.onmessage = e => this._data(new Uint8Array(e.data));
    ws.onclose = () => this._down();
    ws.onerror = () => {};
  }

  _fail(e) {
    if (this._first) { clearTimeout(this._timer); this._first.reject(e); this._first = null; }
  }

  _down() {
    const was = this.up;
    this.up = false;
    clearInterval(this._ping);
    this.buf = new Uint8Array(0);
    if (was && this.onstate) this.onstate('down');
    if (this._first) { this._fail(new Error('connection failed')); return; }
    if (!this.closed) setTimeout(() => this._open(), 1500);
  }

  _data(chunk) {
    this.lastRx = Date.now();
    const b = new Uint8Array(this.buf.length + chunk.length);
    b.set(this.buf);
    b.set(chunk, this.buf.length);
    this.buf = b;
    for (;;) {
      if (this.buf.length < 2) return;
      let len = 0, mul = 1, k = 1, byte;
      do {
        if (k >= this.buf.length) return;
        byte = this.buf[k++];
        len += (byte & 127) * mul;
        mul *= 128;
      } while (byte & 128);
      if (this.buf.length < k + len) return;
      const type = this.buf[0], body = this.buf.subarray(k, k + len);
      this._packet(type, body);
      this.buf = this.buf.slice(k + len);
    }
  }

  _packet(type, body) {
    const t = type >> 4;
    if (t === 2) { // CONNACK
      if (body[1] !== 0) { this._fail(new Error('connack ' + body[1])); this.ws.close(); return; }
      this.up = true;
      for (const s of this.subs) this._sub(s);
      this.lastRx = Date.now();
      this._ping = setInterval(() => {
        // Нет ответа на пинги — соединение «повисло» (например, после сна телефона).
        if (Date.now() - this.lastRx > 40000) { try { this.ws.close(); } catch (e) { /* ignore */ } return; }
        this._send(new Uint8Array([0xC0, 0]));
      }, 15000);
      if (this._first) { clearTimeout(this._timer); this._first.resolve(); this._first = null; }
      if (this.onstate) this.onstate('up');
    } else if (t === 3) { // PUBLISH
      const tl = (body[0] << 8) | body[1];
      const topic = dec.decode(body.subarray(2, 2 + tl));
      let off = 2 + tl;
      if ((type >> 1) & 3) off += 2;
      if (this.onmessage) this.onmessage(topic, dec.decode(body.subarray(off)));
    }
  }

  _send(bytes) {
    if (this.ws && this.ws.readyState === 1) { this.ws.send(bytes); return true; }
    return false;
  }

  _sub(topic) {
    const id = this.pid = (this.pid % 65535) + 1;
    this._send(packet(0x82, [id >> 8, id & 255, ...str(topic), 0]));
  }

  subscribe(topic) {
    this.subs.add(topic);
    if (this.up) this._sub(topic);
  }

  publish(topic, text) {
    if (!this.up) return false;
    return this._send(packet(0x30, [...str(topic), ...enc.encode(text)]));
  }

  // Принудительно переподключиться (например, после возврата вкладки из фона).
  kick() {
    if (this.closed) return;
    if (!this.ws || this.ws.readyState > 1) this._open();
  }

  close() {
    this.closed = true;
    clearInterval(this._ping);
    if (this.ws) { try { this._send(new Uint8Array([0xE0, 0])); this.ws.close(); } catch (e) { /* ignore */ } }
  }
}
