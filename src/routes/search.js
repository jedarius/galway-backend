// routes/search.js - Clean minimal version
const express = require('express');
const { ResponseWrapper } = require('../middleware/errorHandler');

const router = express.Router();

console.log('🔍 Minimal Search routes loaded!');

router.get('/test', (req, res) => {
  ResponseWrapper.success(res, {
    message: 'Search system is working!',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;