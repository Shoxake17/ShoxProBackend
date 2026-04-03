// config/db.js — MongoDB ulanishi
const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    // 1. Faqat MONGO_URI ni uzatamiz, ortiqcha{} shart emas
    const conn = await mongoose.connect(process.env.MONGO_URI); 

    console.log(`✅ MongoDB ulandi: ${conn.connection.host}`);

  } catch (err) {
    console.error(`❌ MongoDB ulanmadi: ${err.message}`);
    // Development muhitida bo'lsangiz, jarayonni to'xtatmaslik ham mumkin
    if (process.env.NODE_ENV === 'production') {
       process.exit(1); 
    }
  }
};

// Ulanish hodisalarini funksiyadan tashqarida yozish ham mumkin (global nazorat uchun)
mongoose.connection.on('error', (err) => {
  console.error(`❌ MongoDB ulanish xatosi: ${err.message}`);
});

mongoose.connection.on('disconnected', () => {
  console.warn('⚠️  MongoDB ulanishi uzildi.');
});

module.exports = connectDB;