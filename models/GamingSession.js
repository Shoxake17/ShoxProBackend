const mongoose = require('mongoose');

const GamingSessionSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  club_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ComputerClub',
    required: true
  },
  pc_number: {
    type: Number,
    required: true
  },
  duration: {
    type: Number, // seconds
    required: true
  },
  start_time: {
    type: Date,
    default: Date.now
  },
  end_time: {
    type: Date,
    required: true
  },
  is_active: {
    type: Boolean,
    default: true
  },
  cost: {
    type: Number,
    required: true
  }
}, { timestamps: true });

// Avtomatik ravishda muddati o'tgan sessiyalarni faolsizlantirish uchun index
GamingSessionSchema.index({ end_time: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('GamingSession', GamingSessionSchema);
