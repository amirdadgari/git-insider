const jwt = require('jsonwebtoken');
const Database = require('../config/database');

const db = new Database();
const dbReady = db.connect();

// Authentication middleware
const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Ensure database is connected
        await dbReady;
        
        // Check if user still exists
        const user = await db.get('SELECT id, username, role FROM users WHERE id = ?', [decoded.userId]);
        if (!user) {
            return res.status(401).json({ error: 'Invalid token' });
        }

        req.user = user;
        next();
    } catch (error) {
        return res.status(403).json({ error: 'Invalid or expired token' });
    }
};

// Admin role middleware
const requireAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
};

// API token authentication middleware
const authenticateApiToken = async (req, res, next) => {
    const apiKey = req.headers['x-api-key'];

    if (!apiKey) {
        return res.status(401).json({ error: 'API key required' });
    }

    try {
        // Ensure database is connected
        await dbReady;
        
        const tokenRecord = await db.get(
            `SELECT t.*, u.username, u.role 
             FROM api_tokens t 
             JOIN users u ON t.user_id = u.id 
             WHERE t.token = ? AND t.is_active = 1 
             AND (t.expires_at IS NULL OR t.expires_at > datetime('now'))`,
            [apiKey]
        );

        if (!tokenRecord) {
            return res.status(401).json({ error: 'Invalid or expired API key' });
        }

        req.user = {
            id: tokenRecord.user_id,
            username: tokenRecord.username,
            role: tokenRecord.role
        };
        req.apiToken = tokenRecord;
        next();
    } catch (error) {
        return res.status(500).json({ error: 'Authentication error' });
    }
};

module.exports = {
    authenticateToken,
    requireAdmin,
    authenticateApiToken
};
