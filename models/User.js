const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const Database = require('../config/database');

class User {
    constructor() {
        this.db = new Database();
        this.dbReady = this.db.connect();
    }

    async ensureDbReady() {
        await this.dbReady;
    }

    async create(userData) {
        await this.ensureDbReady();
        const { username, password, email, role = 'user' } = userData;
        
        if (!username || !password) {
            throw new Error('Username and password are required');
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        
        try {
            const result = await this.db.run(
                'INSERT INTO users (username, password, email, role) VALUES (?, ?, ?, ?)',
                [username, hashedPassword, email, role]
            );

            return await this.findById(result.id);
        } catch (error) {
            if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                throw new Error('Username or email already exists');
            }
            throw error;
        }
    }

    async findById(id) {
        await this.ensureDbReady();
        const user = await this.db.get(
            'SELECT id, username, email, role, created_at, updated_at FROM users WHERE id = ?',
            [id]
        );
        return user;
    }

    async findByUsername(username) {
        await this.ensureDbReady();
        const user = await this.db.get(
            'SELECT * FROM users WHERE username = ?',
            [username]
        );
        return user;
    }

    async authenticate(username, password) {
        const user = await this.findByUsername(username);
        if (!user) {
            throw new Error('Invalid credentials');
        }

        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) {
            throw new Error('Invalid credentials');
        }

        const token = jwt.sign(
            { userId: user.id, username: user.username, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        return {
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                role: user.role
            },
            token
        };
    }

    async getAllUsers() {
        await this.ensureDbReady();
        const users = await this.db.all(
            'SELECT id, username, email, role, created_at, updated_at FROM users ORDER BY created_at DESC'
        );
        return users;
    }

    async updateUser(id, updates) {
        await this.ensureDbReady();
        const { username, email, role, password } = updates;
        const params = [];
        const setParts = [];

        if (username) {
            setParts.push('username = ?');
            params.push(username);
        }
        if (email) {
            setParts.push('email = ?');
            params.push(email);
        }
        if (role) {
            setParts.push('role = ?');
            params.push(role);
        }
        if (password) {
            const hashedPassword = await bcrypt.hash(password, 10);
            setParts.push('password = ?');
            params.push(hashedPassword);
        }

        setParts.push('updated_at = CURRENT_TIMESTAMP');
        params.push(id);

        if (setParts.length === 1) {
            throw new Error('No valid fields to update');
        }

        await this.db.run(
            `UPDATE users SET ${setParts.join(', ')} WHERE id = ?`,
            params
        );

        return await this.findById(id);
    }

    async deleteUser(id) {
        await this.ensureDbReady();
        const result = await this.db.run('DELETE FROM users WHERE id = ?', [id]);
        return result.changes > 0;
    }

    async createApiToken(userId, tokenName, expiresAt = null) {
        await this.ensureDbReady();
        const token = uuidv4();
        
        const result = await this.db.run(
            'INSERT INTO api_tokens (user_id, token, name, expires_at) VALUES (?, ?, ?, ?)',
            [userId, token, tokenName, expiresAt]
        );

        return {
            id: result.id,
            token,
            name: tokenName,
            expires_at: expiresAt,
            created_at: new Date().toISOString()
        };
    }

    async getUserApiTokens(userId) {
        await this.ensureDbReady();
        const tokens = await this.db.all(
            'SELECT id, name, expires_at, created_at, is_active FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC',
            [userId]
        );
        return tokens;
    }

    async revokeApiToken(tokenId, userId) {
        await this.ensureDbReady();
        const result = await this.db.run(
            'UPDATE api_tokens SET is_active = 0 WHERE id = ? AND user_id = ?',
            [tokenId, userId]
        );
        return result.changes > 0;
    }
}

module.exports = User;
