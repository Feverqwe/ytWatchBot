const serviceId = {
  wrap(service: {id: string}, id: string) {
    return [service.id.substring(0, 2), JSON.stringify(id)].join(':');
  },
  unwrap(sid: string): string {
    return JSON.parse(sid.substring(3));
  }
};

export default serviceId;