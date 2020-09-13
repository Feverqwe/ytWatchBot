import promiseTry from "./promiseTry";

const getProvider = (requestDataById, keepAlive = 0) => {
  const idCacheMap = new Map();
  const inflightCache = {};

  return (id, callback) => {
    const key = `key-${id}`;

    return promiseTry(() => {
      const cache = idCacheMap.get(id);
      if (cache) {
        return cache;
      }

      if (inflightCache[key]) {
        return inflightCache[key];
      }

      return inflightCache[key] = requestDataById(id).then((result) => {
        const cache = {useCount: 0, result};
        idCacheMap.set(id, cache);
        return cache;
      }).finally(() => {
        delete inflightCache[key];
      });
    }).then((cache) => {
      cache.useCount++;
      return promiseTry(() => callback(cache.result)).finally(() => {
        cache.useCount--;
        clearTimeout(cache.timerId);
        cache.timerId = setTimeout(() => {
          if (!cache.useCount) {
            idCacheMap.delete(id);
          }
        }, keepAlive);
      });
    });
  }
};

export default getProvider;
