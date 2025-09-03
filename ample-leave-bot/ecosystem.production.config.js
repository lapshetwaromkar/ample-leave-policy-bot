module.exports = {
  apps: [
    {
      name: 'ample-leave-api',
      script: 'src/server.js',
      instances: process.env.API_INSTANCES || 2,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 3000
      },
      // Performance and reliability settings
      max_memory_restart: '1G',
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 4000,
      
      // Logging
      log_file: './logs/api-combined.log',
      out_file: './logs/api-out.log',
      error_file: './logs/api-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      
      // Monitoring
      monitoring: false,
      watch: false,
      
      // Graceful shutdown
      kill_timeout: 5000,
      listen_timeout: 3000
    },
    {
      name: 'ample-leave-slack',
      script: 'slack-server.js',
      instances: process.env.SLACK_INSTANCES || 2,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production'
      },
      
      // Performance settings for Slack bot
      max_memory_restart: '2G',
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 4000,
      
      // Logging
      log_file: './logs/slack-combined.log',
      out_file: './logs/slack-out.log',
      error_file: './logs/slack-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      
      // Monitoring
      monitoring: false,
      watch: false,
      
      // Graceful shutdown
      kill_timeout: 10000,
      listen_timeout: 5000
    }
  ]
};
