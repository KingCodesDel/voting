// middleware/rateLimiter.js
// Rate limiters to prevent abuse: brute-forcing admin login, and
// hammering the voting endpoint (bot / script based ballot stuffing).

const rateLimit = require('express-rate-limit');

// Generic API limiter - generous, just to stop obvious abuse.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down and try again shortly.' }
});

// Strict limiter for admin login attempts.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' }
});

// Strict limiter for the vote-casting endpoint.
const voteLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many voting attempts from this connection. Please try again later.' }
});

module.exports = { apiLimiter, loginLimiter, voteLimiter };
