import promiseFinally from "./promiseFinally";
import ErrorWithCode from "./errorWithCode";

const aliases = ['get', 'post', 'put', 'patch', 'head', 'delete'];

const got = require('got');

const gotWithTimeout = (url, options) => {
  return gotLockTimeout(got(url, options));
};

for (const method of aliases) {
  gotWithTimeout[method] = (url, options) => gotWithTimeout(url, {...options, method});
}

function gotLockTimeout(request) {
  let lockTimeoutFired = false;
  const timeout = setTimeout(() => {
    lockTimeoutFired = true;
    request.cancel();
  }, 60 * 1000);
  return request.then(...promiseFinally(() => {
    clearTimeout(timeout);
  })).catch((err) => {
    if (err.name === 'CancelError' && lockTimeoutFired) {
      const err = new ErrorWithCode('Lock timeout fired', 'ETIMEDOUT');
      err.name = 'LockTimeoutError';
      throw err;
    }
    throw err;
  });
}

export default gotWithTimeout;