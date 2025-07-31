const { Pool } = require('pg');
const logger = require('../utils/logger');

// Database connection pool
let pool;

const dbConfig = {
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT || 5432,
    max: 20, // Maximum number of clients in the pool
    idleTimeoutMillis: 30000, // How long a client is allowed to remain idle
    connectionTimeoutMillis: 2000, // How long to wait for a connection
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
};

// Alternative: use DATABASE_URL if provided (for services like Heroku)
if (process.env.DATABASE_URL) {
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
} else {
    pool = new Pool(dbConfig);
}

// Error handling for pool
pool.on('error', (err) => {
    logger.error('Unexpected error on idle client', err);
});

pool.on('connect', () => {
    logger.info('New database connection established');
});

// Test database connection
async function connectDB() {
    try {
        const client = await pool.connect();
        const result = await client.query('SELECT NOW()');
        client.release();
        logger.info(`Database connected successfully at ${result.rows[0].now}`);
        return true;
    } catch (error) {
        logger.error('Database connection failed:', error.message);
        throw error;
    }
}

// Query helper function
async function query(text, params) {
    const start = Date.now();
    try {
        const result = await pool.query(text, params);
        const duration = Date.now() - start;
        logger.debug(`Query executed in ${duration}ms: ${text}`);
        return result;
    } catch (error) {
        logger.error('Database query error:', {
            query: text,
            params: params,
            error: error.message
        });
        throw error;
    }
}

// Transaction helper
async function transaction(callback) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

// Close database connection
async function closeDB() {
    try {
        await pool.end();
        logger.info('Database connections closed');
    } catch (error) {
        logger.error('Error closing database connections:', error);
    }
}

module.exports = {
    pool,
    query,
    transaction,
    connectDB,
    closeDB
};