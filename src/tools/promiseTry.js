/**
 * @param {function} callback
 * @return {Promise}
 */
const promiseTry = (callback) => {
  return new Promise(r => r(callback()));
};

export default promiseTry;