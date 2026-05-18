const express = require('express');
const router = express.Router();
const User = require('../models/User');
const GitService = require('../models/GitService');
const SettingsService = require('../services/SettingsService');
const GitLabClient = require('../services/GitLabClient');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const userModel = new User();
const gitService = new GitService();

gitService.initialize().catch(console.error);

// Get all users
router.get('/users', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const users = await userModel.getAllUsers();
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create new user
router.post('/users', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { username, password, email, role } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }

        const user = await userModel.create({ username, password, email, role });
        res.status(201).json(user);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Update user
router.put('/users/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { username, email, role, password } = req.body;
        const userId = parseInt(req.params.id);

        if (userId === req.user.id && role && role !== req.user.role) {
            return res.status(400).json({ error: 'Cannot change your own role' });
        }

        const updatedUser = await userModel.updateUser(userId, { username, email, role, password });
        res.json(updatedUser);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Delete user
router.delete('/users/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const userId = parseInt(req.params.id);

        if (userId === req.user.id) {
            return res.status(400).json({ error: 'Cannot delete your own account' });
        }

        const success = await userModel.deleteUser(userId);
        
        if (success) {
            res.json({ message: 'User deleted successfully' });
        } else {
            res.status(404).json({ error: 'User not found' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Add git repository
router.post('/repositories', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { name, path, url, description } = req.body;
        
        if (!name || !path) {
            return res.status(400).json({ error: 'Repository name and path are required' });
        }

        const repository = await gitService.addRepository(name, path, url, description);
        res.status(201).json(repository);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Get system stats
router.get('/stats', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const users = await userModel.getAllUsers();
        const repositories = await gitService.getRepositories();
        
        const stats = {
            totalUsers: users.length,
            adminUsers: users.filter(u => u.role === 'admin').length,
            regularUsers: users.filter(u => u.role === 'user').length,
            totalRepositories: repositories.length,
            activeRepositories: repositories.filter(r => r.is_active).length
        };

        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete a workspace (admin only)
router.delete('/workspaces/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (Number.isNaN(id)) {
            return res.status(400).json({ error: 'Invalid workspace id' });
        }
        const result = await gitService.deleteWorkspace(id);
        if (result.deleted) {
            res.json({ message: 'Workspace removed' });
        } else {
            res.status(404).json({ error: 'Workspace not found' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// App settings
router.get('/settings', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const settings = new SettingsService(gitService.db);
        const all = await settings.getAll();
        const scheduler = await gitService.db.get('SELECT * FROM scheduler_status WHERE id = 1');
        res.json({ settings: all, scheduler: scheduler || {} });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.put('/settings', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const settings = new SettingsService(gitService.db);
        const updated = await settings.setMany(req.body);
        const Scheduler = require('../services/Scheduler');
        res.json({ settings: updated, message: 'Settings saved. Restart or wait for scheduler reschedule on next interval.' });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// GitLab integration
router.get('/gitlab', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const client = new GitLabClient(gitService.db);
        const integration = await client.getIntegration();
        if (integration && integration.private_token) {
            integration.private_token = '********';
        }
        res.json(integration || { enabled: false });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.put('/gitlab', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const client = new GitLabClient(gitService.db);
        const { baseUrl, privateToken, enabled } = req.body;
        const row = await client.saveIntegration({
            baseUrl: baseUrl,
            privateToken: privateToken,
            enabled: !!enabled
        });
        res.json(row);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

router.post('/gitlab/test', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const client = new GitLabClient(gitService.db);
        const { baseUrl, privateToken, enabled } = req.body || {};
        const result = await client.testConnection({ baseUrl, privateToken, enabled });
        res.json(result);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

router.post('/gitlab/sync-users', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const client = new GitLabClient(gitService.db);
        const { baseUrl, privateToken, enabled } = req.body || {};
        const result = await client.syncUsers({ baseUrl, privateToken, enabled });
        res.json(result);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

router.get('/gitlab/users', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const client = new GitLabClient(gitService.db);
        const users = await client.listCachedUsers();
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
