const mongoose = require('mongoose');

const PairingCodeSchema = new mongoose.Schema({
  clubId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ComputerClub',
    required: true
  },
  pcNumber: {
    type: Number,
    required: true
  },
  code: {
    type: String,
    required: true,
    unique: true
  },
  expiresAt: {
    type: Date,
    required: true,
    default: () => new Date(Date.now() + 10 * 60 * 1000) // 10 minut
  },
  isUsed: {
    type: Boolean,
    default: false
  }
}, { timestamps: true });

// Avtomatik o'chirish (TTL index)
PairingCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('PairingCode', PairingCodeSchema);
