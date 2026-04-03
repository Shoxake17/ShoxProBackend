const ComputerClub = require('../models/ComputerClub');
const User = require('../models/User');

// ─── Klub Yaratish (Faqat Super Admin) ───
exports.createClub = async (req, res) => {
  try {
    const { name, address, pcCount, phone, adminId } = req.body;

    if (!name || !address || !pcCount || !phone || !adminId) {
      return res.status(400).json({ success: false, message: "Barcha maydonlar to'ldirilishi shart" });
    }

    // Admin mavjudligini va roli 'admin' ekanligini tekshirish
    const adminUser = await User.findById(adminId);
    if (!adminUser || adminUser.role !== 'admin') {
      return res.status(400).json({ success: false, message: "Noto'g'ri admin ID" });
    }

    // Adminning allaqachon klubi bormi?
    const existingClub = await ComputerClub.findOne({ admin: adminId });
    if (existingClub) {
      return res.status(400).json({ success: false, message: "Ushbu adminda allaqachon klub mavjud" });
    }

    const computers = [];
    for (let i = 1; i <= pcCount; i++) {
      computers.push({
        number: i,
        type: 'standard',
        pricePerHour: 10000,
        isAvailable: true
      });
    }

    const club = await ComputerClub.create({
      name,
      address,
      pcCount,
      phone,
      admin: adminId,
      computers
    });

    res.status(201).json({
      success: true,
      message: "Computer Club muvaffaqiyatli qo'shildi",
      data: club
    });
  } catch (err) {
    console.error('createClub error:', err);
    res.status(500).json({ success: false, message: 'Server xatosi' });
  }
};

// ─── Barcha Klublarni Olish (Hamma uchun) ───
exports.getAllClubs = async (req, res) => {
  try {
    const clubs = await ComputerClub.find().populate('admin', 'firstName lastName email');
    res.status(200).json({
      success: true,
      data: clubs
    });
  } catch (err) {
    console.error('getAllClubs error:', err);
    res.status(500).json({ success: false, message: 'Server xatosi' });
  }
};

// ─── Adminning o'z klubini olish ───
exports.getMyClub = async (req, res) => {
  try {
    const club = await ComputerClub.findOne({ admin: req.user.id });
    if (!club) {
      return res.status(404).json({ success: false, message: "Sizga biriktirilgan klub topilmadi" });
    }

    // Agar klubda kompyuterlar bo'lmasa (eski klublar uchun), ularni yaratamiz
    if (!club.computers || club.computers.length === 0) {
      const computers = [];
      for (let i = 1; i <= (club.pcCount || 0); i++) {
        computers.push({
          number: i,
          type: 'standard',
          pricePerHour: 10000,
          isAvailable: true
        });
      }
      club.computers = computers;
      await club.save();
    }

    res.status(200).json({ success: true, data: club });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server xatosi' });
  }
};

// ─── Klub holatini yangilash (Open/Closed) ───
exports.updateClubStatus = async (req, res) => {
  try {
    const { isOpen } = req.body;
    const club = await ComputerClub.findOneAndUpdate(
      { admin: req.user.id },
      { isOpen },
      { new: true }
    );
    
    // Real-time yangilash
    if (club && req.io) {
      req.io.emit('club-status-updated', { clubId: club._id, isOpen });
      req.io.to(`club_${club._id}`).emit('club-update', club);
    }

    res.status(200).json({ success: true, data: club });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server xatosi' });
  }
};

// ─── Kompyuter ma'lumotlarini yangilash ───
exports.updateComputer = async (req, res) => {
  try {
    const { pcNumber, type, pricePerHour } = req.body;
    const club = await ComputerClub.findOne({ admin: req.user.id });
    
    if (!club) return res.status(404).json({ success: false, message: "Klub topilmadi" });

    const computer = club.computers.find(c => c.number === pcNumber);
    if (!computer) return res.status(404).json({ success: false, message: "Kompyuter topilmadi" });

    if (type) computer.type = type;
    if (pricePerHour) computer.pricePerHour = pricePerHour;

    await club.save();

    // Real-time yangilash
    if (req.io) {
      req.io.to(`club_${club._id}`).emit('computer-updated', { clubId: club._id, computer });
      req.io.to(`club_${club._id}`).emit('club-update', club);
    }

    res.status(200).json({ success: true, data: club });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server xatosi' });
  }
};
