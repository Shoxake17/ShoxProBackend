// controllers/adminController.js — Admin boshqaruv controlleri
const User = require('../models/User');
const Wallet = require('../models/Wallet');
const ComputerClub = require('../models/ComputerClub');

// ─── Tizim statistikasi (Faqat Super Admin) ───
exports.getSystemStats = async (req, res) => {
  try {
    const totalUsers = await User.countDocuments({});
    const totalAdmins = await User.countDocuments({ role: 'admin' });
    const wallets = await Wallet.find({});
    const totalBalance = wallets.reduce((sum, w) => sum + (w.balance || 0), 0);
    const totalTransactions = wallets.reduce((sum, w) => sum + (w.transactions ? w.transactions.length : 0), 0);

    // Computer Club statistikasi
    const totalClubs = await ComputerClub.countDocuments({});
    const clubs = await ComputerClub.find({});
    const totalPcs = clubs.reduce((sum, club) => sum + (club.pcCount || 0), 0);

    res.status(200).json({
      success: true,
      data: {
        totalUsers,
        totalAdmins,
        totalBalance,
        totalTransactions,
        totalClubs,
        totalPcs,
        avgBalance: totalUsers > 0 ? Math.round(totalBalance / totalUsers) : 0
      }
    });
  } catch (err) {
    console.error('getSystemStats error:', err);
    res.status(500).json({ success: false, message: 'Server xatosi' });
  }
};

// ─── Barcha foydalanuvchilarni olish (Admin/Super Admin) ───
exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.find({}).sort({ createdAt: -1 });
    res.status(200).json({
      success: true,
      data: users.map(u => u.toSafeObject())
    });
  } catch (err) {
    console.error('getAllUsers error:', err);
    res.status(500).json({ success: false, message: 'Server xatosi' });
  }
};

// ─── Foydalanuvchi rolini o'zgartirish (Faqat Super Admin) ───
exports.updateUserRole = async (req, res) => {
  try {
    const { userId, newRole } = req.body;

    if (!['user', 'admin'].includes(newRole)) {
      return res.status(400).json({ success: false, message: "Noto'g'ri rol" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Foydalanuvchi topilmadi' });
    }

    // Super Admin o'zini o'zi yoki boshqa Super Adminni o'zgartira olmaydi
    if (user.role === 'super-admin') {
      return res.status(403).json({ success: false, message: 'Super Admin rolini o\'zgartirib bo\'lmaydi' });
    }

    // Agar foydalanuvchi Admin yoki Super Admin rolga o'tkazilsa, uning kartasi va hamyonini o'chirib tashlaymiz
    if (newRole === 'admin' || newRole === 'super-admin') {
      user.cardNumber = undefined; 
      await Wallet.findOneAndDelete({ user_id: userId });
    }

    user.role = newRole;
    // Rol o'zgarganini pre-save hook sezishi uchun uni belgilab qo'yamiz
    user.markModified('role');
    await user.save({ validateBeforeSave: false });

    // Agar user bo'lib qaytsa va hamyoni bo'lmasa hamyon yaratamiz
    if (newRole === 'user') {
      const existingWallet = await Wallet.findOne({ user_id: userId });
      if (!existingWallet) {
        // user.save() dan keyin user.cardNumber yangilangan bo'lishi kerak (hook orqali)
        await Wallet.create({ 
          user_id: userId, 
          card_number: user.cardNumber, 
          balance: 0 
        });
      }
    }

    // Real-time yangilash
    if (req.io) {
      req.io.emit('user-role-updated', { userId, newRole });
      req.io.to(`user_${userId}`).emit('role-changed', { newRole });
    }

    res.status(200).json({
      success: true,
      message: `Foydalanuvchi roli ${newRole} ga o'zgartirildi`,
      data: user.toSafeObject()
    });
  } catch (err) {
    console.error('updateUserRole error:', err);
    res.status(500).json({ success: false, message: 'Server xatosi' });
  }
};

// ─── Masofadan PC-ni boshqarish (Faqat Super Admin) ───
exports.remoteControlPC = async (req, res) => {
  try {
    const { clubId, pcNumber, command, duration } = req.body;

    if (!clubId || !pcNumber || !command) {
      return res.status(400).json({ success: false, message: "Ma'lumotlar yetarli emas" });
    }

    const room = `pc_room_${clubId}_${pcNumber}`;
    const io = req.io;

    if (!io) {
      return res.status(500).json({ success: false, message: "Socket.io ulanishi mavjud emas" });
    }

    if (command === 'unlock') {
      const seconds = duration || 60; // Standart 60 soniya test uchun
      io.to(room).emit('command_unlock', { duration: seconds });
      console.log(`🚀 REMOTE: Super Admin PC-${pcNumber} (Club: ${clubId}) ni ochdi.`);
    } else if (command === 'lock') {
      io.to(room).emit('command_lock');
      console.log(`🔒 REMOTE: Super Admin PC-${pcNumber} (Club: ${clubId}) ni qulfladi.`);
    } else {
      return res.status(400).json({ success: false, message: "Noto'g'ri buyruq" });
    }

    res.status(200).json({
      success: true,
      message: `Buyruq (${command}) PC-${pcNumber} ga yuborildi`
    });
  } catch (err) {
    console.error('remoteControlPC error:', err);
    res.status(500).json({ success: false, message: 'Server xatosi' });
  }
};
