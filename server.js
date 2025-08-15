const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

const Database = require('./config/database');
const { setupGraphQL } = require('./routes/graphql');

// Import routes
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const gitRoutes = require('./routes/git');

const app = express();
const PORT = process.env.PORT || 3201;

// Initialize database
const db = new Database();

// Security middleware
app.use(helmet({
    contentSecurityPolicy: false // Allow inline scripts for development
}));

app.use(cors());

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000 // limit each IP to 1000 requests per windowMs
});
app.use('/api', limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Static files
app.use(express.static('public'));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/git', gitRoutes);

// (Moved catch-all and error handler below, after GraphQL setup)

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\nShutting down gracefully...');
    await db.close();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\nShutting down gracefully...');
    await db.close();
    process.exit(0);
});

// Start server
const startServer = async () => {
    try {
        // Initialize database
        await db.connect();
        console.log('Database connected successfully');

        // Initialize GraphQL endpoint
        await setupGraphQL(app);

        // Serve the main HTML file for all routes (SPA) AFTER GraphQL
        app.get('*', (req, res) => {
            res.sendFile(path.join(__dirname, 'views', 'index.html'));
        });

        // Error handling middleware (keep last)
        app.use((err, req, res, next) => {
            console.error(err.stack);
            res.status(500).json({ 
                error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error' 
            });
        });

        app.listen(PORT, () => {
            console.log(`🚀 Git Insider server running on port ${PORT}`);
            console.log(`🌐 Open http://localhost:${PORT} in your browser`);
            console.log('📊 Ready to analyze your Git repositories!');
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
};

startServer();
