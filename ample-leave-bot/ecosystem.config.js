module.exports = {
  apps: [
    // API Server (Frontend - Low Traffic)
    {
      name: 'ample-api-server',
      script: 'src/server.js',
      instances: 1, // Only 1 needed for 5 frontend users
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      error_file: './logs/api-err.log',
      out_file: './logs/api-out.log',
      log_file: './logs/api-combined.log',
      time: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    },
    // Slack Bot Server (High Traffic - Critical)
    {
      name: 'ample-slack-bot',
      script: 'slack-server.js',
      instances: 4, // Scale to 4 instances for 1000+ users
      exec_mode: 'cluster',
      autorestart: true,
      watch: false,
      max_memory_restart: '2G', // Increased memory limit
      min_uptime: '10s',
      max_restarts: 5,
      restart_delay: 4000,
      env: {
        NODE_ENV: 'production',
        // Slack-specific optimizations
        UV_THREADPOOL_SIZE: 128,
        NODE_OPTIONS: '--max-old-space-size=4096'
      },
      error_file: './logs/slack-err.log',
      out_file: './logs/slack-out.log',
      log_file: './logs/slack-combined.log',
      time: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      // Health monitoring
      health_check_url: 'http://localhost:3001/health',
      health_check_grace_period: 3000
    }
  ]
}; 