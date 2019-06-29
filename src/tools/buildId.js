const buildId = (service, id) => {
  return [service.substr(0, 2), JSON.stringify(id)].join(':');
};

export default buildId;