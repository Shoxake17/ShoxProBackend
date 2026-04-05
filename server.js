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

const mongoose = require('mongoose');
const Wallet = require('./models/Wallet');
const ComputerClub = require('./models/ComputerClub');
const GamingSession = require('./models/GamingSession');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  cors: {
    // Hamma subdomenlaringizga ruxsat beramiz
    origin: [
      "https://dev-pay.shoxpro.uz",
      "https://dev-game.shoxpro.uz",
      "https://dev-admin-game.shoxpro.uz",
      "https://dev-super.shoxpro.uz",
      "https://dev-api.shoxpro.uz",
      "http://localhost:5173",
      "http://127.0.0.1:5173"
    ],
    methods: ["GET", "POST"],
    credentials: true
  },
  allowEIO3: true // Eski klientlar bilan moslashuvchanlik uchun
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
    console.log(`🖥️  PC Agent ulandi: Klub ${clubId}, PC-${pcNumber}. Xona: ${room}`);
    
    // Agentga xonaga kirganini tasdiqlash
    socket.emit('pc_room_joined', { room });

    // Adminlarga PC ulanishini xabar qilish
    io.to(`club_${clubId}`).emit('pc-online', { pcNumber });
  });

  socket.on('unlock_request', async (data) => {
    const { clubId, pcNumber, duration, userId } = data;
    console.log(`🔓 Unlock so'rovi keldi: PC-${pcNumber}, Club: ${clubId}, User: ${userId}, Davomiyligi: ${duration}s`);
    
    try {
      // 1. Klubni va PC narxini topish
      if (!mongoose.Types.ObjectId.isValid(clubId)) {
        console.error(`❌ Noto'g'ri klub ID: ${clubId}`);
        return socket.emit('error', { message: 'Noto\'g\'ri klub ID' });
      }

      const club = await ComputerClub.findById(clubId);
      if (!club) {
        console.error(`❌ Klub topilmadi: ${clubId}`);
        return socket.emit('error', { message: 'Klub topilmadi' });
      }

      const pc = club.computers.find(c => c.number === parseInt(pcNumber));
      if (!pc) {
        console.error(`❌ Kompyuter topilmadi: PC-${pcNumber} (Klub: ${clubId})`);
        return socket.emit('error', { message: 'Kompyuter topilmadi' });
      }

      console.log(`✅ Klub va PC topildi. Narxi: ${pc.pricePerHour} so'm`);

      // 2. Balansni tekshirish
      if (!userId || userId === 'undefined') {
        console.warn(`⚠️  Ogohlantirish: userId kelmadi, lekin sinov uchun buyruq yuboriladi! (Faqat Test rejimida)`);
        const room = `pc_room_${clubId}_${pcNumber}`;
        io.to(room).emit('command_unlock', { duration });
        return socket.emit('unlock_success', { message: 'TEST: Kompyuter ochildi (Balans tekshirilmadi)', duration, pcNumber });
      }

      if (!mongoose.Types.ObjectId.isValid(userId)) {
        console.error(`❌ Noto'g'ri foydalanuvchi ID: ${userId}`);
        return socket.emit('error', { message: 'Noto\'g\'ri foydalanuvchi ID' });
      }

      const cost = Math.ceil((pc.pricePerHour / 3600) * duration);
      const wallet = await Wallet.findOne({ user_id: new mongoose.Types.ObjectId(userId) });

      if (!wallet) {
        console.error(`❌ Hamyon topilmadi: User ${userId}`);
        return socket.emit('error', { message: 'Hamyon topilmadi' });
      }

      console.log(`💰 Hamyon topildi. Joriy balans: ${wallet.balance} so'm`);

      if (wallet.balance < cost) {
        console.warn(`⚠️ Balans yetarli emas: User ${userId}, Balans: ${wallet.balance}, Narx: ${cost}`);
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

      // 3.0 Kompyuter daromadini va soatini yangilash
      const hoursToAdd = duration / 3600;
      await ComputerClub.updateOne(
        { _id: clubId, "computers.number": parseInt(pcNumber) },
        { 
          $inc: { 
            "computers.$.totalEarnings": cost,
            "computers.$.totalHours": hoursToAdd 
          } 
        }
      );
      
      console.log(`✅ To'lov muvaffaqiyatli: -${cost} so'm. Yangi balans: ${wallet.balance}`);

      // 3.1 Sessiyani bazaga yozish
      const endTime = new Date(Date.now() + duration * 1000);
      await GamingSession.create({
        user_id: userId,
        club_id: clubId,
        pc_number: pcNumber,
        duration: duration,
        start_time: new Date(),
        end_time: endTime,
        cost: cost,
        is_active: true
      });
      console.log(`📝 Sessiya bazaga saqlandi. Tugash vaqti: ${endTime}`);

      // 4. PC Agent-ga buyruq yuborish
      const room = `pc_room_${clubId}_${pcNumber}`;
      console.log(`📡 Buyruq yuborilmoqda xonaga: ${room}`);
      io.to(room).emit('command_unlock', { duration });
      
      // 5. Foydalanuvchiga real-time balans yangilanishini yuborish
      io.to(`user_${userId}`).emit('balance-updated', { balance: wallet.balance });
      
      // 6. Admin-ga PC statusini yuborish
      io.to(`club_${clubId}`).emit('pc-status-change', { pcNumber, status: 'active', userId });
      
      // 7. Hamma foydalanuvchilarga klubni yangilash haqida xabar berish (Global)
      io.emit('pc-status-updated-global', { clubId, pcNumber });

      // 8. Vaqt tugaganda avtomatik global yangilash (setTimeout)
      setTimeout(() => {
        console.log(`⏰ PC-${pcNumber} vaqti tugadi (Klub: ${clubId}). Global yangilanish yuborilmoqda.`);
        io.emit('pc-status-updated-global', { clubId, pcNumber });
      }, duration * 1000 + 2000); // 2 soniya zapas bilan

      socket.emit('unlock_success', { 
        message: 'Kompyuter muvaffaqiyatli ochildi', 
        newBalance: wallet.balance,
        duration,
        cost,
        clubName: club.name,
        pcNumber
      });

    } catch (err) {
      console.error('❌ Unlock error:', err);
      socket.emit('error', { message: 'Tizimda xatolik yuz berdi' });
    }
  });

  socket.on('stop_pc', async (data) => {
    const { clubId, pcNumber } = data;
    try {
      const session = await GamingSession.findOneAndUpdate(
        { club_id: clubId, pc_number: parseInt(pcNumber), is_active: true },
        { is_active: false, end_time: new Date() },
        { new: true }
      );

      if (session) {
        const room = `pc_room_${clubId}_${pcNumber}`;
        io.to(room).emit('command_lock'); 
        console.log(`🔒 Sessiya yakunlandi (Manual Stop): PC-${pcNumber}`);
        
        // Global yangilash
        io.emit('pc-status-updated-global', { clubId, pcNumber });
      }
      
      socket.emit('stop_success', { message: 'Sessiya yakunlandi', pcNumber });
    } catch (err) {
      console.error('❌ Stop error:', err);
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

// Development uchun qo'shimcha origin'lar
if (process.env.NODE_ENV !== 'production') {
  allOrigins.push('http://localhost:3000');
  allOrigins.push('http://localhost:5173');
  allOrigins.push('http://127.0.0.1:5173');
}

app.use(cors({
  origin: (origin, callback) => {
    // Agar origin bo'lsa va allOrigins ichida bo'lsa yoki origin bo'lmasa (server-to-server) ruxsat beramiz
    if (!origin || allOrigins.includes(origin) || (process.env.NODE_ENV !== 'production' && origin.startsWith('http://localhost'))) {
      callback(null, true);
    } else {
      console.warn(`🚨 CORS rad etildi: ${origin}`);
      callback(new Error('CORS xatosi: Origin ruxsat etilmagan'));
    }
  },
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
if (process.env.NODE_ENV === 'production') {
  app.use('/api', apiLimiter);
} else {
  // Developmentda faqat juda katta limit qo'yamiz (DoS himoyasi uchun)
  app.use('/api', (req, res, next) => {
    // Shunchaki o'tkazib yuboramiz yoki juda katta limit ishlatamiz
    next();
  });
}

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

// ✅ Faol sessiyani tekshirish (Sahifa yangilanganda kerak)
const { protect } = require('./middleware/auth');
app.get('/api/shoxgame/active-session', protect, async (req, res) => {
  try {
    const userId = req.user._id;
    const session = await GamingSession.findOne({ 
      user_id: userId, 
      is_active: true,
      end_time: { $gt: new Date() } // Tugash vaqti o'tib ketmagan bo'lishi kerak
    }).populate('club_id');

    if (!session) {
      return res.status(200).json({ success: true, isActive: false });
    }

    const secondsLeft = Math.floor((session.end_time - new Date()) / 1000);
    
    res.status(200).json({
      success: true,
      isActive: true,
      session: {
        clubId: session.club_id._id,
        clubName: session.club_id.name,
        pcNumber: session.pc_number,
        duration: session.duration,
        secondsLeft: secondsLeft,
        cost: session.cost
      }
    });
  } catch (err) {
    console.error('Active session check error:', err);
    res.status(500).json({ success: false, message: 'Server xatosi' });
  }
});

// ✅ Sessiyani yakunlash (User tomonidan)
app.post('/api/shoxgame/stop-session', protect, async (req, res) => {
  try {
    const userId = req.user._id;
    const session = await GamingSession.findOneAndUpdate(
      { user_id: userId, is_active: true },
      { is_active: false },
      { new: true }
    );

    if (session) {
      const room = `pc_room_${session.club_id.toString()}_${session.pc_number}`;
      console.log(`📡 Sessiya tugatish buyrug'i yuborilmoqda xonaga: ${room}`);
      io.to(room).emit('command_lock'); // Agentni bloklash
      console.log(`🔒 Sessiya yakunlandi: User ${userId}, PC-${session.pc_number}`);

      // Global yangilash
      io.emit('pc-status-updated-global', { clubId: session.club_id.toString(), pcNumber: session.pc_number });
    }

    res.status(200).json({ success: true, message: 'Seans yakunlandi' });
  } catch (err) {
    console.error('Stop session error:', err);
    res.status(500).json({ success: false, message: 'Server xatosi' });
  }
});

app.get('/api/test-unlock', (req, res) => {
    const { pcId } = req.query; // pcId bu yerda xona nomi (masalan: pc_room_69ce7097568627fdb61f9519_2)
    
    if (!pcId) return res.status(400).send("pcId query parametri kerak!");

    // MUHIM: Agent 'command_unlock' kutmoqda, shuning uchun nomini o'zgartiramiz
    // Va unga 'duration' (soniya) ob'ektini yuboramiz
    io.to(pcId).emit('command_unlock', { duration: 60 }); 

    console.log(`🚀 TEST: ${pcId} xonasiga 'command_unlock' buyrug'i yuborildi!`);
    res.send(`Buyruq ${pcId} uchun yuborildi!`);
});
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