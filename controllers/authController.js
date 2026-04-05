// controllers/authController.js — Autentifikatsiya Controlleri
const jwt        = require('jsonwebtoken');
const crypto     = require('crypto');
const validator  = require('validator');
const User       = require('../models/User');
const { sendEmail } = require('../utils/email');

// ─── JWT Yaratish ───
const signAccessToken = (userId) =>
  jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: '15m', // 15 daqiqa
    issuer: 'secureauth',
    audience: 'secureauth-client'
  });

const signRefreshToken = (userId) =>
  jwt.sign({ id: userId }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: '30d', // 1 oy (30 kun)
    issuer: 'secureauth',
    audience: 'secureauth-client'
  });

// ─── Cookie orqali Token Yuborish ───
const sendTokenCookies = (res, userId) => {
  const accessToken  = signAccessToken(userId);
  const refreshToken = signRefreshToken(userId);

  const isProduction = process.env.NODE_ENV === 'production';

  // Access Token — 15 daqiqa
  res.cookie('access-token', accessToken, {
    httpOnly: true,
    secure: true,
    domain: isProduction ? '.shoxpro.uz' : undefined,
    sameSite: isProduction ? 'None' : 'Lax',
    maxAge: 15 * 60 * 1000 
  });

  // Refresh Token — 30 kun
  res.cookie('refresh-token', refreshToken, {
    httpOnly: true,
    secure: isProduction,
    domain: isProduction ? '.shoxpro.uz' : undefined,
    sameSite: isProduction ? 'None' : 'Strict',
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: '/api/auth/refresh'
  });

  return { accessToken };
};

// ══════════════════════════════════════
//  1. REGISTER
// ══════════════════════════════════════
exports.register = async (req, res) => {
  try {
    const { firstName, lastName, email, password, confirmPassword } = req.body;

    // ── Validatsiya ──
    if (!firstName || !lastName || !email || !password || !confirmPassword) {
      return res.status(400).json({ success: false, message: 'Barcha maydonlarni to\'ldiring' });
    }

    if (!validator.isEmail(email)) {
      return res.status(400).json({ success: false, message: 'Noto\'g\'ri email format' });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ success: false, message: 'Parollar mos kelmaydi' });
    }

    if (password.length < 8 || password.length > 128) {
      return res.status(400).json({ success: false, message: 'Parol 8–128 ta belgi bo\'lishi kerak' });
    }

    // Parol murakkablik tekshiruvi
    const strongPassword = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(password);
    if (!strongPassword) {
      return res.status(400).json({
        success: false,
        message: 'Parolda kichik harf, katta harf va raqam bo\'lishi kerak'
      });
    }

    // ── Email mavjudligi tekshiruvi ──
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      // Timing attack'ni oldini olish uchun bir xil javob
      return res.status(400).json({
        success: false,
        message: 'Bu email bilan hisob yaratib bo\'lmadi'
      });
    }

    // ── Foydalanuvchi Yaratish ──
    const userRole = (email.toLowerCase().trim() === 'turaxonovshoxrux14@gmail.com') ? 'super-admin' : 'user';

    const user = await User.create({
      firstName: firstName.trim(),
      lastName:  lastName.trim(),
      email:     email.toLowerCase().trim(),
      password,
      authProvider: 'local',
      role: userRole
    });

    // ── Email Tasdiqlash Tokeni ──
    const verifyToken = user.generateEmailVerificationToken();
    await user.save({ validateBeforeSave: false });

    // ── Tasdiqlash emaili yuborish ──
    const verifyUrl = `${process.env.CLIENT_URL}/verify-email?token=${verifyToken}`;
    try {
      await sendEmail({
        to:      user.email,
        subject: 'SecureAuth — Emailingizni tasdiqlang',
        html: `
          <h2>Salom, ${user.firstName}!</h2>
          <p>Hisobingizni faollashtirish uchun quyidagi tugmani bosing:</p>
          <a href="${verifyUrl}" style="background:#22d3a5;color:#000;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">
            Emailni Tasdiqlash
          </a>
          <p>Havola 24 soat davomida amal qiladi.</p>
          <p>Agar siz ro'yxatdan o'tmagan bo'lsangiz, bu emailni e'tiborsiz qoldiring.</p>
        `
      });
    } catch (emailErr) {
      console.error('Email yuborishda xato:', emailErr);
      // Email xatosi ro'yxatdan o'tishni to'xtatmasin
    }

    res.status(201).json({
      success: true,
      message: 'Hisob yaratildi! Emailingizni tasdiqlang.',
      data: {
        id:        user._id,
        firstName: user.firstName,
        lastName:  user.lastName,
        email:     user.email
      }
    });

  } catch (err) {
    console.error('Register xatosi:', err);
    if (err.code === 11000) {
      return res.status(400).json({ success: false, message: 'Bu email allaqachon ro\'yxatdan o\'tgan' });
    }
    res.status(500).json({ success: false, message: 'Server xatosi. Keyinroq urinib ko\'ring.' });
  }
};

