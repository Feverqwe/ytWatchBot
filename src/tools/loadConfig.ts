import fs from 'node:fs';

const loadConfig = <T extends Record<string, unknown>>(configPath: string, defaultConfig: T): T => {
  Object.keys(defaultConfig).forEach((key) => delete defaultConfig[key]);
  const config = JSON.parse(fs.readFileSync(configPath).toString());
  Object.assign(defaultConfig, config);
  return defaultConfig;
};

export default loadConfig;
