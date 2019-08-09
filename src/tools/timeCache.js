const QuickLRU = require('quick-lru');

class TimeCache extends QuickLRU {
  constructor(options) {
    super(options);
    this.ttl = options.ttl;
  }

  get(key) {
    let result = super.get(key);
    if (result && result.expiresAt < Date.now()) {
      this.delete(key);
      result = undefined;
    }
    return result && result.data;
  }

  set(key, value) {
    return super.set(key, {
      data: value,
      expiresAt: Date.now() + this.ttl
    });
  }
}

export default TimeCache;