// ══════════════════════════════════════
//  2. LOGIN
// ══════════════════════════════════════
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email va parol kiritilishi shart' });
    }

    if (!validator.isEmail(email)) {
      return res.status(400).json({ success: false, message: 'Noto\'g\'ri email format' });
    }

    // Parol fieldini ham olish (select: false bo'lgani uchun)
    const user = await User.findOne({ email: email.toLowerCase() })
      .select('+password +failedLoginAttempts +accountLockedUntil +isActive');

    // ── Timing-safe: foydalanuvchi topilmasa ham hash qilish ──
    if (!user) {
      await new Promise(r => setTimeout(r, 300 + Math.random() * 200));
      return res.status(401).json({
        success: false,
        message: 'Email yoki parol noto\'g\'ri'
      });
    }

    // ── Hisob bloklanganmi? ──
    if (user.isLocked()) {
      const remaining = Math.ceil((user.accountLockedUntil - Date.now()) / 1000 / 60);
      return res.status(423).json({
        success: false,
        message: `Hisob vaqtincha bloklangan. ${remaining} daqiqadan so'ng urinib ko'ring.`
      });
    }

    // ── Google OAuth hisobi uchun parol yo'q ──
    if (user.authProvider === 'google' && !user.password) {
      return res.status(400).json({
        success: false,
        message: 'Bu hisob Google orqali yaratilgan. Google bilan kiring.'
      });
    }

    // ── Parolni Tekshirish ──
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      await user.onLoginFail();
      const attemptsLeft = Math.max(0, 10 - user.failedLoginAttempts);
      return res.status(401).json({
        success: false,
        message: `Email yoki parol noto'g'ri. ${attemptsLeft > 0 ? `${attemptsLeft} ta urinish qoldi.` : 'Hisob bloklandi.'}`
      });
    }

    // ── Faolmi? ──
    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Hisobingiz to\'xtatilgan'
      });
    }

    // ── Muvaffaqiyatli login ──
    await user.onLoginSuccess();

    // ── Token va Cookie yuborish ──
    sendTokenCookies(res, user._id);

    res.status(200).json({
      success: true,
      message: 'Muvaffaqiyatli kirdingiz',
      data: {
        user: {
          id:              user._id,
          firstName:       user.firstName,
          lastName:        user.lastName,
          email:           user.email,
          isEmailVerified: user.isEmailVerified,
          role:            user.role,
          avatar:          user.avatar
        }
      }
    });

  } catch (err) {
    console.error('Login xatosi:', err);
    res.status(500).json({ success: false, message: 'Server xatosi' });
  }
};

// ══════════════════════════════════════
//  3. LOGOUT
// ══════════════════════════════════════
exports.logout = (req, res) => {
  res.clearCookie('access-token',  { path: '/' });
  res.clearCookie('refresh-token', { path: '/api/auth/refresh' });
  res.clearCookie('csrf-token',    { path: '/' });

  res.status(200).json({
    success: true,
    message: 'Muvaffaqiyatli chiqdingiz'
  });
};

// ══════════════════════════════════════
//  4. TOKEN YANGILASH (Refresh)
// ══════════════════════════════════════
exports.refreshToken = async (req, res) => {
  try {
    const refreshToken = req.cookies && req.cookies['refresh-token'];
    if (!refreshToken) {
      return res.status(401).json({ success: false, message: 'Refresh token topilmadi' });
    }

    let decoded;
    try {
      decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    } catch {
      return res.status(401).json({ success: false, message: 'Noto\'g\'ri refresh token' });
    }

    const user = await User.findById(decoded.id);
    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, message: 'Foydalanuvchi topilmadi' });
    }

    sendTokenCookies(res, user._id);
    res.status(200).json({ success: true });

  } catch (err) {
    console.error('Refresh token xatosi:', err);
    res.status(500).json({ success: false, message: 'Server xatosi' });
  }
};

