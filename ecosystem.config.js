module.exports = {
  apps: [
    {
      name: 'tg-xray-bot',
      script: './dist/index.js',
      interpreter: 'node',
      autorestart: true,
      watch: false,
      max_memory_restart: '200M',
      env: {
        NODE_ENV: 'production',
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: `${require('os').homedir()}/.tg-xray-bot/logs/error.log`,
      out_file: `${require('os').homedir()}/.tg-xray-bot/logs/out.log`,
    },
  ],
};
