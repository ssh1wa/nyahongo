// 预装的离线词典（assets/dict/jmdict.sqlite）作为资源文件打进 APK
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('sqlite');

module.exports = config;
