const fiveMin = 5 * 60 * 1000;

const roundStartInterval = (callback) => {
  const now = new Date();
  const min = now.getMinutes();
  const sec = now.getSeconds();
  const ms = now.getMilliseconds();
  let offset = ((min % 10) * 60 + sec) * 1000 + ms;
  if (offset > fiveMin) {
    offset -= fiveMin;
  }
  const intervalId = setInterval(() => {
    clearInterval(intervalId);
    callback && callback();
    callback = null;
  }, fiveMin - offset);
  return intervalId;
};

export default roundStartInterval;