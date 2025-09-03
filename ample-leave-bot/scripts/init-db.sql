-- Database initialization script for Ample Leave Policy Bot
-- This script ensures the database is properly set up with required extensions and optimizations

-- Create the vector extension if it doesn't exist
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Create indexes for better performance
-- Note: These will be created by the application, but we can optimize them here

-- Optimize for vector similarity searches
-- This will be created when the application runs, but we can set some defaults
ALTER SYSTEM SET shared_preload_libraries = 'pg_stat_statements,auto_explain';
ALTER SYSTEM SET auto_explain.log_min_duration = '1s';
ALTER SYSTEM SET auto_explain.log_analyze = on;

-- Set up monitoring for slow queries
ALTER SYSTEM SET log_min_duration_statement = 1000;
ALTER SYSTEM SET log_statement = 'mod';

-- Create a dedicated user for the application (if needed)
-- The application will use the default postgres user, but this is here for reference
-- CREATE USER ample_leave_app WITH PASSWORD 'secure_password';
-- GRANT ALL PRIVILEGES ON DATABASE ample_leave_bot TO ample_leave_app;

-- Optimize for the expected workload
ALTER SYSTEM SET effective_cache_size = '2GB';
ALTER SYSTEM SET shared_buffers = '256MB';
ALTER SYSTEM SET work_mem = '4MB';
ALTER SYSTEM SET maintenance_work_mem = '64MB';

-- Vector-specific optimizations
-- These will help with embedding similarity searches
ALTER SYSTEM SET max_parallel_workers_per_gather = 2;
ALTER SYSTEM SET max_parallel_workers = 4;

-- Apply the changes
SELECT pg_reload_conf();

-- Create a simple health check function
CREATE OR REPLACE FUNCTION health_check()
RETURNS TABLE(
    status TEXT,
    database_size TEXT,
    connections INTEGER,
    uptime INTERVAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        'healthy'::TEXT as status,
        pg_size_pretty(pg_database_size(current_database()))::TEXT as database_size,
        (SELECT count(*) FROM pg_stat_activity WHERE state = 'active')::INTEGER as connections,
        (SELECT now() - pg_postmaster_start_time())::INTERVAL as uptime;
END;
$$ LANGUAGE plpgsql;
