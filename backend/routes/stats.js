const express = require('express');
const { query } = require('../config/database');
const { verifyToken, optionalAuth } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// GET /api/stats/global - Get global platform statistics (public)
router.get('/global', async (req, res) => {
    try {
        // Get global statistics
        const statsResult = await query(
            `SELECT 
                COUNT(DISTINCT user_id) as total_users,
                COUNT(*) as total_images_processed,
                SUM(original_size_bytes) as total_original_bytes,
                SUM(compressed_size_bytes) as total_compressed_bytes,
                AVG(compression_ratio) as avg_compression_ratio,
                AVG(processing_time_ms) as avg_processing_time
             FROM image_processing_logs
             WHERE created_at >= CURRENT_DATE - INTERVAL 30 DAY`
        );

        const premiumUsersResult = await query(
            'SELECT COUNT(*) as premium_users FROM users WHERE is_premium = true AND is_active = true'
        );

        const totalUsersResult = await query(
            'SELECT COUNT(*) as total_users FROM users WHERE is_active = true'
        );

        const stats = statsResult.rows[0];
        const totalOriginalGB = parseFloat(stats.total_original_bytes || 0) / (1024 * 1024 * 1024);
        const totalCompressedGB = parseFloat(stats.total_compressed_bytes || 0) / (1024 * 1024 * 1024);
        const totalSavedGB = totalOriginalGB - totalCompressedGB;

        res.json({
            globalStats: {
                totalUsers: parseInt(totalUsersResult.rows[0].total_users),
                premiumUsers: parseInt(premiumUsersResult.rows[0].premium_users),
                totalImagesProcessed: parseInt(stats.total_images_processed || 0),
                totalDataProcessedGB: totalOriginalGB.toFixed(1),
                totalDataSavedGB: totalSavedGB.toFixed(1),
                averageCompressionRatio: parseFloat(stats.avg_compression_ratio || 0).toFixed(1),
                averageProcessingTimeMs: parseInt(stats.avg_processing_time || 0)
            },
            period: 'Last 30 days'
        });

    } catch (error) {
        logger.error('Get global stats error:', error);
        res.status(500).json({
            error: 'Failed to get global statistics',
            message: 'Internal server error'
        });
    }
});

