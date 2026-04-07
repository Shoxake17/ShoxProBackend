// controllers/authController.js
'use strict';

const jwt       = require('jsonwebtoken');
const crypto    = require('crypto');
const validator = require('validator');
const User      = require('../models/User');
const { sendEmail } = require('../utils/email');

// ══════════════════════════════════════
//  JWT YARATISH
// ══════════════════════════════════════
const signAccessToken = (userId) =>
  jwt.sign(
    { id: userId },
    process.env.JWT_SECRET,
    { expiresIn: '15m', issuer: 'shoxpay', audience: 'shoxpay-client' }
  );

const signRefreshToken = (userId) =>
  jwt.sign(
    { id: userId },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: '30d', issuer: 'shoxpay', audience: 'shoxpay-client' }
  );

// ══════════════════════════════════════
//  COOKIE O'RNATISH
//  ✅ ASOSIY TUZATISH: COOKIE_DOMAIN .env dan olinadi
//  Dev serverlarda ham cross-subdomain ishlashi uchun
// ══════════════════════════════════════
const sendTokenCookies = (res, userId) => {
  const accessToken  = signAccessToken(userId);
  const refreshToken = signRefreshToken(userId);

  // .env da belgilang:
  // COOKIE_DOMAIN=.shoxpro.uz  (dev va prod ikkalasida ham)
  const cookieDomain = process.env.COOKIE_DOMAIN || undefined;

  // COOKIE_DOMAIN bo'lsa cross-origin — secure + sameSite=None kerak
  // Bo'lmasa localhost — secure=false + sameSite=Lax
  const isSecure   = !!cookieDomain;
  const sameSite   = cookieDomain ? 'None' : 'Lax';

  console.log(`🍪 Cookie o'rnatilmoqda | domain: ${cookieDomain} | secure: ${isSecure} | sameSite: ${sameSite}`);

  res.cookie('access-token', accessToken, {
    httpOnly: true,
    secure:   isSecure,
    domain:   cookieDomain,
    sameSite: sameSite,
    maxAge:   15 * 60 * 1000, // 15 daqiqa
    path:     '/',
  });

  res.cookie('refresh-token', refreshToken, {
    httpOnly: true,
    secure:   isSecure,
    domain:   cookieDomain,
    sameSite: sameSite,
    maxAge:   30 * 24 * 60 * 60 * 1000, // 30 kun
    path:     '/api/auth/refresh',
  });

  return { accessToken };
};

// ══════════════════════════════════════
//  1. REGISTER
// ══════════════════════════════════════
exports.register = async (req, res) => {
  try {
    const { firstName, lastName, email, password, confirmPassword } = req.body;

    if (!firstName || !lastName || !email || !password || !confirmPassword) {
      return res.status(400).json({ success: false, message: "Barcha maydonlarni to'ldiring" });
    }
    if (!validator.isEmail(email)) {
      return res.status(400).json({ success: false, message: "Noto'g'ri email format" });
    }
    if (password !== confirmPassword) {
      return res.status(400).json({ success: false, message: "Parollar mos kelmaydi" });
    }
    if (password.length < 8 || password.length > 128) {
      return res.status(400).json({ success: false, message: "Parol 8–128 ta belgi bo'lishi kerak" });
    }
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(password)) {
      return res.status(400).json({
        success: false,
        message: "Parolda kichik harf, katta harf va raqam bo'lishi kerak",
      });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ success: false, message: "Bu email bilan hisob yaratib bo'lmadi" });
    }

    const role = email.toLowerCase().trim() === 'turaxonovshoxrux14@gmail.com'
      ? 'super-admin' : 'user';

    const user = await User.create({
      firstName:    firstName.trim(),
      lastName:     lastName.trim(),
      email:        email.toLowerCase().trim(),
      password,
      authProvider: 'local',
      role,
    });

    const verifyToken = user.generateEmailVerificationToken();
    await user.save({ validateBeforeSave: false });

    const verifyUrl = `${process.env.CLIENT_URL}/verify-email?token=${verifyToken}`;
    try {
      await sendEmail({
        to:      user.email,
        subject: 'ShoxPay — Emailingizni tasdiqlang',
        html: `
          <h2>Salom, ${user.firstName}!</h2>
          <p>Hisobingizni faollashtirish uchun tugmani bosing:</p>
          <a href="${verifyUrl}" style="background:#6366f1;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">
            Emailni Tasdiqlash
          </a>
          <p>Havola 24 soat davomida amal qiladi.</p>
        `,
      });
    } catch (emailErr) {
      console.error('Email yuborishda xato:', emailErr.message);
    }

    res.status(201).json({
      success: true,
      message: "Hisob yaratildi! Emailingizni tasdiqlang.",
      data: {
        id:        user._id,
        firstName: user.firstName,
        lastName:  user.lastName,
        email:     user.email,
      },
    });

  } catch (err) {
    console.error('Register xatosi:', err);
    if (err.code === 11000) {
      return res.status(400).json({ success: false, message: "Bu email allaqachon ro'yxatdan o'tgan" });
    }
    res.status(500).json({ success: false, message: "Server xatosi. Keyinroq urinib ko'ring." });
  }
};

