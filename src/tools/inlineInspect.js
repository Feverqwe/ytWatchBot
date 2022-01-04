import util from "util";

const inlineInspect = (obj) => {
  return util.inspect(obj).replace(/\s*\n\s*/g, ' ');
};

export default inlineInspect;