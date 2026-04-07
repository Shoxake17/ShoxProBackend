// controllers/googleController.js
'use strict';

const { OAuth2Client } = require('google-auth-library');
const crypto           = require('crypto');
const axios            = require('axios');
const User             = require('../models/User');

const client          = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const tempGoogleUsers = new Map();

// ─── Ism/Familiya fallback ────────────────────────────────────────────────────
const parseName = (firstName, lastName, email) => {
  const emailPrefix = email.split('@')[0];
  const first = (firstName && firstName.trim()) || emailPrefix;
  const last  = (lastName  && lastName.trim())  || first;
  return { first, last };
};

// ─── Cookie o'rnatish (authController bilan bir xil logika) ──────────────────
// ✅ TUZATILDI: authController.js dagi sendTokenCookies ni import qilamiz
// Duplicate kod yo'qoladi, bir joydan boshqariladi
const { sendTokenCookies } = require('./authController');
// Agar authController export qilmasa, shu funksiyani ishlating:
/*
const jwt    = require('jsonwebtoken');
const sendTokenCookies = (res, userId) => {
  const isProd = process.env.NODE_ENV === 'production';

  const accessToken = jwt.sign(
    { id: userId },
    process.env.JWT_SECRET,
    { expiresIn: '15m', issuer: 'shoxpay', audience: 'shoxpay-client' }
  );
  const refreshToken = jwt.sign(
    { id: userId },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: '30d', issuer: 'shoxpay', audience: 'shoxpay-client' }
  );

  res.cookie('access-token', accessToken, {
    httpOnly: true,          // ✅ TUZATILDI: false emas, true bo'lishi shart
    secure:   isProd,        // ✅ TUZATILDI: dev da false
    domain:   isProd ? '.shoxpro.uz' : undefined,
    sameSite: isProd ? 'None' : 'Lax',
    maxAge:   15 * 60 * 1000,
    path:     '/',
  });

  res.cookie('refresh-token', refreshToken, {
    httpOnly: true,
    secure:   isProd,
    domain:   isProd ? '.shoxpro.uz' : undefined,
    sameSite: isProd ? 'None' : 'Lax',
    maxAge:   30 * 24 * 60 * 60 * 1000,
    path:     '/api/auth/refresh',
  });
};
*/

