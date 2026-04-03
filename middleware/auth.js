// middleware/auth.js — JWT Tekshirish Middleware
const jwt  = require('jsonwebtoken');
const User = require('../models/User');

// ─── Asosiy Auth Middleware ───
const protect = async (req, res, next) => {
  try {
    let token;

    // 1. Tokenni topish: Authorization header yoki cookie
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies && req.cookies['access-token']) {
      token = req.cookies['access-token'];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Kirish uchun tizimga kiring'
      });
    }

    // 2. Tokenni Verify qilish
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          message: 'Sessiya muddati tugadi. Qayta kiring.',
          code: 'TOKEN_EXPIRED'
        });
      }
      return res.status(401).json({
        success: false,
        message: 'Noto\'g\'ri token'
      });
    }

    // 3. Foydalanuvchini bazadan topish
    const user = await User.findById(decoded.id).select('+isActive');
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Bu token uchun foydalanuvchi topilmadi'
      });
    }

    // 4. Hisob faolmi?
    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Hisobingiz to\'xtatilgan. Qo\'llab-quvvatlash bilan bog\'laning.'
      });
    }

    // 5. Request'ga foydalanuvchini biriktirish
    req.user = user;
    next();

  } catch (err) {
    console.error('Auth middleware xatosi:', err);
    res.status(500).json({
      success: false,
      message: 'Server xatosi'
    });
  }
};

// ─── Admin yoki Super Admin Tekshirish ───
const adminOnly = (req, res, next) => {
  if (req.user && (req.user.role === 'admin' || req.user.role === 'super-admin')) {
    return next();
  }
  return res.status(403).json({
    success: false,
    message: 'Ushbu amalni bajarish uchun Admin huquqi kerak'
  });
};

// ─── Faqat Super Admin Tekshirish ───
const superAdminOnly = (req, res, next) => {
  if (req.user && req.user.role === 'super-admin') {
    return next();
  }
  return res.status(403).json({
    success: false,
    message: 'Ushbu amalni bajarish uchun Super Admin huquqi kerak'
  });
};

// ─── Email Tasdiqlangan bo'lishi Shart ───
const requireVerifiedEmail = (req, res, next) => {
  if (req.user && req.user.isEmailVerified) {
    return next();
  }
  return res.status(403).json({
    success: false,
    message: 'Davom etish uchun emailingizni tasdiqlang',
    code: 'EMAIL_NOT_VERIFIED'
  });
};

module.exports = { protect, adminOnly, superAdminOnly, requireVerifiedEmail };