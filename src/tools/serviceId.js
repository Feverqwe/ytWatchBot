const serviceId = {};
serviceId.wrap = (service, id) => {
  return [service.id.substring(0, 2), JSON.stringify(id)].join(':');
};
serviceId.unwrap = (sid) => {
  return JSON.parse(sid.substring(3));
};

export default serviceId;