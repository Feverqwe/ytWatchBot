import promiseFinally from "./promiseFinally";
import promiseTry from "./promiseTry";

const getInProgress = () => {
  let isInProgress = false;
  return (callback) => {
    if (isInProgress) return Promise.resolve();
    isInProgress = true;
    return promiseTry(callback).finally(() => {
      isInProgress = false;
    });
  };
};

export default getInProgress;