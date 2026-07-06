const jwt = require('jsonwebtoken');
const { query } = require('../config/database');
const logger = require('../utils/logger');

// Verify JWT token
const verifyToken = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
        
        if (!token) {
            return res.status(401).json({
                error: 'Access token required',
                message: 'Please provide a valid access token'
            });
        }

        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Check if token exists in database (for token revocation)
        const sessionResult = await query(
            'SELECT * FROM user_sessions WHERE token_hash = ? AND expires_at > NOW()',
            [token]
        );
        
        if (sessionResult.rows.length === 0) {
            return res.status(401).json({
                error: 'Invalid or expired token',
                message: 'Please login again'
            });
        }

        // Get user details
        const userResult = await query(
            'SELECT id, first_name, last_name, email, is_premium, subscription_type, is_active FROM users WHERE id = ? AND is_active = true',
            [decoded.userId]
        );

        if (userResult.rows.length === 0) {
            return res.status(401).json({
                error: 'User not found or inactive',
                message: 'Please contact support'
            });
        }

        // Update last used timestamp for session
        await query(
            'UPDATE user_sessions SET last_used = NOW() WHERE token_hash = ?',
            [token]
        );

        // Attach user to request
        req.user = userResult.rows[0];
        req.token = token;
        
        next();
    } catch (error) {
        logger.error('Token verification error:', error);
        
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                error: 'Invalid token',
                message: 'Please login again'
            });
        }
        
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                error: 'Token expired',
                message: 'Please login again'
            });
        }
        
        return res.status(500).json({
            error: 'Authentication error',
            message: 'Internal server error'
        });
    }
};

// Check if user is premium
const requirePremium = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({
            error: 'Authentication required',
            message: 'Please login first'
        });
    }
    
    if (!req.user.is_premium) {
        return res.status(403).json({
            error: 'Premium subscription required',
            message: 'This feature requires a premium subscription',
            upgradeUrl: '/premium'
        });
    }
    
    next();
};

// Optional authentication (for anonymous users)
const optionalAuth = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        const token = authHeader && authHeader.split(' ')[1];
        
        if (token) {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            
            const userResult = await query(
                'SELECT id, first_name, last_name, email, is_premium, subscription_type FROM users WHERE id = ? AND is_active = true',
                [decoded.userId]
            );
            
            if (userResult.rows.length > 0) {
                req.user = userResult.rows[0];
            }
        }
        
        next();
    } catch (error) {
        // Continue without authentication for optional auth
        next();
    }
};

// Generate JWT tokens
const generateTokens = (userId) => {
    const accessToken = jwt.sign(
        { userId },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );
    
    const refreshToken = jwt.sign(
        { userId },
        process.env.JWT_REFRESH_SECRET,
        { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
    );
    
    return { accessToken, refreshToken };
};

// Store session in database
const storeSession = async (userId, token, deviceInfo, ipAddress) => {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    
    await query(
        `INSERT INTO user_sessions (user_id, token_hash, device_info, ip_address, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
        [userId, token, deviceInfo, ipAddress, expiresAt]
    );
};

// Revoke session
const revokeSession = async (token) => {
    await query(
        'DELETE FROM user_sessions WHERE token_hash = ?',
        [token]
    );
};

// Clean expired sessions
const cleanExpiredSessions = async () => {
    const result = await query(
        'DELETE FROM user_sessions WHERE expires_at < NOW()'
    );

    const affectedRows = result.rows?.affectedRows || 0;
    logger.info(`Cleaned ${affectedRows} expired sessions`);
    return affectedRows;
};

// Revoke all user sessions (for logout all devices)
const revokeAllUserSessions = async (userId) => {
    const result = await query(
        'DELETE FROM user_sessions WHERE user_id = ?',
        [userId]
    );

    return result.rows?.affectedRows || 0;
};

module.exports = {
    verifyToken,
    requirePremium,
    optionalAuth,
    generateTokens,
    storeSession,
    revokeSession,
    cleanExpiredSessions,
    revokeAllUserSessions
};