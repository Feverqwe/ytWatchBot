import {inspect} from 'node:util';

const inlineInspect = (obj: object) => {
  return inspect(obj).replace(/\s*\n\s*/g, ' ');
};

export default inlineInspect;
