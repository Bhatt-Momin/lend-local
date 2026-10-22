module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    googleServicesFile:
      (process.env.GOOGLE_SERVICES_JSON &&
        process.env.GOOGLE_SERVICES_JSON.trim()) ||
      "./google-services.json",
  },
});