// GET /api/stats/user - Get user-specific statistics (requires auth)
router.get('/user', verifyToken, async (req, res) => {
    try {
        const { period = '30' } = req.query; // days
        const days = Math.min(parseInt(period), 365); // Max 1 year

        // Get user statistics for the period
        const statsResult = await query(
            `SELECT 
                COUNT(*) as total_images,
                SUM(original_size_bytes) as total_original_bytes,
                SUM(compressed_size_bytes) as total_compressed_bytes,
                AVG(compression_ratio) as avg_compression_ratio,
                AVG(processing_time_ms) as avg_processing_time,
                MIN(created_at) as first_compression,
                MAX(created_at) as last_compression
             FROM image_processing_logs 
             WHERE user_id = ? AND created_at >= CURRENT_DATE - INTERVAL ${days} DAY`,
            [req.user.id]
        );

        // Get daily breakdown
        const dailyResult = await query(
            `SELECT
                DATE(created_at) as date,
                COUNT(*) as images_count,
                SUM(original_size_bytes) as original_bytes,
                SUM(compressed_size_bytes) as compressed_bytes
             FROM image_processing_logs
             WHERE user_id = ? AND created_at >= CURRENT_DATE - INTERVAL ${days} DAY
             GROUP BY DATE(created_at)
             ORDER BY date DESC`,
            [req.user.id]
        );

        // Get compression method breakdown
        const methodResult = await query(
            `SELECT
                compression_method,
                COUNT(*) as count,
                AVG(compression_ratio) as avg_ratio
             FROM image_processing_logs
             WHERE user_id = ? AND created_at >= CURRENT_DATE - INTERVAL ${days} DAY
             GROUP BY compression_method`,
            [req.user.id]
        );

        // Get quality settings breakdown
        const qualityResult = await query(
            `SELECT
                quality_setting,
                COUNT(*) as count,
                AVG(compression_ratio) as avg_ratio
             FROM image_processing_logs
             WHERE user_id = ? AND created_at >= CURRENT_DATE - INTERVAL ${days} DAY
             GROUP BY quality_setting
             ORDER BY quality_setting`,
            [req.user.id]
        );

        const stats = statsResult.rows[0];
        const totalOriginalMB = parseFloat(stats.total_original_bytes || 0) / (1024 * 1024);
        const totalCompressedMB = parseFloat(stats.total_compressed_bytes || 0) / (1024 * 1024);
        const totalSavedMB = totalOriginalMB - totalCompressedMB;

        res.json({
            userStats: {
                totalImages: parseInt(stats.total_images || 0),
                totalOriginalSizeMB: totalOriginalMB.toFixed(2),
                totalCompressedSizeMB: totalCompressedMB.toFixed(2),
                totalSavedMB: totalSavedMB.toFixed(2),
                averageCompressionRatio: parseFloat(stats.avg_compression_ratio || 0).toFixed(1),
                averageProcessingTimeMs: parseInt(stats.avg_processing_time || 0),
                firstCompression: stats.first_compression,
                lastCompression: stats.last_compression
            },
            dailyBreakdown: dailyResult.rows.map(row => ({
                date: row.date,
                imagesCount: parseInt(row.images_count),
                originalSizeMB: (parseFloat(row.original_bytes) / (1024 * 1024)).toFixed(2),
                compressedSizeMB: (parseFloat(row.compressed_bytes) / (1024 * 1024)).toFixed(2),
                savedMB: ((parseFloat(row.original_bytes) - parseFloat(row.compressed_bytes)) / (1024 * 1024)).toFixed(2)
            })),
            compressionMethods: methodResult.rows.map(row => ({
                method: row.compression_method,
                count: parseInt(row.count),
                averageRatio: parseFloat(row.avg_ratio).toFixed(1)
            })),
            qualitySettings: qualityResult.rows.map(row => ({
                quality: parseInt(row.quality_setting),
                count: parseInt(row.count),
                averageRatio: parseFloat(row.avg_ratio).toFixed(1)
            })),
            period: `Last ${days} days`
        });

    } catch (error) {
        logger.error('Get user stats error:', error);
        res.status(500).json({
            error: 'Failed to get user statistics',
            message: 'Internal server error'
        });
    }
});

// GET /api/stats/leaderboard - Get compression leaderboard (public, anonymized)
router.get('/leaderboard', async (req, res) => {
    try {
        // Get top users by compression savings (anonymized)
        const savingsResult = await query(
            `SELECT
                CONCAT('User-', SUBSTRING(MD5(CAST(user_id AS CHAR)), 1, 8)) as anonymous_id,
                SUM(original_size_bytes - compressed_size_bytes) as total_saved_bytes,
                COUNT(*) as images_processed
             FROM image_processing_logs
             WHERE user_id IS NOT NULL AND created_at >= CURRENT_DATE - INTERVAL 30 DAY
             GROUP BY user_id
             ORDER BY total_saved_bytes DESC
             LIMIT 10`
        );

        // Get top compression ratios
        const ratioResult = await query(
            `SELECT
                CONCAT('User-', SUBSTRING(MD5(CAST(user_id AS CHAR)), 1, 8)) as anonymous_id,
                AVG(compression_ratio) as avg_compression_ratio,
                COUNT(*) as images_processed
             FROM image_processing_logs
             WHERE user_id IS NOT NULL AND created_at >= CURRENT_DATE - INTERVAL 30 DAY
             GROUP BY user_id
             HAVING COUNT(*) >= 5
             ORDER BY avg_compression_ratio DESC
             LIMIT 10`
        );

        res.json({
            topSavers: savingsResult.rows.map((row, index) => ({
                rank: index + 1,
                anonymousId: row.anonymous_id,
                totalSavedMB: (parseFloat(row.total_saved_bytes) / (1024 * 1024)).toFixed(1),
                imagesProcessed: parseInt(row.images_processed)
            })),
            topCompressionRatios: ratioResult.rows.map((row, index) => ({
                rank: index + 1,
                anonymousId: row.anonymous_id,
                averageCompressionRatio: parseFloat(row.avg_compression_ratio).toFixed(1),
                imagesProcessed: parseInt(row.images_processed)
            })),
            period: 'Last 30 days',
            note: 'User identities are anonymized for privacy'
        });

    } catch (error) {
        logger.error('Get leaderboard error:', error);
        res.status(500).json({
            error: 'Failed to get leaderboard',
            message: 'Internal server error'
        });
    }
});