// ══════════════════════════════════════
//  2. LOGIN
// ══════════════════════════════════════
exports.login = async (req, res) => {
  try {
    console.log('🔍 LOGIN | NODE_ENV:', process.env.NODE_ENV, '| COOKIE_DOMAIN:', process.env.COOKIE_DOMAIN);

    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email va parol kiritilishi shart" });
    }
    if (!validator.isEmail(email)) {
      return res.status(400).json({ success: false, message: "Noto'g'ri email format" });
    }

    const user = await User.findOne({ email: email.toLowerCase() })
      .select('+password +failedLoginAttempts +accountLockedUntil +isActive');

    if (!user) {
      await new Promise(r => setTimeout(r, 300 + Math.random() * 200));
      return res.status(401).json({ success: false, message: "Email yoki parol noto'g'ri" });
    }

    if (user.isLocked && user.isLocked()) {
      const remaining = Math.ceil((user.accountLockedUntil - Date.now()) / 60000);
      return res.status(423).json({
        success: false,
        message: `Hisob vaqtincha bloklangan. ${remaining} daqiqadan so'ng urinib ko'ring.`,
      });
    }

    if (user.authProvider === 'google' && !user.password) {
      return res.status(400).json({
        success: false,
        message: "Bu hisob Google orqali yaratilgan. Google bilan kiring.",
      });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      if (user.onLoginFail) await user.onLoginFail();
      const attemptsLeft = Math.max(0, 10 - (user.failedLoginAttempts || 0));
      return res.status(401).json({
        success: false,
        message: `Email yoki parol noto'g'ri. ${attemptsLeft > 0 ? `${attemptsLeft} ta urinish qoldi.` : 'Hisob bloklandi.'}`,
      });
    }

    if (!user.isActive) {
      return res.status(403).json({ success: false, message: "Hisobingiz to'xtatilgan" });
    }

    if (user.onLoginSuccess) await user.onLoginSuccess();

    sendTokenCookies(res, user._id);
    console.log('✅ Cookie o\'rnatildi | userId:', user._id);

    res.status(200).json({
      success: true,
      message: "Muvaffaqiyatli kirdingiz",
      user: {
        _id:             user._id,
        firstName:       user.firstName,
        lastName:        user.lastName,
        email:           user.email,
        isEmailVerified: user.isEmailVerified,
        role:            user.role,
        avatar:          user.avatar || null,
      },
    });

  } catch (err) {
    console.error('Login xatosi:', err);
    res.status(500).json({ success: false, message: "Server xatosi" });
  }
};

// ══════════════════════════════════════
//  3. LOGOUT
// ══════════════════════════════════════
exports.logout = (req, res) => {
  const cookieDomain = process.env.COOKIE_DOMAIN || undefined;
  const isSecure     = !!cookieDomain;
  const sameSite     = cookieDomain ? 'None' : 'Lax';

  res.clearCookie('access-token', {
    httpOnly: true,
    secure:   isSecure,
    domain:   cookieDomain,
    sameSite: sameSite,
    path:     '/',
  });
  res.clearCookie('refresh-token', {
    httpOnly: true,
    secure:   isSecure,
    domain:   cookieDomain,
    sameSite: sameSite,
    path:     '/api/auth/refresh',
  });
  res.clearCookie('csrf-token', { path: '/' });

  res.status(200).json({ success: true, message: "Muvaffaqiyatli chiqdingiz" });
};

