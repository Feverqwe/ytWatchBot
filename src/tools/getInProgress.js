const getInProgress = () => {
  let isInProgress = false;
  return (callback) => {
    if (isInProgress) return Promise.resolve();
    isInProgress = true;
    return Promise.try(callback).finally(() => {
      isInProgress = false;
    });
  };
};

export default getInProgress;