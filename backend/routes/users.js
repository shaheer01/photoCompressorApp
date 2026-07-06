const express = require('express');
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const { query, transaction } = require('../config/database');
const { verifyToken } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// All routes require authentication
router.use(verifyToken);

// GET /api/users/profile - Get user profile
router.get('/profile', async (req, res) => {
    try {
        const userResult = await query(
            `SELECT 
                id, first_name, last_name, email, is_premium, subscription_type,
                subscription_start_date, subscription_end_date, created_at, last_login, login_count
             FROM users 
             WHERE id = ?`,
            [req.user.id]
        );

        if (userResult.rows.length === 0) {
            return res.status(404).json({
                error: 'User not found'
            });
        }

        const user = userResult.rows[0];

        // Get usage statistics for current month
        const statsResult = await query(
            `SELECT 
                SUM(images_processed) as total_images,
                SUM(total_original_size_mb) as total_original_mb,
                SUM(total_compressed_size_mb) as total_compressed_mb,
                SUM(total_savings_mb) as total_savings_mb
             FROM usage_statistics 
             WHERE user_id = ? AND date >= DATE_FORMAT(CURRENT_DATE, '%Y-%m-01')`,
            [req.user.id]
        );

        const stats = statsResult.rows[0] || {
            total_images: 0,
            total_original_mb: 0,
            total_compressed_mb: 0,
            total_savings_mb: 0
        };

        res.json({
            user: {
                id: user.id,
                firstName: user.first_name,
                lastName: user.last_name,
                email: user.email,
                isPremium: user.is_premium,
                subscriptionType: user.subscription_type,
                subscriptionStartDate: user.subscription_start_date,
                subscriptionEndDate: user.subscription_end_date,
                memberSince: user.created_at,
                lastLogin: user.last_login,
                loginCount: user.login_count
            },
            monthlyStats: {
                imagesProcessed: parseInt(stats.total_images) || 0,
                totalOriginalMB: parseFloat(stats.total_original_mb) || 0,
                totalCompressedMB: parseFloat(stats.total_compressed_mb) || 0,
                totalSavingsMB: parseFloat(stats.total_savings_mb) || 0,
                averageCompressionRatio: stats.total_original_mb > 0 ? 
                    ((parseFloat(stats.total_original_mb) - parseFloat(stats.total_compressed_mb)) / parseFloat(stats.total_original_mb) * 100).toFixed(1) : 0
            }
        });

    } catch (error) {
        logger.error('Get profile error:', error);
        res.status(500).json({
            error: 'Failed to get profile',
            message: 'Internal server error'
        });
    }
});

// PUT /api/users/profile - Update user profile
router.put('/profile', [
    body('firstName').optional().trim().isLength({ min: 2, max: 50 }).withMessage('First name must be 2-50 characters'),
    body('lastName').optional().trim().isLength({ min: 2, max: 50 }).withMessage('Last name must be 2-50 characters'),
    body('email').optional().isEmail().normalizeEmail().withMessage('Please provide a valid email')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation failed',
                details: errors.array()
            });
        }

        const { firstName, lastName, email } = req.body;
        const setClauses = [];
        const params = [];

        // Build dynamic update query
        if (firstName !== undefined) {
            setClauses.push('first_name = ?');
            params.push(firstName);
        }

        if (lastName !== undefined) {
            setClauses.push('last_name = ?');
            params.push(lastName);
        }

        if (email !== undefined) {
            // Check if email is already taken by another user
            const emailCheck = await query(
                'SELECT id FROM users WHERE email = ? AND id != ?',
                [email, req.user.id]
            );

            if (emailCheck.rows.length > 0) {
                return res.status(409).json({
                    error: 'Email already taken',
                    message: 'This email is already associated with another account'
                });
            }

            setClauses.push('email = ?');
            params.push(email);
        }

        if (setClauses.length === 0) {
            return res.status(400).json({
                error: 'No updates provided',
                message: 'Please provide at least one field to update'
            });
        }

        // Add updated_at
        setClauses.push('updated_at = NOW()');

        // Add the WHERE param at the end
        params.push(req.user.id);

        const setClause = setClauses.join(', ');

        await query(
            `UPDATE users SET ${setClause} WHERE id = ?`,
            params
        );

        // Fetch the updated user
        const result = await query(
            'SELECT id, first_name, last_name, email, is_premium, subscription_type FROM users WHERE id = ?',
            [req.user.id]
        );

        const updatedUser = result.rows[0];

        logger.info(`User profile updated: ${updatedUser.email}`);

        res.json({
            message: 'Profile updated successfully',
            user: {
                id: updatedUser.id,
                firstName: updatedUser.first_name,
                lastName: updatedUser.last_name,
                email: updatedUser.email,
                isPremium: updatedUser.is_premium,
                subscriptionType: updatedUser.subscription_type
            }
        });

    } catch (error) {
        logger.error('Update profile error:', error);
        res.status(500).json({
            error: 'Failed to update profile',
            message: 'Internal server error'
        });
    }
});