// ══════════════════════════════════════
//  5. EMAIL TASDIQLASH
// ══════════════════════════════════════
exports.verifyEmail = async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) {
      return res.status(400).json({ success: false, message: 'Token kiritilishi shart' });
    }

    // Tokenni hash qilish va bazada qidirish
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const user = await User.findOne({
      emailVerificationToken:   hashedToken,
      emailVerificationExpires: { $gt: Date.now() }
    }).select('+emailVerificationToken +emailVerificationExpires');

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Token yaroqsiz yoki muddati tugagan'
      });
    }

    user.isEmailVerified          = true;
    user.emailVerificationToken   = undefined;
    user.emailVerificationExpires = undefined;
    await user.save({ validateBeforeSave: false });

    res.status(200).json({
      success: true,
      message: 'Email muvaffaqiyatli tasdiqlandi!'
    });

  } catch (err) {
    console.error('Email tasdiqlash xatosi:', err);
    res.status(500).json({ success: false, message: 'Server xatosi' });
  }
};

// ══════════════════════════════════════
//  6. PAROLNI TIKLASH SO'ROVI
// ══════════════════════════════════════
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !validator.isEmail(email)) {
      return res.status(400).json({ success: false, message: 'To\'g\'ri email kiriting' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    // Timing-safe: foydalanuvchi topilmasa ham muvaffaqiyat deyiladi
    // (foydalanuvchi enumeratsionini oldini olish)
    if (!user) {
      await new Promise(r => setTimeout(r, 500 + Math.random() * 300));
      return res.status(200).json({
        success: true,
        message: 'Agar bu email ro\'yxatdan o\'tgan bo\'lsa, tiklash havolasi yuborildi'
      });
    }

    const resetToken = user.generatePasswordResetToken();
    await user.save({ validateBeforeSave: false });

    const resetUrl = `${process.env.CLIENT_URL}/reset-password?token=${resetToken}`;
    try {
      await sendEmail({
        to:      user.email,
        subject: 'SecureAuth — Parolni tiklash',
        html: `
          <h2>Parolni tiklash</h2>
          <p>Siz parolni tiklash so'rovi yubordingiz. Quyidagi tugmani bosing:</p>
          <a href="${resetUrl}" style="background:#6c63ff;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">
            Parolni Tiklash
          </a>
          <p>Bu havola <strong>1 soat</strong> davomida amal qiladi.</p>
          <p>Agar siz so'rov yubormagan bo'lsangiz, bu emailni e'tiborsiz qoldiring.</p>
        `
      });
    } catch (emailErr) {
      user.passwordResetToken   = undefined;
      user.passwordResetExpires = undefined;
      await user.save({ validateBeforeSave: false });
      return res.status(500).json({ success: false, message: 'Email yuborishda xato' });
    }

    res.status(200).json({
      success: true,
      message: 'Parolni tiklash havolasi emailga yuborildi'
    });

  } catch (err) {
    console.error('Forgot password xatosi:', err);
    res.status(500).json({ success: false, message: 'Server xatosi' });
  }
};

// ══════════════════════════════════════
//  7. PAROLNI YANGILASH
// ══════════════════════════════════════
exports.resetPassword = async (req, res) => {
  try {
    const { token, password, confirmPassword } = req.body;

    if (!token || !password || !confirmPassword) {
      return res.status(400).json({ success: false, message: 'Barcha maydonlarni to\'ldiring' });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ success: false, message: 'Parollar mos kelmaydi' });
    }

    if (password.length < 8) {
      return res.status(400).json({ success: false, message: 'Parol kamida 8 ta belgi bo\'lishi kerak' });
    }

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const user = await User.findOne({
      passwordResetToken:   hashedToken,
      passwordResetExpires: { $gt: Date.now() }
    }).select('+passwordResetToken +passwordResetExpires');

    if (!user) {
      return res.status(400).json({ success: false, message: 'Token yaroqsiz yoki muddati tugagan' });
    }

    user.password             = password;
    user.passwordResetToken   = undefined;
    user.passwordResetExpires = undefined;
    user.failedLoginAttempts  = 0;
    user.accountLockedUntil   = null;
    await user.save();

    // Barcha sessiyalarni bekor qilish (cookie'larni tozalash)
    res.clearCookie('access-token');
    res.clearCookie('refresh-token');

    res.status(200).json({
      success: true,
      message: 'Parol muvaffaqiyatli yangilandi. Endi kiring.'
    });

  } catch (err) {
    console.error('Reset password xatosi:', err);
    res.status(500).json({ success: false, message: 'Server xatosi' });
  }
};