// ─── STEP 1: Google token tekshirish ─────────────────────────────────────────
exports.googleCallback = async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) {
      return res.status(400).json({ success: false, message: 'Google credential topilmadi' });
    }

    let payload;
    try {
      const ticket = await client.verifyIdToken({
        idToken:  credential,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } catch {
      return res.status(401).json({ success: false, message: 'Google autentifikatsiya muvaffaqiyatsiz' });
    }

    const {
      sub: googleId,
      email,
      given_name:  rawFirstName,
      family_name: rawLastName,
      picture:     avatar,
      email_verified,
    } = payload;

    if (!email_verified) {
      return res.status(400).json({ success: false, message: 'Google emailingiz tasdiqlanmagan' });
    }

    const { first: firstName, last: lastName } = parseName(rawFirstName, rawLastName, email);

    let user = await User.findOne({
      $or: [{ googleId }, { email: email.toLowerCase() }],
    });

    if (user) {
      // Google ID ni bog'lash (local orqali ro'yxatdan o'tgan bo'lsa)
      if (!user.googleId) {
        user.googleId        = googleId;
        user.authProvider    = 'google';
        user.isEmailVerified = true;
        if (!user.avatar && avatar) user.avatar = avatar;
        await user.save({ validateBeforeSave: false });
      }

      // Telefon tasdiqlangan — to'g'ridan-to'g'ri login
      if (user.telegramVerified && user.phone) {
        if (user.onLoginSuccess) await user.onLoginSuccess();

        sendTokenCookies(res, user._id);

        // ✅ TUZATILDI: data.user formatida qaytarish (Login.tsx bilan mos)
        return res.status(200).json({
          success: true,
          user: {
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
      }

      // Telefon yo'q — verification kerak
      const tempId = crypto.randomBytes(16).toString('hex');
      tempGoogleUsers.set(tempId, {
        googleId,
        email:          email.toLowerCase(),
        firstName,
        lastName,
        avatar:         avatar || null,
        existingUserId: user._id.toString(),
        createdAt:      Date.now(),
      });
      setTimeout(() => tempGoogleUsers.delete(tempId), 10 * 60 * 1000);

      return res.status(200).json({
        success:         true,
        requiresPhone:   true,
        tempGoogleUserId: tempId,
        message:         'Telefon raqamingizni tasdiqlang',
      });
    }

    // Yangi foydalanuvchi — vaqtinchalik saqlash
    const tempId = crypto.randomBytes(16).toString('hex');
    tempGoogleUsers.set(tempId, {
      googleId,
      email:          email.toLowerCase(),
      firstName,
      lastName,
      avatar:         avatar || null,
      existingUserId: null,
      createdAt:      Date.now(),
    });
    setTimeout(() => tempGoogleUsers.delete(tempId), 10 * 60 * 1000);

    res.status(200).json({
      success:          true,
      requiresPhone:    true,
      tempGoogleUserId: tempId,
      message:          'Telefon raqamingizni tasdiqlang',
    });

  } catch (err) {
    console.error('googleCallback xatosi:', err);
    res.status(500).json({ success: false, message: 'Server xatosi' });
  }
};

// ─── STEP 2: Telegram kod yuborish ───────────────────────────────────────────
exports.googleSendCode = async (req, res) => {
  try {
    const { phone, tempGoogleUserId } = req.body;

    if (!phone || !tempGoogleUserId) {
      return res.status(400).json({ success: false, message: 'Telefon va sessiya ID kiritilishi shart' });
    }

    const tempData = tempGoogleUsers.get(tempGoogleUserId);
    if (!tempData) {
      return res.status(400).json({ success: false, message: "Sessiya muddati tugagan. Qayta urinib ko'ring" });
    }

    const cleanPhone = phone.trim().replace(/\s/g, '');
    if (!/^\+?[1-9]\d{7,14}$/.test(cleanPhone)) {
      return res.status(400).json({ success: false, message: "Noto'g'ri telefon raqam formati" });
    }

    // Faqat yangi foydalanuvchi uchun telefon band emasligini tekshirish
    if (!tempData.existingUserId) {
      const existingPhone = await User.findOne({ phone: cleanPhone });
      if (existingPhone) {
        return res.status(400).json({ success: false, message: "Bu telefon raqam allaqachon ro'yxatdan o'tgan" });
      }
    }

    const response = await axios.post(
      'https://gatewayapi.telegram.org/sendVerificationMessage',
      {
        phone_number:    cleanPhone,
        code_length:     6,
        sender_username: process.env.TELEGRAM_GATEWAY_SENDER || undefined,
      },
      {
        headers: {
          Authorization:  `Bearer ${process.env.TELEGRAM_GATEWAY_TOKEN}`,
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

    tempData.phone       = cleanPhone;
    tempData.requestId   = response.data.result.request_id;
    tempData.codeExpires = Date.now() + 10 * 60 * 1000;
    tempGoogleUsers.set(tempGoogleUserId, tempData);

    res.status(200).json({ success: true, requestId: response.data.result.request_id });

  } catch (err) {
    console.error('googleSendCode xatosi:', err?.response?.data || err.message);
    if (err.code === 'ECONNABORTED') {
      return res.status(504).json({ success: false, message: 'Telegram Gateway vaqt tugadi' });
    }
    res.status(500).json({ success: false, message: 'Kod yuborishda xato' });
  }
};

// ─── STEP 3: Kodni tekshirish va hisob yaratish ───────────────────────────────
exports.googleVerifyCode = async (req, res) => {
  try {
    const { requestId, code, tempGoogleUserId } = req.body;

    if (!requestId || !code || !tempGoogleUserId) {
      return res.status(400).json({ success: false, message: "Barcha maydonlar to'ldirilishi shart" });
    }

    const tempData = tempGoogleUsers.get(tempGoogleUserId);
    if (!tempData || tempData.requestId !== requestId) {
      return res.status(400).json({ success: false, message: 'Sessiya topilmadi yoki muddati tugagan' });
    }

    if (Date.now() > tempData.codeExpires) {
      return res.status(400).json({ success: false, message: 'Kodni muddati tugagan. Qayta yuborish kerak' });
    }

    // Telegram Gateway tekshirish
    const response = await axios.post(
      'https://gatewayapi.telegram.org/checkVerificationStatus',
      { request_id: requestId, code },
      {
        headers: {
          Authorization:  `Bearer ${process.env.TELEGRAM_GATEWAY_TOKEN}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    if (!response.data.ok) {
      return res.status(400).json({
        success: false,
        message: response.data.description || 'Tekshirishda xato',
      });
    }

    const status = response.data.result?.verification_status?.status;

    if (status === 'code_invalid') {
      return res.status(400).json({ success: false, message: "Kod noto'g'ri. Qayta kiriting" });
    }
    if (status === 'code_expired') {
      return res.status(400).json({ success: false, message: 'Kodni muddati tugagan. Qayta yuborish kerak' });
    }
    if (status !== 'code_valid') {
      return res.status(400).json({ success: false, message: 'Tasdiqlash amalga oshmadi' });
    }

    let user;

    if (tempData.existingUserId) {
      user = await User.findById(tempData.existingUserId);
      if (!user) {
        return res.status(404).json({ success: false, message: 'Foydalanuvchi topilmadi' });
      }
      user.phone            = tempData.phone;
      user.telegramVerified = true;
      if (!user.googleId && tempData.googleId) user.googleId = tempData.googleId;
      if (!user.avatar  && tempData.avatar)   user.avatar   = tempData.avatar;
      await user.save({ validateBeforeSave: false });
    } else {
      const role = tempData.email === 'turaxonovshoxrux14@gmail.com' ? 'super-admin' : 'user';
      user = await User.create({
        firstName:        tempData.firstName,
        lastName:         tempData.lastName,
        email:            tempData.email,
        googleId:         tempData.googleId,
        avatar:           tempData.avatar,
        phone:            tempData.phone,
        telegramVerified: true,
        isEmailVerified:  true,
        authProvider:     'google',
        role,
      });
    }

    tempGoogleUsers.delete(tempGoogleUserId);
    if (user.onLoginSuccess) await user.onLoginSuccess();

    sendTokenCookies(res, user._id);

    // ✅ TUZATILDI: data.user formatida (Login.tsx bilan mos)
    res.status(201).json({
      success: true,
      user: {
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
    console.error('googleVerifyCode xatosi:', err?.response?.data || err.message);
    if (err.code === 11000) {
      return res.status(400).json({ success: false, message: "Bu telefon raqam allaqachon ro'yxatdan o'tgan" });
    }
    res.status(500).json({ success: false, message: 'Server xatosi' });
  }
};

// ─── Google Redirect Callback ─────────────────────────────────────────────────
exports.googleRedirectCallback = async (req, res) => {
  try {
    const { error } = req.query;
    if (error) return res.redirect(`${process.env.CLIENT_URL}/login?error=google_cancelled`);
    res.redirect(`${process.env.CLIENT_URL}/dashboard?login=success`);
  } catch {
    res.redirect(`${process.env.CLIENT_URL}/login?error=server_error`);
  }
};