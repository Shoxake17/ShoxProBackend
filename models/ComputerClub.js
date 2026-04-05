const mongoose = require('mongoose');

const ComputerClubSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Klub nomi kiritilishi shart'],
    trim: true
  },
  address: {
    type: String,
    required: [true, 'Manzil kiritilishi shart'],
    trim: true
  },
  pcCount: {
    type: Number,
    required: [true, 'Kompyuterlar soni kiritilishi shart'],
    min: [1, 'Kamida 1 ta kompyuter bo\'lishi kerak']
  },
  phone: {
    type: String,
    required: [true, 'Telefon raqami kiritilishi shart'],
    match: [/^\+?[1-9]\d{7,14}$/, 'Noto\'g\'ri telefon raqami formati']
  },
  admin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true // Bitta admin faqat bitta klubga ega bo'lishi mumkin
  },
  isOpen: {
    type: Boolean,
    default: true
  },
  computers: [{
    number: Number,
    type: {
      type: String,
      enum: ['standard', 'vip'],
      default: 'standard'
    },
    pricePerHour: {
      type: Number,
      default: 10000
    },
    isAvailable: {
      type: Boolean,
      default: true
    },
    totalEarnings: {
      type: Number,
      default: 0
    },
    totalHours: {
      type: Number,
      default: 0
    }
  }]
}, { timestamps: true });

module.exports = mongoose.model('ComputerClub', ComputerClubSchema);
