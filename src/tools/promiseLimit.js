import PromiseQueue from "./promiseQueue";

/**
 * @param {number} limit
 * @return {PromiseLimitCallback}
 */
const promiseLimit = (limit) => {
  const queue = new PromiseQueue(limit);
  /**
   * @callback PromiseLimitCallback
   * @template T
   * @param {function:T} callback
   * @return {Promise<T>}
   */
  return (callback) => {
    return queue.add(callback);
  };
};

export default promiseLimit;