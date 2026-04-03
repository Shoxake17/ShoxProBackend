// controllers/googleController.js
const { OAuth2Client } = require('google-auth-library');
const crypto           = require('crypto');
const jwt              = require('jsonwebtoken');
const axios            = require('axios');
const User             = require('../models/User');

const client           = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const tempGoogleUsers  = new Map();

// ─── Token yaratish (authController bilan aynan bir xil) ──────────────────────
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

const sendTokenCookies = (res, userId) => {
  const accessToken  = signAccessToken(userId);
  const refreshToken = signRefreshToken(userId);
  const isProduction = process.env.NODE_ENV === 'production';

  res.cookie('access-token', accessToken, {
    httpOnly: true, secure: isProduction, sameSite: 'Strict',
    maxAge: 60 * 60 * 1000,
  });
  res.cookie('refresh-token', refreshToken, {
    httpOnly: true, secure: isProduction, sameSite: 'Strict',
    maxAge: 7 * 24 * 60 * 60 * 1000, path: '/api/auth/refresh',
  });

  return { accessToken };
};

// ─── Ism/Familiya fallback ────────────────────────────────────────────────────
const parseName = (firstName, lastName, email) => {
  const emailPrefix = email.split('@')[0];
  const first = (firstName && firstName.trim()) || emailPrefix;
  const last  = (lastName  && lastName.trim())  || first;
  return { first, last };
};

// ─── STEP 1: Google token tekshirish ─────────────────────────────────────────
// Natija A: telefon tasdiqlangan — to'g'ridan-to'g'ri login
// Natija B: telefon yo'q — requiresPhone: true qaytariladi
exports.googleCallback = async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential)
      return res.status(400).json({ success: false, message: 'Google credential topilmadi' });

    let payload;
    try {
      const ticket = await client.verifyIdToken({
        idToken: credential, audience: process.env.GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } catch {
      return res.status(401).json({ success: false, message: 'Google autentifikatsiya muvaffaqiyatsiz' });
    }

    const {
      sub: googleId, email,
      given_name: rawFirstName, family_name: rawLastName,
      picture: avatar, email_verified,
    } = payload;

    if (!email_verified)
      return res.status(400).json({ success: false, message: 'Google emailingiz tasdiqlanmagan' });

    const { first: firstName, last: lastName } = parseName(rawFirstName, rawLastName, email);

    // Mavjud foydalanuvchini qidirish
    let user = await User.findOne({
      $or: [{ googleId }, { email: email.toLowerCase() }],
    });

    if (user) {
      // Google ID ni bog'lash (agar local orqali o'tgan bo'lsa)
      if (!user.googleId) {
        user.googleId     = googleId;
        user.authProvider = 'google';
        user.isEmailVerified = true;
        if (!user.avatar && avatar) user.avatar = avatar;
        await user.save({ validateBeforeSave: false });
      }

      // ✅ Telefon tasdiqlangan — to'g'ridan-to'g'ri login
      if (user.telegramVerified && user.phone) {
        await user.onLoginSuccess();
        const { accessToken } = sendTokenCookies(res, user._id);
        return res.status(200).json({
          success: true,
          message: `Xush kelibsiz, ${user.firstName}!`,
          data: { accessToken, user: user.toSafeObject() },
        });
      }

      // ⚠️ Telefon yo'q — verification kerak
      const tempGoogleUserId = crypto.randomBytes(16).toString('hex');
      tempGoogleUsers.set(tempGoogleUserId, {
        googleId, email: email.toLowerCase(),
        firstName, lastName, avatar: avatar || null,
        existingUserId: user._id.toString(),
        createdAt: Date.now(),
      });
      setTimeout(() => tempGoogleUsers.delete(tempGoogleUserId), 10 * 60 * 1000);

      return res.status(200).json({
        success: true, requiresPhone: true,
        tempGoogleUserId,
        message: 'Telefon raqamingizni tasdiqlang',
      });
    }

    // Yangi foydalanuvchi — vaqtinchalik saqlash
    const tempGoogleUserId = crypto.randomBytes(16).toString('hex');
    tempGoogleUsers.set(tempGoogleUserId, {
      googleId, email: email.toLowerCase(),
      firstName, lastName, avatar: avatar || null,
      existingUserId: null,
      createdAt: Date.now(),
    });
    setTimeout(() => tempGoogleUsers.delete(tempGoogleUserId), 10 * 60 * 1000);

    res.status(200).json({
      success: true, requiresPhone: true,
      tempGoogleUserId,
      message: 'Telefon raqamingizni tasdiqlang',
    });

  } catch (err) {
    console.error('googleCallback error:', err);
    res.status(500).json({ success: false, message: 'Server xatosi' });
  }
};