// ══════════════════════════════════════
//  8. JORIY FOYDALANUVCHI
// ══════════════════════════════════════
exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Foydalanuvchi topilmadi' });
    }
    res.status(200).json({ success: true, data: user.toSafeObject() });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server xatosi' });
  }
};

// ══════════════════════════════════════
//  9. EXCHANGE TICKET (Ilovalararo xavfsiz o'tish)
// ══════════════════════════════════════

// In-memory storage (Vaqtinchalik, Redis bo'lsa yaxshi)
const exchangeTickets = new Map();
const ticketResults   = new Map(); // Keshlangan natijalar (Double-call uchun)

// Har minutda eskirgan ticketlarni tozalash
setInterval(() => {
  const now = Date.now();
  for (const [id, data] of exchangeTickets.entries()) {
    if (data.expiresAt < now) exchangeTickets.delete(id);
  }
  // Keshni ham tozalash (masalan, 5 daqiqadan oshganlari)
  for (const [id, data] of ticketResults.entries()) {
    if (data.timestamp + 300000 < now) ticketResults.delete(id);
  }
}, 60000);

exports.createExchangeTicket = async (req, res) => {
  try {
    const ticketId = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 120 * 1000; // 2 daqiqa amal qiladi

    exchangeTickets.set(ticketId, {
      userId: req.user.id,
      expiresAt
    });

    res.status(200).json({
      success: true,
      ticket: ticketId
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server xatosi' });
  }
};

exports.exchangeTicket = async (req, res) => {
  try {
    const { ticket } = req.body;
    if (!ticket) {
      return res.status(400).json({ success: false, message: 'Ticket kiritilishi shart' });
    }

    // ─── DOUBLE-CALL (STRICT MODE) PROTECTION ───
    // Agar bu ticket allaqachon so'ralgan bo'lsa (oxirgi 10 soniya ichida), 
    // keshdagi javobni qaytaramiz (Xatolik bermaslik uchun)
    if (ticketResults.has(ticket)) {
      console.log('🛡️ [Backend] Ticket Double-call aniqlandi (Cached result yuborilmoqda)');
      return res.status(200).json(ticketResults.get(ticket).payload);
    }

    const data = exchangeTickets.get(ticket);
    if (!data || data.expiresAt < Date.now()) {
      if (data) exchangeTickets.delete(ticket);
      return res.status(400).json({ success: false, message: 'Ticket yaroqsiz yoki muddati tugagan' });
    }

    // Bir martalik ishlatish: asl ticketni darhol o'chiramiz
    exchangeTickets.delete(ticket);

    const user = await User.findById(data.userId);
    if (!user || !user.isActive) {
      return res.status(404).json({ success: false, message: 'Foydalanuvchi topilmadi' });
    }

    // Token va Cookie yuborish
    const { accessToken } = sendTokenCookies(res, user._id);

    const responsePayload = {
      success: true,
      data: {
        user: {
          id:              user._id,
          firstName:       user.firstName,
          lastName:        user.lastName,
          email:           user.email,
          isEmailVerified: user.isEmailVerified,
          role:            user.role,
          avatar:          user.avatar,
          cardNumber:      user.cardNumber
        },
        accessToken
      }
    };

    // ─── KESHGA SAQLASH (10 soniya davomida xavfsiz qayta chaqirish uchun) ───
    ticketResults.set(ticket, {
      payload: responsePayload,
      timestamp: Date.now()
    });
    // 10 soniyadan keyin keshdan o'chirib yuborish
    setTimeout(() => ticketResults.delete(ticket), 10000);

    res.status(200).json(responsePayload);
  } catch (err) {
    console.error('Exchange ticket xatosi:', err);
    res.status(500).json({ success: false, message: 'Server xatosi' });
  }
};