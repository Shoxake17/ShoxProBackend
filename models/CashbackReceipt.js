// ============================================
// ShoxPay Backend: models/CashbackReceipt.js
// ============================================

const mongoose = require('mongoose');

const cashbackReceiptSchema = new mongoose.Schema({
  receipt_id: {
    type: String,
    required: true,
    match: /^\d{12}$/,  // Exactly 12 digits
  },
  total_amount: {
    type: Number,
    required: true,
    min: 0,
  },
  cashback_amount: {
    type: Number,
    required: true,
    min: 0,
  },
  store_name: {
    type: String,
    default: 'ShoxPos',
  },
  created_at: {
    type: Date,
    default: Date.now,
  },
  expires_at: {
    type: Date,
    required: true,
    // MongoDB TTL index — 24 soatdan keyin avtomatik o'chadi (ixtiyoriy)
    // Bu qatorni olib tashlasangiz, hech narsa o'chmaydi lekin expired deb belgilanadi
  },
  is_used: {
    type: Boolean,
    default: false,
  },
  used_at: {
    type: Date,
    default: null,
  },
  user_phone: {
    type: String,
    default: null,
  },
});

// Tez qidirish uchun indexlar
cashbackReceiptSchema.index({ receipt_id: 1 });
cashbackReceiptSchema.index({ expires_at: 1 });

// 7 kundan keyin expired cheklar avtomatik o'chishi (ixtiyoriy)
// cashbackReceiptSchema.index({ expires_at: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

module.exports = mongoose.model('CashbackReceipt', cashbackReceiptSchema);