// GET /api/stats/trends - Get platform trends over time (public)
router.get('/trends', async (req, res) => {
    try {
        const { days = 30 } = req.query;
        const period = Math.min(parseInt(days), 90); // Max 90 days

        // Get daily trends
        const trendsResult = await query(
            `SELECT 
                DATE(created_at) as date,
                COUNT(*) as images_processed,
                COUNT(DISTINCT user_id) as active_users,
                SUM(original_size_bytes) as total_original_bytes,
                SUM(compressed_size_bytes) as total_compressed_bytes,
                AVG(compression_ratio) as avg_compression_ratio
             FROM image_processing_logs 
             WHERE created_at >= CURRENT_DATE - INTERVAL ${period} DAY
             GROUP BY DATE(created_at)
             ORDER BY date`
        );

        // Get user growth
        const userGrowthResult = await query(
            `SELECT
                DATE(created_at) as date,
                COUNT(*) as new_users
             FROM users
             WHERE created_at >= CURRENT_DATE - INTERVAL ${period} DAY AND is_active = true
             GROUP BY DATE(created_at)
             ORDER BY date`
        );

        res.json({
            dailyTrends: trendsResult.rows.map(row => ({
                date: row.date,
                imagesProcessed: parseInt(row.images_processed),
                activeUsers: parseInt(row.active_users),
                totalOriginalMB: (parseFloat(row.total_original_bytes) / (1024 * 1024)).toFixed(1),
                totalCompressedMB: (parseFloat(row.total_compressed_bytes) / (1024 * 1024)).toFixed(1),
                totalSavedMB: ((parseFloat(row.total_original_bytes) - parseFloat(row.total_compressed_bytes)) / (1024 * 1024)).toFixed(1),
                averageCompressionRatio: parseFloat(row.avg_compression_ratio).toFixed(1)
            })),
            userGrowth: userGrowthResult.rows.map(row => ({
                date: row.date,
                newUsers: parseInt(row.new_users)
            })),
            period: `Last ${period} days`
        });

    } catch (error) {
        logger.error('Get trends error:', error);
        res.status(500).json({
            error: 'Failed to get trends',
            message: 'Internal server error'
        });
    }
});

