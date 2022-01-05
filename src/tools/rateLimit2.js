class RateLimit2 {
    constructor(limit, interval = 1000) {
        this.limit = limit;
        this.interval = interval;
        this.queue = [];
        this.timeArr = [];
        this.countArr = [];
        this.lastTimeoutId = null;
        this.cleanCount = this.interval * 2;
    }

    callQueue() {
        const now = Date.now();
        const {count, lastIndex} = this.getAvailableCount(now);
        if (count > 0) {
            if (this.timeArr[0] !== now) {
                const len = this.timeArr.unshift(now);
                this.countArr.unshift(0);
                if (len > this.cleanCount) {
                    this.timeArr.splice(this.interval);
                    this.countArr.splice(this.interval);
                }
            }
            const fns = this.queue.splice(0, count);
            this.countArr[0] += fns.length;
            fns.forEach(cb => cb());
        }
        if (this.queue.length) {
            const delay = this.interval - (now - this.timeArr[lastIndex]);
            if (this.lastTimeoutId !== null) {
                clearTimeout(this.lastTimeoutId);
            }
            this.lastTimeoutId = setTimeout(() => {
                this.lastTimeoutId = null;
                this.callQueue();
            }, delay);
        }
    }

    getAvailableCount(now) {
        const end = now - this.interval;
        let count = 0;
        let lastIndex = 0;
        for (let i = 0, len = this.timeArr.length; i < len; i++) {
            const time = this.timeArr[i];
            if (time < end)
                break;
            count += this.countArr[i];
            lastIndex = i;
        }
        return {count: this.limit - count, lastIndex};
    }

    wrap(fn) {
        return (...args) => {
            return new Promise((resolve, reject) => {
                this.queue.push(() => {
                    try {
                        resolve(fn.apply(null, args));
                    } catch (err) {
                        reject(err);
                    }
                });
                if (this.lastTimeoutId === null) {
                    this.callQueue();
                }
            });
        };
    }
}

export default RateLimit2;