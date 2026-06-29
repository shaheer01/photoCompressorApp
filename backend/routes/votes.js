const express = require('express');
const router = express.Router();
const { query } = require('../config/database');

// Initialize votes table if it doesn't exist
const initVotesTable = async () => {
    try {
        await query(`
            CREATE TABLE IF NOT EXISTS country_votes (
                id INT AUTO_INCREMENT PRIMARY KEY,
                country_name VARCHAR(100) NOT NULL UNIQUE,
                vote_count INT DEFAULT 0,
                is_custom BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);

        // Seed default coming-soon countries if table is empty
        const [rows] = await query('SELECT COUNT(*) as count FROM country_votes');
        if (rows.count === 0) {
            const defaults = [
                'France', 'Spain', 'Italy', 'Norway', 'Denmark', 'Finland',
                'USA', 'Ireland', 'Portugal', 'Switzerland', 'Belgium', 'Austria',
                'Qatar', 'Singapore', 'New Zealand', 'Saudi Arabia', 'Japan'
            ];
            for (const name of defaults) {
                await query('INSERT IGNORE INTO country_votes (country_name, vote_count) VALUES (?, 0)', [name]);
            }
        }
    } catch (err) {
        console.error('Failed to init votes table:', err.message);
    }
};

// Initialize on load
initVotesTable();

// GET /api/votes - Get all country votes sorted by count
router.get('/', async (req, res) => {
    try {
        const rows = await query(
            'SELECT country_name, vote_count, is_custom FROM country_votes ORDER BY vote_count DESC, country_name ASC'
        );
        res.json({ votes: rows });
    } catch (err) {
        console.error('Error fetching votes:', err);
        res.status(500).json({ error: 'Failed to fetch votes' });
    }
});

// POST /api/votes/:country - Vote for a country (increment)
router.post('/:country', async (req, res) => {
    const country = decodeURIComponent(req.params.country).trim();
    if (!country || country.length > 100) {
        return res.status(400).json({ error: 'Invalid country name' });
    }

    try {
        // Upsert: increment if exists, insert with 1 if not
        await query(
            `INSERT INTO country_votes (country_name, vote_count) VALUES (?, 1)
             ON DUPLICATE KEY UPDATE vote_count = vote_count + 1, updated_at = CURRENT_TIMESTAMP`,
            [country]
        );

        const rows = await query('SELECT vote_count FROM country_votes WHERE country_name = ?', [country]);
        res.json({ country, votes: rows[0]?.vote_count || 1 });
    } catch (err) {
        console.error('Error voting:', err);
        res.status(500).json({ error: 'Failed to record vote' });
    }
});

// DELETE /api/votes/:country - Unvote (decrement, min 0)
router.delete('/:country', async (req, res) => {
    const country = decodeURIComponent(req.params.country).trim();

    try {
        await query(
            'UPDATE country_votes SET vote_count = GREATEST(vote_count - 1, 0), updated_at = CURRENT_TIMESTAMP WHERE country_name = ?',
            [country]
        );

        const rows = await query('SELECT vote_count FROM country_votes WHERE country_name = ?', [country]);
        res.json({ country, votes: rows[0]?.vote_count || 0 });
    } catch (err) {
        console.error('Error unvoting:', err);
        res.status(500).json({ error: 'Failed to record unvote' });
    }
});

// POST /api/votes/request - Request a new country (adds it as custom with 1 vote)
router.post('/request/new', async (req, res) => {
    const { country } = req.body;
    if (!country || typeof country !== 'string' || country.trim().length === 0 || country.length > 100) {
        return res.status(400).json({ error: 'Invalid country name' });
    }

    const name = country.trim();

    try {
        await query(
            `INSERT INTO country_votes (country_name, vote_count, is_custom) VALUES (?, 1, TRUE)
             ON DUPLICATE KEY UPDATE vote_count = vote_count + 1, updated_at = CURRENT_TIMESTAMP`,
            [name]
        );

        const rows = await query('SELECT vote_count FROM country_votes WHERE country_name = ?', [name]);
        res.json({ country: name, votes: rows[0]?.vote_count || 1, message: 'Country request recorded' });
    } catch (err) {
        console.error('Error requesting country:', err);
        res.status(500).json({ error: 'Failed to record request' });
    }
});

module.exports = router;
