module.exports = {
  apps: [
    {
      name: "trading-bot",
      script: "socket.js",
      watch: false,
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