// GET /api/stats/admin - Get admin dashboard statistics (requires admin)
router.get('/admin', verifyToken, async (req, res) => {
    try {
        // TODO: Add admin role check
        // For now, just check if user is premium (placeholder for admin)
        if (!req.user.is_premium) {
            return res.status(403).json({
                error: 'Admin access required',
                message: 'This endpoint requires admin privileges'
            });
        }

        const { period = 30 } = req.query;
        const days = parseInt(period);

        // Get comprehensive admin statistics
        const [
            totalStatsResult,
            recentActivityResult,
            topUsersResult,
            errorStatsResult,
            subscriptionStatsResult
        ] = await Promise.all([
            // Total platform statistics
            query(`
                SELECT 
                    (SELECT COUNT(*) FROM users WHERE is_active = true) as total_users,
                    (SELECT COUNT(*) FROM users WHERE is_premium = true AND is_active = true) as premium_users,
                    (SELECT COUNT(*) FROM image_processing_logs WHERE created_at >= CURRENT_DATE - INTERVAL ${days} DAY) as recent_compressions,
                    (SELECT SUM(original_size_bytes) FROM image_processing_logs WHERE created_at >= CURRENT_DATE - INTERVAL ${days} DAY) as total_original_bytes,
                    (SELECT SUM(compressed_size_bytes) FROM image_processing_logs WHERE created_at >= CURRENT_DATE - INTERVAL ${days} DAY) as total_compressed_bytes
            `),
            
            // Recent activity
            query(`
                SELECT 
                    DATE(created_at) as date,
                    COUNT(*) as compressions,
                    COUNT(DISTINCT user_id) as active_users
                FROM image_processing_logs 
                WHERE created_at >= CURRENT_DATE - INTERVAL 7 DAY
                GROUP BY DATE(created_at)
                ORDER BY date DESC
            `),
            
            // Top users by usage
            query(`
                SELECT 
                    u.email,
                    u.first_name,
                    u.last_name,
                    u.is_premium,
                    COUNT(ipl.*) as total_compressions,
                    SUM(ipl.original_size_bytes - ipl.compressed_size_bytes) as total_saved_bytes
                FROM users u
                LEFT JOIN image_processing_logs ipl ON u.id = ipl.user_id
                WHERE u.is_active = true AND ipl.created_at >= CURRENT_DATE - INTERVAL ${days} DAY
                GROUP BY u.id, u.email, u.first_name, u.last_name, u.is_premium
                ORDER BY total_compressions DESC
                LIMIT 20
            `),
            
            // Error statistics (placeholder - would need error logging)
            query(`
                SELECT 
                    compression_method,
                    COUNT(*) as count
                FROM image_processing_logs 
                WHERE created_at >= CURRENT_DATE - INTERVAL ${days} DAY
                GROUP BY compression_method
            `),
            
            // Subscription statistics
            query(`
                SELECT 
                    subscription_type,
                    status,
                    COUNT(*) as count,
                    SUM(amount_cents) as total_revenue_cents
                FROM subscription_transactions 
                WHERE processed_at >= CURRENT_DATE - INTERVAL ${days} DAY
                GROUP BY subscription_type, status
            `)
        ]);

        const totalStats = totalStatsResult.rows[0];
        const totalOriginalGB = parseFloat(totalStats.total_original_bytes || 0) / (1024 * 1024 * 1024);
        const totalCompressedGB = parseFloat(totalStats.total_compressed_bytes || 0) / (1024 * 1024 * 1024);

        res.json({
            platformOverview: {
                totalUsers: parseInt(totalStats.total_users),
                premiumUsers: parseInt(totalStats.premium_users),
                freeUsers: parseInt(totalStats.total_users) - parseInt(totalStats.premium_users),
                recentCompressions: parseInt(totalStats.recent_compressions || 0),
                totalDataProcessedGB: totalOriginalGB.toFixed(2),
                totalDataSavedGB: (totalOriginalGB - totalCompressedGB).toFixed(2)
            },
            recentActivity: recentActivityResult.rows,
            topUsers: topUsersResult.rows.map(row => ({
                email: row.email,
                name: `${row.first_name} ${row.last_name}`,
                isPremium: row.is_premium,
                totalCompressions: parseInt(row.total_compressions),
                totalSavedMB: (parseFloat(row.total_saved_bytes) / (1024 * 1024)).toFixed(1)
            })),
            compressionMethods: errorStatsResult.rows,
            subscriptionStats: subscriptionStatsResult.rows.map(row => ({
                subscriptionType: row.subscription_type,
                status: row.status,
                count: parseInt(row.count),
                totalRevenue: parseFloat(row.total_revenue_cents || 0) / 100
            })),
            period: `Last ${days} days`
        });

    } catch (error) {
        logger.error('Get admin stats error:', error);
        res.status(500).json({
            error: 'Failed to get admin statistics',
            message: 'Internal server error'
        });
    }
});

module.exports = router;