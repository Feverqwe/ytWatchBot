import promiseTry from "./promiseTry";

/**
 * @param {function} finallyFn
 * @return {(function():Promise)[]}
 */
const promiseFinally = (finallyFn) => {
  return [
    result => promiseTry(finallyFn).then(() => result),
    err => promiseTry(finallyFn).then(() => {throw err}),
  ];
};

export default promiseFinally;