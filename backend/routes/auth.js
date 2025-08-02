const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const { query, transaction } = require('../config/database');
const { generateTokens, storeSession, revokeSession, revokeAllUserSessions } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// Rate limiting for auth endpoints
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // Limit each IP to 5 requests per windowMs
    message: {
        error: 'Too many authentication attempts',
        message: 'Please try again in 15 minutes'
    }
});

// Validation middleware
const registerValidation = [
    body('firstName').trim().isLength({ min: 2, max: 50 }).withMessage('First name must be 2-50 characters'),
    body('lastName').trim().isLength({ min: 2, max: 50 }).withMessage('Last name must be 2-50 characters'),
    body('email').isEmail().normalizeEmail().withMessage('Please provide a valid email'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
        .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
        .withMessage('Password must contain at least one lowercase letter, one uppercase letter, one digit, and one special character')
];

const loginValidation = [
    body('email').isEmail().normalizeEmail().withMessage('Please provide a valid email'),
    body('password').notEmpty().withMessage('Password is required')
];

// POST /api/auth/register
router.post('/register', authLimiter, registerValidation, async (req, res) => {
    try {
        // Check validation errors
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation failed',
                details: errors.array()
            });
        }

        const { firstName, lastName, email, password } = req.body;

        // Check if user already exists
        const existingUser = await query(
            'SELECT id FROM users WHERE email = ?',
            [email]
        );

        if (existingUser.rows.length > 0) {
            return res.status(409).json({
                error: 'User already exists',
                message: 'An account with this email already exists'
            });
        }

        // Hash password
        const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 12;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        // Create user in transaction
        const userData = await transaction(async (client) => {
            // Insert user
            const userResult = await client.query(
                `INSERT INTO users (first_name, last_name, email, password_hash, created_at)
                 VALUES (?, ?, ?, ?, NOW())`,
                [firstName, lastName, email, passwordHash]
            );

            const userId = userResult.rows.insertId;

            // Get the inserted user data
            const getUserResult = await client.query(
                'SELECT id, first_name, last_name, email, is_premium, created_at FROM users WHERE id = ?',
                [userId]
            );

            const user = getUserResult.rows[0];

            // Initialize usage statistics for today
            await client.query(
                `INSERT INTO usage_statistics (user_id, date, images_processed, total_original_size_mb, total_compressed_size_mb, total_savings_mb)
                 VALUES (?, CURRENT_DATE, 0, 0, 0, 0)
                 ON DUPLICATE KEY UPDATE user_id = user_id`,
                [user.id]
            );

            return user;
        });

        // Generate tokens
        const { accessToken, refreshToken } = generateTokens(userData.id);

        // Store session
        const deviceInfo = req.get('User-Agent') || 'Unknown';
        const ipAddress = req.ip;
        await storeSession(userData.id, accessToken, deviceInfo, ipAddress);

        // Update login statistics
        await query(
            'UPDATE users SET last_login = NOW(), login_count = login_count + 1 WHERE id = ?',
            [userData.id]
        );

        logger.info(`New user registered: ${email}`);

        res.status(201).json({
            message: 'Account created successfully',
            user: {
                id: userData.id,
                firstName: userData.first_name,
                lastName: userData.last_name,
                email: userData.email,
                isPremium: userData.is_premium,
                memberSince: userData.created_at
            },
            tokens: {
                accessToken,
                refreshToken,
                expiresIn: process.env.JWT_EXPIRES_IN || '24h'
            }
        });

    } catch (error) {
        logger.error('Registration error:', error);
        res.status(500).json({
            error: 'Registration failed',
            message: 'Internal server error'
        });
    }
});

