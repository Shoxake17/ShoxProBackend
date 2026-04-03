const mongoose = require('mongoose');

const walletSchema = new mongoose.Schema({
  // ✅ userId asosiy identifier — har bir user uchun faqat bitta wallet
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
  },
  card_number: {
    type: String,
    required: true,
    unique: true,
    match: /^\d{16}$/,
  },
  balance: {
    type: Number,
    default: 0,
    min: 0,
  },
  transactions: [
    {
      type:        { type: String, enum: ['cashback', 'send', 'receive', 'topup', 'gaming'], default: 'cashback' },
      amount:      { type: Number, required: true },
      receipt_id:  { type: String, default: null },
      store_name:  { type: String, default: null },
      created_at:  { type: Date,   default: Date.now },
      description: { type: String, default: '' },
    },
  ],
  updated_at: { type: Date, default: Date.now },
});


module.exports = mongoose.model('Wallet', walletSchema);