// ══════════════════════════════════════
//  4. TOKEN YANGILASH (Refresh)
// ══════════════════════════════════════
exports.refreshToken = async (req, res) => {
  try {
    const refreshToken = req.cookies?.['refresh-token'];

    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        message: "Refresh token topilmadi",
        code:    'NO_REFRESH_TOKEN',
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET, {
        issuer:   'shoxpay',
        audience: 'shoxpay-client',
      });
    } catch {
      return res.status(401).json({
        success: false,
        message: "Noto'g'ri yoki muddati tugagan refresh token",
        code:    'INVALID_REFRESH_TOKEN',
      });
    }

    const user = await User.findById(decoded.id).select('+isActive');
    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, message: "Foydalanuvchi topilmadi" });
    }

    sendTokenCookies(res, user._id);
    res.status(200).json({ success: true });

  } catch (err) {
    console.error('Refresh token xatosi:', err);
    res.status(500).json({ success: false, message: "Server xatosi" });
  }
};

// ══════════════════════════════════════
//  5. EMAIL TASDIQLASH
// ══════════════════════════════════════
exports.verifyEmail = async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) {
      return res.status(400).json({ success: false, message: "Token kiritilishi shart" });
    }

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    const user = await User.findOne({
      emailVerificationToken:   hashedToken,
      emailVerificationExpires: { $gt: Date.now() },
    }).select('+emailVerificationToken +emailVerificationExpires');

    if (!user) {
      return res.status(400).json({ success: false, message: "Token yaroqsiz yoki muddati tugagan" });
    }

    user.isEmailVerified          = true;
    user.emailVerificationToken   = undefined;
    user.emailVerificationExpires = undefined;
    await user.save({ validateBeforeSave: false });

    res.status(200).json({ success: true, message: "Email muvaffaqiyatli tasdiqlandi!" });

  } catch (err) {
    console.error('Email tasdiqlash xatosi:', err);
    res.status(500).json({ success: false, message: "Server xatosi" });
  }
};

// ══════════════════════════════════════
//  6. PAROLNI TIKLASH SO'ROVI
// ══════════════════════════════════════
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !validator.isEmail(email)) {
      return res.status(400).json({ success: false, message: "To'g'ri email kiriting" });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      await new Promise(r => setTimeout(r, 500 + Math.random() * 300));
      return res.status(200).json({
        success: true,
        message: "Agar bu email ro'yxatdan o'tgan bo'lsa, tiklash havolasi yuborildi",
      });
    }

    const resetToken = user.generatePasswordResetToken();
    await user.save({ validateBeforeSave: false });

    const resetUrl = `${process.env.CLIENT_URL}/reset-password?token=${resetToken}`;
    try {
      await sendEmail({
        to:      user.email,
        subject: 'ShoxPay — Parolni tiklash',
        html: `
          <h2>Parolni tiklash</h2>
          <p>Quyidagi tugmani bosing:</p>
          <a href="${resetUrl}" style="background:#6366f1;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">
            Parolni Tiklash
          </a>
          <p>Havola <strong>1 soat</strong> davomida amal qiladi.</p>
        `,
      });
    } catch (emailErr) {
      user.passwordResetToken   = undefined;
      user.passwordResetExpires = undefined;
      await user.save({ validateBeforeSave: false });
      return res.status(500).json({ success: false, message: "Email yuborishda xato" });
    }

    res.status(200).json({ success: true, message: "Parolni tiklash havolasi emailga yuborildi" });

  } catch (err) {
    console.error('Forgot password xatosi:', err);
    res.status(500).json({ success: false, message: "Server xatosi" });
  }
};

