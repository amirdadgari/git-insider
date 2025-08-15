const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const userModel = new User();

// Login
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }

        const result = await userModel.authenticate(username, password);
        res.json(result);
    } catch (error) {
        res.status(401).json({ error: error.message });
    }
});

// Get current user info
router.get('/me', authenticateToken, async (req, res) => {
    try {
        const user = await userModel.findById(req.user.id);
        res.json(user);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Change password
router.put('/change-password', authenticateToken, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Current password and new password are required' });
        }

        // Verify current password
        await userModel.authenticate(req.user.username, currentPassword);
        
        // Update password
        await userModel.updateUser(req.user.id, { password: newPassword });
        
        res.json({ message: 'Password updated successfully' });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Get user's API tokens
router.get('/tokens', authenticateToken, async (req, res) => {
    try {
        const tokens = await userModel.getUserApiTokens(req.user.id);
        res.json(tokens);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create new API token
router.post('/tokens', authenticateToken, async (req, res) => {
    try {
        const { name, expiresAt } = req.body;
        
        if (!name) {
            return res.status(400).json({ error: 'Token name is required' });
        }

        const token = await userModel.createApiToken(req.user.id, name, expiresAt);
        res.json(token);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Revoke API token
router.delete('/tokens/:tokenId', authenticateToken, async (req, res) => {
    try {
        const success = await userModel.revokeApiToken(req.params.tokenId, req.user.id);
        
        if (success) {
            res.json({ message: 'Token revoked successfully' });
        } else {
            res.status(404).json({ error: 'Token not found' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
