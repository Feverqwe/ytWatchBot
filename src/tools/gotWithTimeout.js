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

/**
 * @template T
 * @param {T} request
 * @param lockTimeout
 * @return {T}
 */
function gotLockTimeout(request, lockTimeout = 60 * 1000) {
  let lockTimeoutFired = false;
  const timeout = setTimeout(() => {
    lockTimeoutFired = true;
    request.cancel();
  }, lockTimeout);
  return request.then(...promiseFinally(() => {
    clearTimeout(timeout);
  })).catch((err) => {
    if (err.name === 'CancelError' && lockTimeoutFired) {
      const error = new ErrorWithCode('Lock timeout fired', 'ETIMEDOUT');
      error.name = 'LockTimeoutError';
      error.original = err;
      throw error;
    }
    throw err;
  });
}

export {gotLockTimeout};
export default gotWithTimeout;