import fs from "fs";

const loadConfig = (configPath, defaultConfig) => {
  Object.keys(defaultConfig).forEach(key => delete defaultConfig[key]);
  const config = JSON.parse(fs.readFileSync(configPath).toString());
  Object.assign(defaultConfig, config);
};

export default loadConfig;