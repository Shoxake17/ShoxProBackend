// routes/auth.js — Autentifikatsiya Routelari (To'liq versiya)
const express = require('express');
const router  = express.Router();

const {
  register,
  login,
  logout,
  refreshToken,
  verifyEmail,
  forgotPassword,
  resetPassword,
  getMe
} = require('../controllers/authController');

const {
  googleCallback,
  googleRedirectCallback,
  googleSendCode,
  googleVerifyCode,
} = require('../controllers/googleController');



const {
  registerTemp,
  sendTelegramCode,
  verifyTelegramCode,
} = require('../controllers/telegramController');

const { protect } = require('../middleware/auth');

const {
  loginLimiter,
  registerLimiter,
  passwordResetLimiter,
  verifyCsrfToken
} = require('../middleware/security');

// ────────────────────────────────────────────
//  LOCAL AUTH
// ────────────────────────────────────────────

// POST /api/auth/register
// Eski to'g'ridan-to'g'ri register o'rniga vaqtinchalik saqlash
router.post('/register',
  registerLimiter,
  verifyCsrfToken,
  registerTemp
);
router.post('/google/send-code',   registerLimiter, googleSendCode);
router.post('/google/verify-code', registerLimiter, googleVerifyCode);

// POST /api/auth/login
router.post('/login',
  loginLimiter,
  verifyCsrfToken,
  login
);

// POST /api/auth/logout
router.post('/logout', logout);

// POST /api/auth/refresh
router.post('/refresh', refreshToken);

// ────────────────────────────────────────────
//  TELEGRAM GATEWAY VERIFICATION
// ────────────────────────────────────────────

// POST /api/auth/telegram/send-code
// Telefon raqamga Telegram orqali 6 xonali kod yuborish
router.post('/telegram/send-code',
  registerLimiter,
  sendTelegramCode
);

// POST /api/auth/telegram/verify-code
// Kodni tekshirish va foydalanuvchini yaratish
router.post('/telegram/verify-code',
  registerLimiter,
  verifyTelegramCode
);

// ────────────────────────────────────────────
//  EMAIL
// ────────────────────────────────────────────

// GET /api/auth/verify-email?token=...
router.get('/verify-email', verifyEmail);

// POST /api/auth/forgot-password
router.post('/forgot-password',
  passwordResetLimiter,
  forgotPassword
);

// POST /api/auth/reset-password
router.post('/reset-password',
  verifyCsrfToken,
  resetPassword
);

// ────────────────────────────────────────────
//  GOOGLE OAUTH 2.0
// ────────────────────────────────────────────

// POST /api/auth/google
router.post('/google',
  loginLimiter,
  verifyCsrfToken,
  googleCallback
);

// GET /api/auth/google/callback
router.get('/google/callback', googleRedirectCallback);

// ────────────────────────────────────────────
//  PROTECTED ROUTES
// ────────────────────────────────────────────

// GET /api/auth/me
router.get('/me', protect, getMe);

module.exports = router;