// ══════════════════════════════════════
//  7. PAROLNI YANGILASH
// ══════════════════════════════════════
exports.resetPassword = async (req, res) => {
  try {
    const { token, password, confirmPassword } = req.body;

    if (!token || !password || !confirmPassword) {
      return res.status(400).json({ success: false, message: "Barcha maydonlarni to'ldiring" });
    }
    if (password !== confirmPassword) {
      return res.status(400).json({ success: false, message: "Parollar mos kelmaydi" });
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, message: "Parol kamida 8 ta belgi bo'lishi kerak" });
    }

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    const user = await User.findOne({
      passwordResetToken:   hashedToken,
      passwordResetExpires: { $gt: Date.now() },
    }).select('+passwordResetToken +passwordResetExpires');

    if (!user) {
      return res.status(400).json({ success: false, message: "Token yaroqsiz yoki muddati tugagan" });
    }

    user.password             = password;
    user.passwordResetToken   = undefined;
    user.passwordResetExpires = undefined;
    user.failedLoginAttempts  = 0;
    user.accountLockedUntil   = null;
    await user.save();

    const cookieDomain = process.env.COOKIE_DOMAIN || undefined;
    res.clearCookie('access-token',  { path: '/', domain: cookieDomain });
    res.clearCookie('refresh-token', { path: '/api/auth/refresh', domain: cookieDomain });

    res.status(200).json({ success: true, message: "Parol muvaffaqiyatli yangilandi. Endi kiring." });

  } catch (err) {
    console.error('Reset password xatosi:', err);
    res.status(500).json({ success: false, message: "Server xatosi" });
  }
};

// ══════════════════════════════════════
//  8. JORIY FOYDALANUVCHI (/api/auth/me)
// ══════════════════════════════════════
exports.getMe = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const user   = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ success: false, message: "Foydalanuvchi topilmadi" });
    }

    res.status(200).json({
      success: true,
      data: user.toSafeObject ? user.toSafeObject() : {
        _id:             user._id,
        firstName:       user.firstName,
        lastName:        user.lastName,
        email:           user.email,
        role:            user.role,
        isEmailVerified: user.isEmailVerified,
        avatar:          user.avatar || null,
        cardNumber:      user.cardNumber || null,
      },
    });

  } catch (err) {
    console.error('getMe xatosi:', err);
    res.status(500).json({ success: false, message: "Server xatosi" });
  }
};

// ══════════════════════════════════════
//  9. EXCHANGE TICKET
// ══════════════════════════════════════
const exchangeTickets = new Map();
const ticketResults   = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [id, data] of exchangeTickets) {
    if (data.expiresAt < now) exchangeTickets.delete(id);
  }
  for (const [id, data] of ticketResults) {
    if (data.timestamp + 300_000 < now) ticketResults.delete(id);
  }
}, 60_000);

exports.createExchangeTicket = async (req, res) => {
  try {
    const ticketId  = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 120_000;

    exchangeTickets.set(ticketId, {
      userId: req.user._id || req.user.id,
      expiresAt,
    });

    res.status(200).json({ success: true, ticket: ticketId });

  } catch (err) {
    console.error('createExchangeTicket xatosi:', err);
    res.status(500).json({ success: false, message: "Server xatosi" });
  }
};

exports.exchangeTicket = async (req, res) => {
  try {
    const { ticket } = req.body;
    if (!ticket) {
      return res.status(400).json({ success: false, message: "Ticket kiritilishi shart" });
    }

    if (ticketResults.has(ticket)) {
      console.log('🛡️ Ticket double-call — kesh javob yuborildi');
      return res.status(200).json(ticketResults.get(ticket).payload);
    }

    const data = exchangeTickets.get(ticket);
    if (!data || data.expiresAt < Date.now()) {
      if (data) exchangeTickets.delete(ticket);
      return res.status(400).json({ success: false, message: "Ticket yaroqsiz yoki muddati tugagan" });
    }

    exchangeTickets.delete(ticket);

    const user = await User.findById(data.userId);
    if (!user || !user.isActive) {
      return res.status(404).json({ success: false, message: "Foydalanuvchi topilmadi" });
    }

    sendTokenCookies(res, user._id);

    const responsePayload = {
      success: true,
      data: {
        user: {
          _id:             user._id,
          firstName:       user.firstName,
          lastName:        user.lastName,
          email:           user.email,
          isEmailVerified: user.isEmailVerified,
          role:            user.role,
          avatar:          user.avatar || null,
          cardNumber:      user.cardNumber || null,
        },
      },
    };

    ticketResults.set(ticket, { payload: responsePayload, timestamp: Date.now() });
    setTimeout(() => ticketResults.delete(ticket), 10_000);

    res.status(200).json(responsePayload);

  } catch (err) {
    console.error('exchangeTicket xatosi:', err);
    res.status(500).json({ success: false, message: "Server xatosi" });
  }
};

// ✅ googleController import qilishi uchun
module.exports.sendTokenCookies = sendTokenCookies;