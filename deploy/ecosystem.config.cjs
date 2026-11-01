module.exports = {
  apps: [
    {
      name: 'yapin-middleman-bot',
      script: 'src/index.js',
      instances: 1, // Keep 1 instance per bot token (Yapin Gateway allows max 2 sockets/bot)
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',
      kill_timeout: 20000,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
