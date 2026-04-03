// controllers/telegramController.js
const axios  = require('axios');
const crypto = require('crypto');
const jwt    = require('jsonwebtoken'); // ✅ jsonwebtoken ni import qilish
const User   = require('../models/User');

const tempUsers = new Map();

// ─── Token yaratish funksiyalari (authController dan ko'chirildi) ─────────────
const signAccessToken = (userId) =>
  jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '1h',
    issuer:   'secureauth',
    audience: 'secureauth-client',
  });

const signRefreshToken = (userId) =>
  jwt.sign({ id: userId }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
    issuer:   'secureauth',
    audience: 'secureauth-client',
  });

// ─── STEP 1: Register ─────────────────────────────────────────────────────────
exports.registerTemp = async (req, res) => {
  try {
    const { firstName, lastName, email, password, confirmPassword } = req.body;

    if (!firstName?.trim())
      return res.status(400).json({ success: false, message: 'Ism kiritilishi shart' });
    if (!email)
      return res.status(400).json({ success: false, message: 'Email kiritilishi shart' });
    if (!password || password.length < 8)
      return res.status(400).json({ success: false, message: "Parol kamida 8 ta belgidan iborat bo'lishi kerak" });
    if (password !== confirmPassword)
      return res.status(400).json({ success: false, message: 'Parollar mos kelmadi' });

    const existingUser = await User.findOne({ email: email.toLowerCase().trim() });
    if (existingUser)
      return res.status(400).json({ success: false, message: "Bu email allaqachon ro'yxatdan o'tgan" });

    const tempUserId = crypto.randomBytes(16).toString('hex');

    tempUsers.set(tempUserId, {
      firstName: firstName.trim(),
      lastName:  lastName?.trim() || '',
      email:     email.toLowerCase().trim(),
      password,
      createdAt: Date.now(),
    });

    setTimeout(() => tempUsers.delete(tempUserId), 10 * 60 * 1000);

    res.status(200).json({ success: true, data: { tempUserId } });
  } catch (err) {
    console.error('registerTemp error:', err);
    res.status(500).json({ success: false, message: 'Server xatosi' });
  }
};

