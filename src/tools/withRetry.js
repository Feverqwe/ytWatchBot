async function withRetry(count, callback, ...errorHandlers) {
  if (typeof count !== 'number') {
    errorHandlers.unshift(callback);
    callback = count;
    count = 3;
  }
  let lastError = null;
  for (let i = 0; i < count; i++) {
    try {
      return await callback();
    } catch (err) {
      lastError = err;
      if (errorHandlers.some(handle => handle(err))) {
        break;
      }
    }
  }
  throw lastError;
}

export default withRetry;