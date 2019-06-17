class Daemon {
  constructor(/**Main*/main) {
    this.main = main;

    this.initTimeoutId = null;
    this.timeoutId = null;
    this.intervalId = null;
  }

  onTimer() {
    this.main.emit('check');
  }

  start() {
    const interval = this.main.config.interval;

    this.timeoutId = setTimeout(() => {
      this.intervalId = setInterval(() => {
        this.onTimer();
      }, interval * 60 * 1000);

      this.onTimer();
    }, getRunTime(interval));

    if (this.main.config.checkOnRun) {
      this.initTimeoutId = setTimeout(() => {
        this.onTimer();
      }, 1000);
    }
  }

  stop() {
    clearInterval(this.initTimeoutId);
    clearInterval(this.timeoutId);
    clearInterval(this.intervalId);
  }
}

function getRunTime(interval) {
  const everyMs = interval * 60 * 1000;
  const today = new Date();
  const ms = today.getMilliseconds();
  const sec = today.getSeconds();
  const min = today.getMinutes();
  const hours = today.getHours();

  const nowMs = hours * 60 * 60 * 1000 + min * 60 * 1000 + sec * 1000 + ms;

  const waitMs = everyMs - nowMs % everyMs;

  return waitMs;
}

export default Daemon;