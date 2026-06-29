const express = require('express');
const path = require('path');
const crypto = require('crypto');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
require('express-async-errors');
require('dotenv').config();

const logger = require('./utils/logger');
const errorHandler = require('./middleware/errorHandler');
const { connectDB, closeDB, query } = require('./config/database');
const { cleanExpiredSessions } = require('./middleware/auth');

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const subscriptionRoutes = require('./routes/subscriptions');
const imageRoutes = require('./routes/images');
const statsRoutes = require('./routes/stats');
const webhookRoutes = require('./routes/webhooks');
const voteRoutes = require('./routes/votes');

const app = express();
const PORT = process.env.PORT || 3001;
let server;
let sessionCleanupInterval;

// Trust proxy for rate limiting (Cloud Run, nginx, etc.)
app.set('trust proxy', 1);

// Parse allowed origins (supports comma-separated list)
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:3000').split(',').map(s => s.trim());

// --- Request ID middleware ---
app.use((req, res, next) => {
    req.id = req.headers['x-request-id'] || crypto.randomUUID();
    res.setHeader('X-Request-ID', req.id);
    next();
});

// --- Request timeout middleware ---
app.use((req, res, next) => {
    const timeout = req.path.includes('/images/') ? 120000 : 30000; // 2 min for image processing, 30s for others
    req.setTimeout(timeout);
    res.setTimeout(timeout, () => {
        if (!res.headersSent) {
            logger.warn(`Request timeout: ${req.method} ${req.path} [${req.id}]`);
            res.status(408).json({ error: 'Request timeout', message: 'The request took too long to process' });
        }
    });
    next();
});

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com"],
            scriptSrc: ["'self'", "https://js.stripe.com", "https://pagead2.googlesyndication.com"],
            imgSrc: ["'self'", "data:", "blob:", "https:"],
            connectSrc: ["'self'", "https://api.stripe.com", ...allowedOrigins],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
            frameSrc: ["https://js.stripe.com", "https://hooks.stripe.com"]
        }
    },
    crossOriginEmbedderPolicy: false
}));

// CORS configuration
app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(null, false);
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Request-ID'],
    exposedHeaders: ['X-Request-ID']
}));

// Compression middleware
app.use(compression());

// Logging middleware with request ID
app.use(morgan(':method :url :status :res[content-length] - :response-time ms [:req[x-request-id]]', {
    stream: { write: message => logger.info(message.trim()) }
}));

// Rate limiting
const generalLimiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
    message: { error: 'Too many requests', message: 'Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.ip
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { error: 'Too many auth attempts', message: 'Please try again in 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false
});

const uploadLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 30,
    message: { error: 'Upload rate limit exceeded', message: 'Please wait before uploading more images.' },
    standardHeaders: true,
    legacyHeaders: false
});

app.use('/api/', generalLimiter);
app.use('/api/auth/', authLimiter);
app.use('/api/images/compress', uploadLimiter);

// Body parsing middleware
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// --- Health check endpoints ---
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: Math.round(process.uptime()),
        version: process.env.npm_package_version || '2.0.0',
        environment: process.env.NODE_ENV || 'development',
        memory: {
            rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB',
            heap: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB'
        }
    });
});

app.get('/health/ready', async (req, res) => {
    try {
        await query('SELECT 1');
        res.status(200).json({ status: 'ready', database: 'connected' });
    } catch (error) {
        logger.error('Readiness check failed:', error.message);
        res.status(503).json({ status: 'not_ready', database: 'disconnected', error: error.message });
    }
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/images', imageRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/votes', voteRoutes);

// Serve static files from frontend (in production)
if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, '../dist')));

    app.get('*', (req, res) => {
        res.sendFile(path.join(__dirname, '../dist/index.html'));
    });
}

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Route not found',
        message: `The endpoint ${req.originalUrl} does not exist`,
        availableEndpoints: [
            'GET /health',
            'GET /health/ready',
            'POST /api/auth/register',
            'POST /api/auth/login',
            'GET /api/users/profile',
            'POST /api/images/compress',
            'POST /api/images/compress-zip',
            'POST /api/images/info',
            'POST /api/images/convert',
            'GET /api/images/formats',
            'GET /api/images/limits',
            'GET /api/images/history'
        ]
    });
});

// Error handling middleware (must be last)
app.use(errorHandler);

// Graceful shutdown
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

async function gracefulShutdown(signal) {
    logger.info(`Received ${signal}. Graceful shutdown initiated.`);

    if (sessionCleanupInterval) {
        clearInterval(sessionCleanupInterval);
    }

    if (server) {
        server.close(async () => {
            logger.info('HTTP server closed.');
            await closeDB();
            process.exit(0);
        });
    }

    setTimeout(() => {
        logger.error('Forcing server shutdown after timeout.');
        process.exit(1);
    }, 10000);
}

// Session cleanup job - runs every 6 hours
function startSessionCleanup() {
    sessionCleanupInterval = setInterval(async () => {
        try {
            const cleaned = await cleanExpiredSessions();
            if (cleaned > 0) {
                logger.info(`Session cleanup: removed ${cleaned} expired sessions`);
            }
        } catch (err) {
            logger.error('Session cleanup error:', err.message);
        }
    }, 6 * 60 * 60 * 1000);
}

// Start server - bind port first, then connect DB (Cloud Run needs port open quickly)
async function startServer() {
    try {
        server = app.listen(PORT, async () => {
            logger.info(`ImageOptim API Server v2.0.0 running on port ${PORT}`);
            logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
            logger.info(`Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:3000'}`);

            // Connect to DB after port is bound
            try {
                await connectDB();
                logger.info('Database connected successfully');
                startSessionCleanup();
            } catch (dbError) {
                logger.error('Database connection failed on startup:', dbError.message);
                logger.info('Server running but DB unavailable - /health/ready will report not_ready');
            }
        });
    } catch (error) {
        logger.error('Failed to start server:', error);
        process.exit(1);
    }
}

startServer();

module.exports = app;
