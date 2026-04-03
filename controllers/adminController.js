// controllers/adminController.js — Admin boshqaruv controlleri
const User = require('../models/User');
const Wallet = require('../models/Wallet');

// ─── Tizim statistikasi (Faqat Super Admin) ───
exports.getSystemStats = async (req, res) => {
  try {
    const totalUsers = await User.countDocuments({});
    const totalAdmins = await User.countDocuments({ role: 'admin' });
    const wallets = await Wallet.find({});
    const totalBalance = wallets.reduce((sum, w) => sum + (w.balance || 0), 0);
    const totalTransactions = wallets.reduce((sum, w) => sum + (w.transactions ? w.transactions.length : 0), 0);

    res.status(200).json({
      success: true,
      data: {
        totalUsers,
        totalAdmins,
        totalBalance,
        totalTransactions,
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

    // Agar foydalanuvchi Admin rolga o'tkazilsa, uning kartasi va hamyonini o'chirib tashlaymiz
    if (newRole === 'admin') {
      user.cardNumber = null;
      await Wallet.findOneAndDelete({ user_id: userId });
    } else if (newRole === 'user' && !user.cardNumber) {
      // Adminlikdan qaytarilsa va kartasi bo'lmasa, yangi karta yaratamiz
      // Buning uchun modeldagi generateCardNumber'ni bu yerda ishlatish kerak yoki pre-save mantiqiga tayanish kerak
      // pre-save faqat isNew bo'lsa karta yaratyapti, shuning uchun bu yerda qo'lda yaratamiz
      const prefix = '8600';
      let number = prefix;
      for (let i = 0; i < 12; i++) {
        number += Math.floor(Math.random() * 10).toString();
      }
      user.cardNumber = number;
    }

    user.role = newRole;
    await user.save({ validateBeforeSave: false });

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