// POST /api/auth/login
router.post('/login', authLimiter, loginValidation, async (req, res) => {
    try {
        // Check validation errors
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation failed',
                details: errors.array()
            });
        }

        const { email, password } = req.body;

        // Find user
        const userResult = await query(
            'SELECT id, first_name, last_name, email, password_hash, is_premium, subscription_type, is_active FROM users WHERE email = ?',
            [email]
        );

        if (userResult.rows.length === 0) {
            return res.status(401).json({
                error: 'Invalid credentials',
                message: 'Email or password is incorrect'
            });
        }

        const user = userResult.rows[0];

        // Check if account is active
        if (!user.is_active) {
            return res.status(403).json({
                error: 'Account disabled',
                message: 'Your account has been disabled. Please contact support.'
            });
        }

        // Verify password
        const isPasswordValid = await bcrypt.compare(password, user.password_hash);
        if (!isPasswordValid) {
            return res.status(401).json({
                error: 'Invalid credentials',
                message: 'Email or password is incorrect'
            });
        }

        // Generate tokens
        const { accessToken, refreshToken } = generateTokens(user.id);

        // Store session
        const deviceInfo = req.get('User-Agent') || 'Unknown';
        const ipAddress = req.ip;
        await storeSession(user.id, accessToken, deviceInfo, ipAddress);

        // Update login statistics
        await query(
            'UPDATE users SET last_login = NOW(), login_count = login_count + 1 WHERE id = ?',
            [user.id]
        );

        logger.info(`User logged in: ${email}`);

        res.json({
            message: 'Login successful',
            user: {
                id: user.id,
                firstName: user.first_name,
                lastName: user.last_name,
                email: user.email,
                isPremium: user.is_premium,
                subscriptionType: user.subscription_type
            },
            tokens: {
                accessToken,
                refreshToken,
                expiresIn: process.env.JWT_EXPIRES_IN || '24h'
            }
        });

    } catch (error) {
        logger.error('Login error:', error);
        res.status(500).json({
            error: 'Login failed',
            message: 'Internal server error'
        });
    }
});

// POST /api/auth/logout
router.post('/logout', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        const token = authHeader && authHeader.split(' ')[1];

        if (token) {
            await revokeSession(token);
            logger.info('User logged out successfully');
        }

        res.json({
            message: 'Logout successful'
        });

    } catch (error) {
        logger.error('Logout error:', error);
        res.status(500).json({
            error: 'Logout failed',
            message: 'Internal server error'
        });
    }
});

// POST /api/auth/logout-all
router.post('/logout-all', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        const token = authHeader && authHeader.split(' ')[1];

        if (token) {
            // Verify token to get user ID
            const jwt = require('jsonwebtoken');
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            
            // Revoke all sessions for this user
            const revokedCount = await revokeAllUserSessions(decoded.userId);
            
            logger.info(`Logged out from ${revokedCount} devices for user ${decoded.userId}`);
        }

        res.json({
            message: 'Logged out from all devices successfully'
        });

    } catch (error) {
        logger.error('Logout all error:', error);
        res.status(500).json({
            error: 'Logout failed',
            message: 'Internal server error'
        });
    }
});

// POST /api/auth/refresh
router.post('/refresh', async (req, res) => {
    try {
        const { refreshToken } = req.body;

        if (!refreshToken) {
            return res.status(401).json({
                error: 'Refresh token required',
                message: 'Please provide a refresh token'
            });
        }

        // Verify refresh token
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

        // Generate new access token
        const { accessToken } = generateTokens(decoded.userId);

        // Store new session
        const deviceInfo = req.get('User-Agent') || 'Unknown';
        const ipAddress = req.ip;
        await storeSession(decoded.userId, accessToken, deviceInfo, ipAddress);

        res.json({
            accessToken,
            expiresIn: process.env.JWT_EXPIRES_IN || '24h'
        });

    } catch (error) {
        logger.error('Token refresh error:', error);
        
        if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
            return res.status(401).json({
                error: 'Invalid refresh token',
                message: 'Please login again'
            });
        }
        
        res.status(500).json({
            error: 'Token refresh failed',
            message: 'Internal server error'
        });
    }
});

// GET /api/auth/verify - Verify current token
router.get('/verify', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        const token = authHeader && authHeader.split(' ')[1];

        if (!token) {
            return res.status(401).json({
                error: 'Token required',
                valid: false
            });
        }

        // Verify token
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Check if session exists
        const sessionResult = await query(
            'SELECT user_id FROM user_sessions WHERE token_hash = ? AND expires_at > NOW()',
            [token]
        );

        if (sessionResult.rows.length === 0) {
            return res.status(401).json({
                error: 'Invalid session',
                valid: false
            });
        }

        // Get user info
        const userResult = await query(
            'SELECT id, first_name, last_name, email, is_premium, subscription_type FROM users WHERE id = ? AND is_active = true',
            [decoded.userId]
        );

        if (userResult.rows.length === 0) {
            return res.status(401).json({
                error: 'User not found',
                valid: false
            });
        }

        const user = userResult.rows[0];

        res.json({
            valid: true,
            user: {
                id: user.id,
                firstName: user.first_name,
                lastName: user.last_name,
                email: user.email,
                isPremium: user.is_premium,
                subscriptionType: user.subscription_type
            }
        });

    } catch (error) {
        logger.error('Token verification error:', error);
        res.status(401).json({
            error: 'Token verification failed',
            valid: false
        });
    }
});

module.exports = router;