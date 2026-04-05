// models/User.js — Foydalanuvchi modeli
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const crypto   = require('crypto');

function generateCardNumber() {
  const prefix = '8600';
  let number = prefix;
  for (let i = 0; i < 12; i++) {
    number += Math.floor(Math.random() * 10).toString();
  }
  return number;
}

const UserSchema = new mongoose.Schema({

  firstName: {
    type: String,
    required: [true, 'Ism kiritilishi shart'],
    trim: true,
    maxlength: [50, 'Ism 50 ta belgidan oshmasligi kerak'],
    match: [/^[\p{L}\s'\-]{1,50}$/u, "Noto'g'ri ism formati"]
  },
  lastName: {
    type: String,
    required: false,
    default: '',
    trim: true,
    maxlength: [50, 'Familiya 50 ta belgidan oshmasligi kerak'],
  },
  email: {
    type: String,
    required: [true, 'Email kiritilishi shart'],
    unique: true,
    lowercase: true,
    trim: true,
    maxlength: [254, 'Email 254 ta belgidan oshmasligi kerak'],
    match: [/^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/, "Noto'g'ri email format"]
  },
  password: {
    type: String,
    minlength: [8, "Parol kamida 8 ta belgidan iborat bo'lishi kerak"],
    maxlength: [128, "Parol 128 ta belgidan oshmasligi kerak"],
    select: false
  },
  googleId: {
    type: String,
    unique: true,
    sparse: true
  },
  avatar: {
    type: String,
    default: null
  },
  authProvider: {
    type: String,
    enum: ['local', 'google'],
    default: 'local'
  },

  // ── Telefon raqam (Telegram verification uchun) ──────────────────────
  phone: {
    type: String,
    unique: true,
    sparse: true,
    trim: true,
    match: [/^\+?[1-9]\d{7,14}$/, "Noto'g'ri telefon raqam formati"],
    default: null,
  },

  // ── Telegram Gateway verification ────────────────────────────────────
  telegramVerified: {
    type: Boolean,
    default: false,
  },
  telegramVerificationCode:   { type: String, select: false },
  telegramVerificationExpires: { type: Date,  select: false },
  telegramRequestId:          { type: String, select: false }, // Gateway request_id

  // ── Karta raqami ──────────────────────────────────────────────────────
  cardNumber: {
    type: String,
    unique: true,
    sparse: true, // sparse: true qilib o'zgartirildi, chunki adminlarda bo'lmasligi mumkin
    match: [/^\d{16}$/, '16 xonali raqam bo\'lishi kerak'],
    set: (v) => (v === null || v === '' ? undefined : v), // Null yoki bo'sh bo'lsa, undefined qilamiz (sparse index ishlashi uchun)
    default: undefined,
  },

  isEmailVerified: {
    type: Boolean,
    default: false
  },
  emailVerificationToken:   { type: String, select: false },
  emailVerificationExpires: { type: Date,   select: false },
  passwordResetToken:       { type: String, select: false },
  passwordResetExpires:     { type: Date,   select: false },
  failedLoginAttempts:      { type: Number, default: 0, select: false },
  accountLockedUntil:       { type: Date,   default: null, select: false },
  lastLogin:                { type: Date,   default: null },
  isActive:                 { type: Boolean, default: true },
  role:                     { type: String,  enum: ['user', 'admin', 'super-admin'], default: 'user' }

}, { timestamps: true, versionKey: false });

// ── Pre-save ──────────────────────────────────────────────────────────
UserSchema.pre('save', async function () {
  // 1. Parolni hash qilish
  if (this.isModified('password')) {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
  }

  // 2. Karta raqamini faqat 'user' roli uchun boshqarish
  if (this.isModified('role')) {
    if (this.role !== 'user') {
      this.cardNumber = undefined;
    } else if (this.role === 'user' && !this.cardNumber) {
      this.cardNumber = generateCardNumber();
    }
  } else if (this.isNew && this.role === 'user' && !this.cardNumber) {
    this.cardNumber = generateCardNumber();
  }
});

// ── Methods ───────────────────────────────────────────────────────────
UserSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

UserSchema.methods.isLocked = function () {
  return this.accountLockedUntil && this.accountLockedUntil > Date.now();
};

UserSchema.methods.onLoginSuccess = async function () {
  this.failedLoginAttempts = 0;
  this.accountLockedUntil  = null;
  this.lastLogin           = new Date();
  await this.save({ validateBeforeSave: false });
};

UserSchema.methods.onLoginFail = async function () {
  this.failedLoginAttempts += 1;
  if (this.failedLoginAttempts >= 10) {
    this.accountLockedUntil = new Date(Date.now() + 2 * 60 * 60 * 1000);
  }
  await this.save({ validateBeforeSave: false });
};

UserSchema.methods.generateEmailVerificationToken = function () {
  const token = crypto.randomBytes(32).toString('hex');
  this.emailVerificationToken   = crypto.createHash('sha256').update(token).digest('hex');
  this.emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return token;
};

UserSchema.methods.generatePasswordResetToken = function () {
  const token = crypto.randomBytes(32).toString('hex');
  this.passwordResetToken   = crypto.createHash('sha256').update(token).digest('hex');
  this.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000);
  return token;
};

// ── Telegram verification token saqlash ──────────────────────────────
UserSchema.methods.setTelegramVerification = function (requestId) {
  this.telegramRequestId           = requestId;
  this.telegramVerificationExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 daqiqa
  this.telegramVerified            = false;
};

UserSchema.methods.toSafeObject = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.emailVerificationToken;
  delete obj.emailVerificationExpires;
  delete obj.passwordResetToken;
  delete obj.passwordResetExpires;
  delete obj.failedLoginAttempts;
  delete obj.accountLockedUntil;
  delete obj.telegramVerificationCode;
  delete obj.telegramVerificationExpires;
  delete obj.telegramRequestId;
  return obj;
};

module.exports = mongoose.model('User', UserSchema);