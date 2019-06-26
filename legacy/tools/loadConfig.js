const loadConfig = function () {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json')));
  if (config.botName) {
    config.botName = config.botName.toLowerCase();
  }
  return config;
};

module.exports = loadConfig;