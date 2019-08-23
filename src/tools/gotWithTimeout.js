const timeout = 60 * 1001;

const aliases = ['get', 'post', 'put', 'patch', 'head', 'delete'];

const got = require('got').extend({
  timeout: timeout
});

const gotWithTimeout = (url, options) => {
  return got(url, options).catch((err) => {
    if (err.name === 'TimeoutError' && err.gotOptions.timeout === timeout) {
      err.name = 'LockTimeoutError';
    }
    throw err;
  });
};

for (const method of aliases) {
  gotWithTimeout[method] = (url, options) => gotWithTimeout(url, {...options, method});
}

export default gotWithTimeout;