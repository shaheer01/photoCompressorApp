const mysql = require('mysql2/promise');
const logger = require('../utils/logger');

// Database connection pool
let pool;

const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectionLimit: 10,
    waitForConnections: true,
    connectTimeout: 30000,
    multipleStatements: false
};

// Cloud SQL on Cloud Run uses Unix socket via Cloud SQL Proxy
if (process.env.INSTANCE_CONNECTION_NAME) {
    dbConfig.socketPath = `/cloudsql/${process.env.INSTANCE_CONNECTION_NAME}`;
    logger.info(`Using Cloud SQL socket: ${dbConfig.socketPath}`);
} else {
    dbConfig.host = process.env.DB_HOST || 'localhost';
    dbConfig.port = parseInt(process.env.DB_PORT) || 3306;
    if (process.env.NODE_ENV === 'production') {
        dbConfig.ssl = { rejectUnauthorized: false };
    }
}

if (process.env.DATABASE_URL) {
    pool = mysql.createPool(process.env.DATABASE_URL);
} else {
    pool = mysql.createPool(dbConfig);
}

// Error handling for pool
pool.on('connection', (connection) => {
    logger.info(`New database connection established as id ${connection.threadId}`);
});

pool.on('error', (err) => {
    logger.error('Database pool error:', err);
    if (err.code === 'PROTOCOL_CONNECTION_LOST') {
        logger.info('Attempting to reconnect to database...');
    } else {
        throw err;
    }
});

// Test database connection
async function connectDB() {
    try {
        const connection = await pool.getConnection();
        const [result] = await connection.execute('SELECT NOW() as now');
        connection.release();
        logger.info(`Database connected successfully at ${result[0].now}`);
        return true;
    } catch (error) {
        logger.error('Database connection failed:', error.message);
        throw error;
    }
}

// Query helper function
async function query(text, params = []) {
    const start = Date.now();
    try {
        const [rows] = await pool.execute(text, params);
        const duration = Date.now() - start;
        logger.debug(`Query executed in ${duration}ms: ${text}`);
        return { rows }; // Keep same interface as pg
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
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        
        // Create a client-like object with execute method for compatibility
        const client = {
            query: async (text, params = []) => {
                const [rows] = await connection.execute(text, params);
                return { rows };
            },
            execute: async (text, params = []) => {
                const [rows] = await connection.execute(text, params);
                return { rows };
            }
        };
        
        const result = await callback(client);
        await connection.commit();
        return result;
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
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