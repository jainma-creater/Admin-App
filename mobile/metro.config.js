const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Configure Metro on Windows to avoid worker thread memory crash
config.maxWorkers = 1;
config.transformer = {
  ...config.transformer,
  unstable_workerThreads: false,
};

module.exports = config;