// ─── STEP 2: Telegram kod yuborish ───────────────────────────────────────────
exports.sendTelegramCode = async (req, res) => {
  try {
    const { phone, tempUserId } = req.body;

    if (!phone)
      return res.status(400).json({ success: false, message: 'Telefon raqam kiritilmadi' });
    if (!tempUserId)
      return res.status(400).json({ success: false, message: 'Sessiya topilmadi' });

    const tempData = tempUsers.get(tempUserId);
    if (!tempData)
      return res.status(400).json({ success: false, message: "Sessiya muddati tugagan. Qayta ro'yxatdan o'ting" });

    const cleanPhone = phone.trim().replace(/\s/g, '');
    if (!/^\+?[1-9]\d{7,14}$/.test(cleanPhone))
      return res.status(400).json({ success: false, message: "Noto'g'ri telefon raqam formati" });

    const existingPhone = await User.findOne({ phone: cleanPhone });
    if (existingPhone)
      return res.status(400).json({ success: false, message: "Bu telefon raqam allaqachon ro'yxatdan o'tgan" });

    const response = await axios.post(
      'https://gatewayapi.telegram.org/sendVerificationMessage',
      {
        phone_number:    cleanPhone,
        code_length:     6,
        sender_username: process.env.TELEGRAM_GATEWAY_SENDER || undefined,
        callback_url:    process.env.TELEGRAM_GATEWAY_CALLBACK_URL || undefined,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.TELEGRAM_GATEWAY_TOKEN}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    if (!response.data.ok) {
      return res.status(400).json({
        success: false,
        message: response.data.description || 'Telegram Gateway xatosi',
      });
    }

    const requestId = response.data.result.request_id;

    tempData.phone       = cleanPhone;
    tempData.requestId   = requestId;
    tempData.codeExpires = Date.now() + 10 * 60 * 1000;
    tempUsers.set(tempUserId, tempData);

    res.status(200).json({ success: true, requestId });
  } catch (err) {
    console.error('sendTelegramCode error:', err?.response?.data || err.message);
    if (err.code === 'ECONNABORTED')
      return res.status(504).json({ success: false, message: "Telegram Gateway vaqt tugadi. Qayta urinib ko'ring" });
    const msg = err?.response?.data?.description || 'Telegram orqali kod yuborishda xato';
    res.status(500).json({ success: false, message: msg });
  }
};

// ─── STEP 3: Kodni tekshirish va foydalanuvchi yaratish ──────────────────────
exports.verifyTelegramCode = async (req, res) => {
  try {
    const { requestId, code, tempUserId } = req.body;

    if (!requestId || !code || !tempUserId)
      return res.status(400).json({ success: false, message: "Barcha maydonlar to'ldirilishi shart" });

    const tempData = tempUsers.get(tempUserId);
    if (!tempData || tempData.requestId !== requestId)
      return res.status(400).json({ success: false, message: 'Sessiya topilmadi yoki muddati tugagan' });

    if (Date.now() > tempData.codeExpires)
      return res.status(400).json({ success: false, message: 'Kodni muddati tugagan. Qayta yuborish kerak' });

    // ── Telegram Gateway orqali kodni tekshirish ──
    const response = await axios.post(
      'https://gatewayapi.telegram.org/checkVerificationStatus',
      { request_id: requestId, code },
      {
        headers: {
          Authorization: `Bearer ${process.env.TELEGRAM_GATEWAY_TOKEN}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    if (!response.data.ok)
      return res.status(400).json({ success: false, message: response.data.description || 'Tekshirishda xato' });

    const status = response.data.result?.verification_status;

    if (status?.status === 'code_invalid')
      return res.status(400).json({ success: false, message: "Kod noto'g'ri. Qayta kiriting" });
    if (status?.status === 'code_expired')
      return res.status(400).json({ success: false, message: 'Kodni muddati tugagan. Qayta yuborish kerak' });
    if (status?.status !== 'code_valid')
      return res.status(400).json({ success: false, message: 'Tasdiqlash amalga oshmadi' });

    // ── ✅ Foydalanuvchi yaratish ──
    const user = await User.create({
      firstName:        tempData.firstName,
      lastName:         tempData.lastName,
      email:            tempData.email,
      password:         tempData.password,
      phone:            tempData.phone,
      telegramVerified: true,
      isEmailVerified:  false,
      authProvider:     'local',
    });

    tempUsers.delete(tempUserId);

    // ── ✅ Token yaratish (authController bilan bir xil usul) ──
    const accessToken  = signAccessToken(user._id);
    const refreshToken = signRefreshToken(user._id);

    const isProduction = process.env.NODE_ENV === 'production';

    res.cookie('access-token', accessToken, {
      httpOnly: true,
      secure:   isProduction,
      sameSite: 'Strict',
      maxAge:   60 * 60 * 1000,
    });

    res.cookie('refresh-token', refreshToken, {
      httpOnly: true,
      secure:   isProduction,
      sameSite: 'Strict',
      maxAge:   7 * 24 * 60 * 60 * 1000,
      path:     '/api/auth/refresh',
    });

    res.status(201).json({
      success: true,
      message: 'Hisob muvaffaqiyatli yaratildi',
      data: {
        accessToken,
        user: user.toSafeObject(),
      },
    });
  } catch (err) {
    console.error('verifyTelegramCode error:', err?.response?.data || err.message);
    if (err.code === 11000)
      return res.status(400).json({ success: false, message: "Bu email yoki telefon allaqachon ro'yxatdan o'tgan" });
    res.status(500).json({ success: false, message: 'Server xatosi' });
  }
};