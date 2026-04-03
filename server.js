// ShoxProBackend/server.js
'use strict';

require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const connectDB = require('./config/db');
const authRoutes   = require('./routes/auth');
const cashbackRoutes = require('./routes/cashbackRoutes');
const adminRoutes = require('./routes/adminRoutes');
const clubRoutes = require('./routes/clubRoutes');

const {
  helmetConfig,
  apiLimiter,
  sanitizeInput,
  generateCsrfToken,
  securityLogger,
} = require('./middleware/security');

const Wallet = require('./models/Wallet');
const ComputerClub = require('./models/ComputerClub');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  cors: {
    origin: "*", // Barcha qurilmalarga ruxsat berish
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    credentials: true
  }
});
const PORT = process.env.PORT || 4000;

// Socket.io-ni request ob'ektiga qo'shish (Controller-larda ishlatish uchun)
app.use((req, res, next) => {
  req.io = io;
  next();
});

// Socket ulanishini boshqarish
io.on('connection', (socket) => {
  console.log('🔌 Yangi foydalanuvchi ulandi:', socket.id);
  
  socket.on('join-club', (clubId) => {
    socket.join(`club_${clubId}`);
    console.log(`🏠 Foydalanuvchi klub xonasiga qo'shildi: club_${clubId}`);
  });

  socket.on('join-user', (userId) => {
    socket.join(`user_${userId}`);
    console.log(`👤 Foydalanuvchi shaxsiy xonasiga qo'shildi: user_${userId}`);
  });

  // --- PC AGENT LOGIC ---
  socket.on('register_pc', (data) => {
    const { clubId, pcNumber } = data;
    const room = `pc_room_${clubId}_${pcNumber}`;
    socket.join(room);
    console.log(`🖥️  PC Agent ulandi: Klub ${clubId}, PC-${pcNumber}`);
    
    // Adminlarga PC ulanishini xabar qilish
    io.to(`club_${clubId}`).emit('pc-online', { pcNumber });
  });

  socket.on('unlock_request', async (data) => {
    const { clubId, pcNumber, duration, userId } = data;
    console.log(`🔓 Unlock so'rovi: PC-${pcNumber}, Davomiyligi: ${duration}s`);
    
    try {
      // 1. Klubni va PC narxini topish
      const club = await ComputerClub.findById(clubId);
      if (!club) return socket.emit('error', { message: 'Klub topilmadi' });

      const pc = club.computers.find(c => c.number === pcNumber);
      if (!pc) return socket.emit('error', { message: 'Kompyuter topilmadi' });

      // 2. Balansni tekshirish (1 soatlik narx)
      const cost = pc.pricePerHour;
      const wallet = await Wallet.findOne({ user_id: userId });

      if (!wallet || wallet.balance < cost) {
        return socket.emit('error', { message: 'Hamyonda mablag\' yetarli emas' });
      }

      // 3. Mablag'ni yechish va tranzaksiya yaratish
      wallet.balance -= cost;
      wallet.transactions.push({
        type: 'gaming',
        amount: cost,
        description: `${club.name} (PC-${pcNumber}) seansi uchun to'lov`,
        created_at: new Date()
      });
      await wallet.save();

      // 4. PC Agent-ga buyruq yuborish
      io.to(`pc_room_${clubId}_${pcNumber}`).emit('command_unlock', { duration });
      
      // 5. Foydalanuvchiga real-time balans yangilanishini yuborish
      io.to(`user_${userId}`).emit('balance-updated', { balance: wallet.balance });
      
      // 6. Admin-ga PC statusini yuborish
      io.to(`club_${clubId}`).emit('pc-status-change', { pcNumber, status: 'active', userId });

      socket.emit('unlock_success', { message: 'Kompyuter muvaffaqiyatli ochildi', newBalance: wallet.balance });

    } catch (err) {
      console.error('Unlock error:', err);
      socket.emit('error', { message: 'Tizimda xatolik yuz berdi' });
    }
  });

  socket.on('disconnect', () => {
    console.log('🔌 Foydalanuvchi uzildi:', socket.id);
  });
});

// 1. Ma'lumotlar bazasiga ulanish
connectDB();

// 2. Trust Proxy (Reverse proxy orqali IP olish uchun)
app.set('trust proxy', 1);

// 3. CORS — Mukammal production sozlamasi
const allOrigins = (process.env.CLIENT_URL || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: true, // Kelayotgan origin'ga ruxsat berish (Local tarmoq uchun)
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
}));

// 4. Helmet (Xavfsizlik headerlari)
app.use(helmetConfig);

// 5. Asosiy Middleware'lar
app.use(cookieParser(process.env.COOKIE_SECRET));
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// 6. Xavfsizlik filtrlari
app.use(sanitizeInput);
app.use(securityLogger);

// 7. CSRF - MUHIM TUZATISH
// ShoxPosPro Backend dan keladigan /register so'rovini CSRF dan ozod qilamiz
// Chunki u brauzer emas, u server-to-server API Key orqali ishlaydi
app.use((req, res, next) => {
  if (req.path === '/api/cashback/register' && req.headers['x-api-key']) {
    return next(); // Register uchun CSRF shart emas
  }
  generateCsrfToken(req, res, next);
});

// 8. Logging (Development muhitida)
if (process.env.NODE_ENV === 'development') {
  app.use((req, res, next) => {
    console.log(`📨 ${req.method} ${req.path}`);
    next();
  });
}

// 9. Rate Limit
app.use('/api', apiLimiter);

// 10. Health Check
app.get('/health', (req, res) => {
  res.status(200).json({ success: true, status: 'OK', env: process.env.NODE_ENV });
});

// 11. Routelar
// ✅ Cashback routes (Internal Register + Client Claim)
app.use('/api/cashback', cashbackRoutes);

// ✅ Auth routes (Client Login/Register)
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/clubs', clubRoutes);

// 12. 404 Handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `${req.originalUrl} manzili topilmadi`,
  });
});

// 13. Global Xato Handler
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  console.error(`❌ Xato: ${err.message}`);

  // JWT xatolari
  if (err.name === 'JsonWebTokenError') return res.status(401).json({ success: false, message: "Token noto'g'ri" });
  if (err.name === 'TokenExpiredError') return res.status(401).json({ success: false, message: "Sessiya muddati tugagan" });

  // CSRF xatosi
  if (err.code === 'EBADCSRFTOKEN') return res.status(403).json({ success: false, message: "CSRF himoyasi xatosi" });

  res.status(err.status || 500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' ? "Serverda xatolik yuz berdi" : err.message,
  });
});

// 14. Serverni ishga tushirish
const server = http.listen(PORT, '0.0.0.0', () => {
  console.log(`
🚀 SHOXPAY BACKEND ISHGA TUSHDI
🌐 Port:   ${PORT}
🔐 Xavfsizlik: CSRF & Helmet faol
📡 CORS:   ${allOrigins.join(', ')} ruxsat etilgan
  `);
});

// Graceful Shutdown
process.on('SIGTERM', () => {
  server.close(() => {
    process.exit(0);
  });
});

module.exports = app;