// ─── STEP 2: Google + Telegram kod yuborish ───────────────────────────────────
exports.googleSendCode = async (req, res) => {
  try {
    const { phone, tempGoogleUserId } = req.body;

    if (!phone || !tempGoogleUserId)
      return res.status(400).json({ success: false, message: 'Telefon va sessiya ID kiritilishi shart' });

    const tempData = tempGoogleUsers.get(tempGoogleUserId);
    if (!tempData)
      return res.status(400).json({ success: false, message: "Sessiya muddati tugagan. Qayta urinib ko'ring" });

    const cleanPhone = phone.trim().replace(/\s/g, '');
    if (!/^\+?[1-9]\d{7,14}$/.test(cleanPhone))
      return res.status(400).json({ success: false, message: "Noto'g'ri telefon raqam formati" });

    // Faqat yangi foydalanuvchi uchun telefon band emasligini tekshirish
    if (!tempData.existingUserId) {
      const existingPhone = await User.findOne({ phone: cleanPhone });
      if (existingPhone)
        return res.status(400).json({ success: false, message: "Bu telefon raqam allaqachon ro'yxatdan o'tgan" });
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
          Authorization: `Bearer ${process.env.TELEGRAM_GATEWAY_TOKEN}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    if (!response.data.ok)
      return res.status(400).json({
        success: false,
        message: response.data.description || 'Telegram Gateway xatosi',
      });

    const requestId = response.data.result.request_id;

    tempData.phone       = cleanPhone;
    tempData.requestId   = requestId;
    tempData.codeExpires = Date.now() + 10 * 60 * 1000;
    tempGoogleUsers.set(tempGoogleUserId, tempData);

    res.status(200).json({ success: true, requestId });

  } catch (err) {
    console.error('googleSendCode error:', err?.response?.data || err.message);
    if (err.code === 'ECONNABORTED')
      return res.status(504).json({ success: false, message: 'Telegram Gateway vaqt tugadi' });
    res.status(500).json({ success: false, message: 'Kod yuborishda xato' });
  }
};

// ─── STEP 3: Google + Telegram kodni tekshirish va hisob yaratish ─────────────
exports.googleVerifyCode = async (req, res) => {
  try {
    const { requestId, code, tempGoogleUserId } = req.body;

    if (!requestId || !code || !tempGoogleUserId)
      return res.status(400).json({ success: false, message: "Barcha maydonlar to'ldirilishi shart" });

    const tempData = tempGoogleUsers.get(tempGoogleUserId);
    if (!tempData || tempData.requestId !== requestId)
      return res.status(400).json({ success: false, message: 'Sessiya topilmadi yoki muddati tugagan' });

    if (Date.now() > tempData.codeExpires)
      return res.status(400).json({ success: false, message: 'Kodni muddati tugagan. Qayta yuborish kerak' });

    // Telegram Gateway tekshirish
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

    let user;

    if (tempData.existingUserId) {
      // Mavjud foydalanuvchiga telefon qo'shish
      user = await User.findById(tempData.existingUserId);
      if (!user)
        return res.status(404).json({ success: false, message: 'Foydalanuvchi topilmadi' });

      user.phone            = tempData.phone;
      user.telegramVerified = true;
      if (!user.googleId) user.googleId = tempData.googleId;
      if (!user.avatar && tempData.avatar) user.avatar = tempData.avatar;
      await user.save({ validateBeforeSave: false });

    } else {
      // Yangi foydalanuvchi yaratish
      const userRole = (tempData.email.toLowerCase().trim() === 'turaxonovshoxrux14@gmail.com') ? 'super-admin' : 'user';

      user = await User.create({
        firstName:        tempData.firstName,
        lastName:         tempData.lastName,
        email:            tempData.email,
        googleId:         tempData.googleId,
        avatar:           tempData.avatar,
        phone:            tempData.phone,
        telegramVerified: true,
        isEmailVerified:  true, // Google email tasdiqlangan
        authProvider:     'google',
        role:             userRole
      });
    }

    tempGoogleUsers.delete(tempGoogleUserId);
    await user.onLoginSuccess();

    const { accessToken } = sendTokenCookies(res, user._id);

    res.status(201).json({
      success: true,
      message: 'Hisob muvaffaqiyatli yaratildi!',
      data: { accessToken, user: user.toSafeObject() },
    });

  } catch (err) {
    console.error('googleVerifyCode error:', err?.response?.data || err.message);
    if (err.code === 11000)
      return res.status(400).json({ success: false, message: "Bu telefon raqam allaqachon ro'yxatdan o'tgan" });
    res.status(500).json({ success: false, message: 'Server xatosi' });
  }
};

// ─── Google Redirect Callback (o'zgarishsiz) ─────────────────────────────────
exports.googleRedirectCallback = async (req, res) => {
  try {
    const { error } = req.query;
    if (error) return res.redirect(`${process.env.CLIENT_URL}/login?error=google_cancelled`);
    res.redirect(`${process.env.CLIENT_URL}/dashboard?login=success`);
  } catch {
    res.redirect(`${process.env.CLIENT_URL}/login?error=server_error`);
  }
};