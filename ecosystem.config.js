/**
 * PM2 process configuration for the Real English backend.
 *
 * Usage (on the server, from the backend folder):
 *   pm2 start ecosystem.config.js
 *   pm2 save
 *   pm2 startup        # follow the printed command to survive reboots
 *
 * Notes:
 * - instances must stay 1: the backend uses Socket.io (in-memory rooms for
 *   chat + video call signaling). Multiple instances would need a shared
 *   adapter (e.g. Redis) to relay events, which is not configured here.
 * - The .env file in this folder is loaded automatically by the app
 *   (dotenv). Keep it OUT of git.
 */
module.exports = {
  apps: [
    {
      name: 'realenglish-backend',
      script: 'src/index.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 4000,
      },
      // Logging
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      merge_logs: true,
      time: true,
    },
  ],
};
