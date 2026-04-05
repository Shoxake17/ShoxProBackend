// middleware/security.js — Xavfsizlik middleware'lari
const helmet        = require('helmet');
const cors          = require('cors');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const crypto        = require('crypto');

// ─── 1. HELMET — HTTP Security Headers ───
const helmetConfig = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'", 'https://accounts.google.com', 'https://www.gstatic.com'],
      styleSrc:    ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc:     ["'self'", 'https://fonts.gstatic.com'],
      imgSrc:      ["'self'", 'data:', 'https://lh3.googleusercontent.com'],
      connectSrc:  ["'self'", 'https://dev-api.shoxpro.uz', 'wss://dev-api.shoxpro.uz', 'https://dev-pay.shoxpro.uz', 'https://dev-game.shoxpro.uz', 'https://dev-admin-game.shoxpro.uz', 'https://dev-super.shoxpro.uz'],
      frameSrc:    ["'none'"],
      objectSrc:   ["'none'"],
      upgradeInsecureRequests: [],
    }
  },
  crossOriginEmbedderPolicy: false,
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  xFrameOptions: { action: 'deny' },
  xContentTypeOptions: true,
  xXssProtection: true
});

// ─── 2. CORS — Cross-Origin Resource Sharing ───
const corsConfig = cors({
  origin: (origin, callback) => {
    const allowed = (process.env.CLIENT_URL || '').split(',');
    if (!origin || allowed.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: ${origin} ruxsat etilmagan`));
    }
  },
  methods:        ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  credentials:    true,
  maxAge:         86400
});

// ─── 3. RATE LIMITERS ───

// Login: 100 ta urinish / 15 daqiqa (Development uchun oshirildi)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 5 : 100,
  message: {
    success: false,
    message: 'Juda kop urinish. Keyinroq qayta urinib koring.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req, res) => {
    const email = (req.body && req.body.email) ? req.body.email.toLowerCase() : '';
    return `${ipKeyGenerator(req, res)}:${email}`;
  }
});

// Register: 100 ta urinish / 30 daqiqa (Development uchun oshirildi)
const registerLimiter = rateLimit({
  windowMs: 30 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 3 : 100,
  message: {
    success: false,
    message: 'Royxatdan otish cheklandi. Keyinroq qayta urinib koring.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req, res) => ipKeyGenerator(req, res)
});

// Umumiy API: 1000 ta sorov / 15 daqiqa (Development uchun oshirildi)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 500 : 2000, // Productionda 500, Devda 2000
  message: {
    success: false,
    message: 'Juda kop sorov. Keyinroq urinib koring.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Password reset: 3 ta urinish / 1 soat
const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: {
    success: false,
    message: 'Parol tiklash sorovlari chegarasi oshdi. 1 soatdan song qayta urinib koring.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// ─── 4. MONGO SANITIZE — NoSQL Injection himoyasi ───
// YANGI — shu bilan almashtiring:
const sanitizeConfig = (req, res, next) => {
  const clean = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    for (const key of Object.keys(obj)) {
      if (key.startsWith('$') || key.includes('.')) {
        console.warn(`⚠️ NoSQL Injection urinishi: ${req.ip} — key: ${key}`);
        delete obj[key];
      } else if (typeof obj[key] === 'object') {
        clean(obj[key]);
      }
    }
  };
  if (req.body)   clean(req.body);
  if (req.params) clean(req.params);
  next();
};

// ─── 5. CSRF TOKEN — Double Submit Cookie Pattern ───
const generateCsrfToken = (req, res, next) => {
  if (!req.cookies || !req.cookies['csrf-token']) {
    const token = crypto.randomBytes(32).toString('hex');
    res.cookie('csrf-token', token, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Strict',
      maxAge: 24 * 60 * 60 * 1000
    });
  }
  next();
};

// YANGI:
const verifyCsrfToken = (req, res, next) => {
  // Development da CSRF tekshiruvini o'tkazib yuborish
  if (process.env.NODE_ENV === 'development') return next();

  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  const cookieToken = req.cookies && req.cookies['csrf-token'];
  const headerToken = req.headers['x-csrf-token'] || (req.body && req.body._csrf);

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({
      success: false,
      message: 'CSRF token tekshiruvi muvaffaqiyatsiz'
    });
  }
  next();
};

// ─── 6. XSS PREVENTION — Input tozalash ───
const sanitizeInput = (req, res, next) => {
  const sanitize = (obj) => {
    if (typeof obj !== 'object' || obj === null) return;
    for (const key of Object.keys(obj)) {
      if (typeof obj[key] === 'string') {
        obj[key] = obj[key]
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#x27;')
          .replace(/\//g, '&#x2F;');
      } else if (typeof obj[key] === 'object') {
        sanitize(obj[key]);
      }
    }
  };
  sanitize(req.body);
  sanitize(req.query);
  next();
};

// ─── 7. Xavfsizlik Loglash ───
const securityLogger = (req, res, next) => {
  if (process.env.NODE_ENV !== 'production') return next();

  const sensitiveRoutes = ['/api/auth/login', '/api/auth/register', '/api/auth/reset-password'];
  if (sensitiveRoutes.includes(req.path)) {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} --- IP: ${req.ip}`);
  }
  next();
};

module.exports = {
  helmetConfig,
  corsConfig,
  loginLimiter,
  registerLimiter,
  apiLimiter,
  passwordResetLimiter,
  sanitizeConfig,
  generateCsrfToken,
  verifyCsrfToken,
  sanitizeInput,
  securityLogger
};