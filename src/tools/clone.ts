const clone = <T extends Object>(data: T): T => {
  return JSON.parse(JSON.stringify({w: data})).w;
};

export default clone;