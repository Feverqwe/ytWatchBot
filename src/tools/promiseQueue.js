import promiseTry from "./promiseTry";

const itemWeakMap = new WeakMap();

class PromiseQueue {
  /**@param {number} limit*/
  constructor(limit) {
    this.limit = limit;
    this.queue = [];
    this.activeCount = 0;
  }

  /**
   * @template T
   * @param {function:T} callback
   * @return {Promise<T>}
   */
  add(callback) {
    let resolve = null;
    const promise = new Promise((_resolve) => {
      resolve = _resolve;
    });
    if (this.activeCount < this.limit) {
      this.runQueue(callback, resolve);
    } else {
      const item = [callback, resolve];
      this.queue.push(item);
      itemWeakMap.set(callback, item);
      itemWeakMap.set(promise, item);
    }
    return promise;
  }

  /**
   * @param {function|Promise} callbackOrPromise
   * @param {Error} [err]
   * @return {boolean}
   */
  remove(callbackOrPromise, err) {
    const item = itemWeakMap.get(callbackOrPromise);
    if (item && removeFromArray(this.queue, item)) {
      if (err) {
        item[1](Promise.reject(err));
      }
      return true;
    }
    return false;
  }

  runQueue(callback, resolve) {
    this.activeCount++;
    const promise = promiseTry(callback);
    resolve(promise);
    promise.then(this.finishQueue, this.finishQueue);
  }

  finishQueue = () => {
    this.activeCount--;
    if (this.queue.length > 0) {
      const [callback, resolve] = this.queue.shift();
      this.runQueue(callback, resolve);
    }
  }
}

function removeFromArray(arr, item) {
  const pos = arr.indexOf(item);
  if (pos !== -1) {
    arr.splice(pos, 1);
    return true;
  }
  return false;
}

export default PromiseQueue;