// PUT /api/users/password - Change password
router.put('/password', [
    body('currentPassword').notEmpty().withMessage('Current password is required'),
    body('newPassword').isLength({ min: 8 }).withMessage('New password must be at least 8 characters')
        .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
        .withMessage('New password must contain at least one lowercase letter, one uppercase letter, one digit, and one special character')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation failed',
                details: errors.array()
            });
        }

        const { currentPassword, newPassword } = req.body;

        // Get current password hash
        const userResult = await query(
            'SELECT password_hash FROM users WHERE id = ?',
            [req.user.id]
        );

        if (userResult.rows.length === 0) {
            return res.status(404).json({
                error: 'User not found'
            });
        }

        // Verify current password
        const isCurrentPasswordValid = await bcrypt.compare(currentPassword, userResult.rows[0].password_hash);
        if (!isCurrentPasswordValid) {
            return res.status(401).json({
                error: 'Invalid current password',
                message: 'Please enter your current password correctly'
            });
        }

        // Hash new password
        const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 12;
        const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

        // Update password
        await query(
            'UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?',
            [newPasswordHash, req.user.id]
        );

        logger.info(`Password changed for user: ${req.user.email}`);

        res.json({
            message: 'Password changed successfully'
        });

    } catch (error) {
        logger.error('Change password error:', error);
        res.status(500).json({
            error: 'Failed to change password',
            message: 'Internal server error'
        });
    }
});

// GET /api/users/sessions - Get active sessions
router.get('/sessions', async (req, res) => {
    try {
        const sessionsResult = await query(
            `SELECT 
                id, device_info, ip_address, created_at, last_used, expires_at,
                CASE WHEN token_hash = ? THEN true ELSE false END as is_current
             FROM user_sessions
             WHERE user_id = ? AND expires_at > NOW()
             ORDER BY last_used DESC`,
            [req.token, req.user.id]
        );

        const sessions = sessionsResult.rows.map(session => ({
            id: session.id,
            deviceInfo: session.device_info,
            ipAddress: session.ip_address,
            createdAt: session.created_at,
            lastUsed: session.last_used,
            expiresAt: session.expires_at,
            isCurrent: session.is_current
        }));

        res.json({
            sessions,
            totalSessions: sessions.length
        });

    } catch (error) {
        logger.error('Get sessions error:', error);
        res.status(500).json({
            error: 'Failed to get sessions',
            message: 'Internal server error'
        });
    }
});

// DELETE /api/users/sessions/:sessionId - Revoke specific session
router.delete('/sessions/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;

        const result = await query(
            'DELETE FROM user_sessions WHERE id = ? AND user_id = ?',
            [sessionId, req.user.id]
        );

        if ((result.rows?.affectedRows || 0) === 0) {
            return res.status(404).json({
                error: 'Session not found',
                message: 'Session does not exist or does not belong to you'
            });
        }

        logger.info(`Session revoked: ${sessionId} for user ${req.user.email}`);

        res.json({
            message: 'Session revoked successfully'
        });

    } catch (error) {
        logger.error('Revoke session error:', error);
        res.status(500).json({
            error: 'Failed to revoke session',
            message: 'Internal server error'
        });
    }
});

// GET /api/users/usage-history - Get usage history
router.get('/usage-history', async (req, res) => {
    try {
        const { days = 30 } = req.query;
        
        const historyResult = await query(
            `SELECT 
                date, images_processed, total_original_size_mb, 
                total_compressed_size_mb, total_savings_mb
             FROM usage_statistics 
             WHERE user_id = ? AND date >= CURRENT_DATE - INTERVAL ${parseInt(days)} DAY
             ORDER BY date DESC`,
            [req.user.id]
        );

        const history = historyResult.rows.map(row => ({
            date: row.date,
            imagesProcessed: parseInt(row.images_processed),
            originalSizeMB: parseFloat(row.total_original_size_mb),
            compressedSizeMB: parseFloat(row.total_compressed_size_mb),
            savingsMB: parseFloat(row.total_savings_mb),
            compressionRatio: row.total_original_size_mb > 0 ? 
                ((parseFloat(row.total_original_size_mb) - parseFloat(row.total_compressed_size_mb)) / parseFloat(row.total_original_size_mb) * 100).toFixed(1) : 0
        }));

        res.json({
            history,
            totalDays: parseInt(days)
        });

    } catch (error) {
        logger.error('Get usage history error:', error);
        res.status(500).json({
            error: 'Failed to get usage history',
            message: 'Internal server error'
        });
    }
});

// DELETE /api/users/account - Delete account
router.delete('/account', [
    body('password').notEmpty().withMessage('Password is required for account deletion'),
    body('confirmation').equals('DELETE').withMessage('Please type DELETE to confirm account deletion')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation failed',
                details: errors.array()
            });
        }

        const { password } = req.body;

        // Verify password
        const userResult = await query(
            'SELECT password_hash FROM users WHERE id = ?',
            [req.user.id]
        );

        if (userResult.rows.length === 0) {
            return res.status(404).json({
                error: 'User not found'
            });
        }

        const isPasswordValid = await bcrypt.compare(password, userResult.rows[0].password_hash);
        if (!isPasswordValid) {
            return res.status(401).json({
                error: 'Invalid password',
                message: 'Please enter your password correctly'
            });
        }

        // Delete account in transaction
        await transaction(async (client) => {
            // Delete related data (cascade will handle most of this)
            await client.query('DELETE FROM user_sessions WHERE user_id = ?', [req.user.id]);
            await client.query('DELETE FROM usage_statistics WHERE user_id = ?', [req.user.id]);
            await client.query('DELETE FROM subscription_transactions WHERE user_id = ?', [req.user.id]);
            await client.query('UPDATE image_processing_logs SET user_id = NULL WHERE user_id = ?', [req.user.id]);

            // Delete user account
            await client.query('DELETE FROM users WHERE id = ?', [req.user.id]);
        });

        logger.info(`Account deleted for user: ${req.user.email}`);

        res.json({
            message: 'Account deleted successfully'
        });

    } catch (error) {
        logger.error('Delete account error:', error);
        res.status(500).json({
            error: 'Failed to delete account',
            message: 'Internal server error'
        });
    }
});

module.exports = router;