/* كاش بسيط مع TTL — يقلل الطلبات للمصدر ويتجنب الـ rate-limiting */
export class Cache {
  constructor(ttl = 300) {
    this.ttl = ttl * 1000;
    this.map = new Map();
  }
  get(key) {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (Date.now() > e.exp) { this.map.delete(key); return undefined; }
    return e.val;
  }
  set(key, val, ttl) {
    const ms = (ttl || this.ttl) * 1000;
    this.map.set(key, { val, exp: Date.now() + ms });
  }
  has(key) {
    return this.get(key) !== undefined;
  }
}
