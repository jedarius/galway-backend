// src/server.js
// Galway Research Institute - Main Express Server

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const morgan = require('morgan');

// Import routes
const authRoutes = require('./routes/auth');
const oliveBranchRoutes = require('./routes/oliveBranches');
const registrationBranchRoutes = require('./routes/registrationBranches');
console.log('🔍 Registration routes loaded:', typeof registrationBranchRoutes);;

// Import middleware
const errorHandler = require('./middleware/errorHandler');
const authMiddleware = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

// CORS configuration
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later.',
    code: 'RATE_LIMIT_EXCEEDED',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Compression middleware
app.use(compression());

// Logging middleware
if (process.env.NODE_ENV === 'production') {
  app.use(morgan('combined'));
} else {
  app.use(morgan('dev'));
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
    version: process.env.npm_package_version || '1.0.0',
  });
});

// API version endpoint
app.get('/api', (req, res) => {
  res.json({
    message: 'Galway Research Institute API',
    version: '1.0.0',
    documentation: '/api/docs',
    status: 'operational',
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/olive-branches', oliveBranchRoutes);
app.use('/api/registration', registrationBranchRoutes);
console.log('🔍 Registration routes mounted at /api/registration');

// TODO: Add other routes as they're created
// app.use('/api/users', userRoutes);
// app.use('/api/inventory', inventoryRoutes);
// app.use('/api/trades', tradeRoutes);
// app.use('/api/forum', forumRoutes);
// app.use('/api/achievements', achievementRoutes);
// app.use('/api/leaderboards', leaderboardRoutes);
// app.use('/api/notifications', notificationRoutes);

// Protected admin routes (commented out for now)
// app.use('/api/admin', authMiddleware.requireAuth, authMiddleware.requireRole(['admin']), adminRoutes);

// Debug: List all registered routes
console.log('🔍 All registered routes:');
app._router.stack.forEach(function(r){
  if (r.route && r.route.path){
    console.log('  Route:', r.route.path);
  } else if (r.name === 'router') {
    console.log('  Router mounted at:', r.regexp.source);
  }
});

// 404 handler for undefined routes
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Route not found',
    message: `The endpoint ${req.method} ${req.originalUrl} does not exist`,
    code: 'ROUTE_NOT_FOUND',
  });
});

// Global error handler (must be last)
app.use(errorHandler);

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
    process.exit(0);
  });
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`
🌿 Galway Research Institute API Server Started
📍 Environment: ${process.env.NODE_ENV || 'development'}
🌐 Server running on port ${PORT}
🔗 Health check: http://localhost:${PORT}/health
📚 API documentation: http://localhost:${PORT}/api
⏰ Started at: ${new Date().toISOString()}
  `);
});

module.exports = app;