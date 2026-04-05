const ComputerClub = require('../models/ComputerClub');
const User = require('../models/User');
const GamingSession = require('../models/GamingSession');
const PairingCode = require('../models/PairingCode');
const crypto = require('crypto');

const fs = require('fs');
const path = require('path');

// ─── Yangilanishni Tekshirish (Zero-Config Usuli) ───
exports.checkUpdate = async (req, res) => {
  try {
    const currentVersion = req.query.v;
    const updatesDir = path.join(__dirname, '../public/updates');
    
    // Papka bo'lmasa yaratamiz
    if (!fs.existsSync(updatesDir)) {
      fs.mkdirSync(updatesDir, { recursive: true });
    }

    // Papkadagi barcha .exe fayllarni o'qiymiz
    const files = fs.readdirSync(updatesDir).filter(f => f.endsWith('.exe'));
    
    if (files.length === 0) {
      return res.json({ success: true, update_available: false });
    }

    // Versiyalarni solishtirib, eng kattasini topamiz
    // Fayl nomi formati: shoxgame_1.0.5.exe
    const versions = files.map(f => {
      const match = f.match(/_(\d+\.\d+\.\d+)\.exe/);
      return {
        file: f,
        version: match ? match[1] : '0.0.0'
      };
    });

    versions.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true, sensitivity: 'base' }));
    
    const latest = versions[0];
    const updateAvailable = latest.version !== currentVersion;

    res.status(200).json({
      success: true,
      update_available: updateAvailable,
      latest_version: latest.version,
      download_url: `${process.env.SERVER_URL || 'https://your-server.uz'}/updates/${latest.file}`
    });
  } catch (err) {
    console.error('checkUpdate error:', err);
    res.status(500).json({ success: false, message: 'Server xatosi' });
  }
};

// ─── Pairing Code Yaratish (Admin uchun) ───
exports.generatePairingCode = async (req, res) => {
  try {
    const { pcNumber } = req.body;
    const club = await ComputerClub.findOne({ admin: req.user.id });
    
    if (!club) {
      return res.status(404).json({ success: false, message: "Klub topilmadi" });
    }

    const codeRaw = Math.floor(100000 + Math.random() * 900000).toString();
    const formattedCode = `${codeRaw.slice(0, 3)}-${codeRaw.slice(3)}`;

    await PairingCode.deleteMany({ clubId: club._id, pcNumber });

    const newPairing = await PairingCode.create({
      clubId: club._id,
      pcNumber,
      code: formattedCode
    });

    res.status(200).json({
      success: true,
      code: formattedCode,
      expiresAt: newPairing.expiresAt
    });
  } catch (err) {
    console.error('generatePairingCode error:', err);
    res.status(500).json({ success: false, message: 'Server xatosi' });
  }
};

// ─── Agentni Biriktirish (Agent uchun) ───
exports.pairAgent = async (req, res) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ success: false, message: "Kod kiritilishi shart" });
    }

    const pairing = await PairingCode.findOne({ code, isUsed: false });

    if (!pairing) {
      return res.status(404).json({ success: false, message: "Kod noto'g'ri yoki muddati tugagan" });
    }

    pairing.isUsed = true;
    await pairing.save();

    res.status(200).json({
      success: true,
      data: {
        clubId: pairing.clubId,
        pcNumber: pairing.pcNumber,
        serverUrl: process.env.SERVER_URL || 'https://dev-api.shoxpro.uz'
      }
    });
  } catch (err) {
    console.error('pairAgent error:', err);
    res.status(500).json({ success: false, message: 'Server xatosi' });
  }
};

// ─── Klub Yaratish (Faqat Super Admin) ───
exports.createClub = async (req, res) => {
  try {
    const { name, address, pcCount, phone, adminId } = req.body;

    if (!name || !address || !pcCount || !phone || !adminId) {
      return res.status(400).json({ success: false, message: "Barcha maydonlar to'ldirilishi shart" });
    }

    const adminUser = await User.findById(adminId);
    if (!adminUser || adminUser.role !== 'admin') {
      return res.status(400).json({ success: false, message: "Noto'g'ri admin ID" });
    }

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

// ─── Klubni Admin ID orqali olish (Super Admin uchun) ───
exports.getClubByAdmin = async (req, res) => {
  try {
    const { adminId } = req.params;
    const club = await ComputerClub.findOne({ admin: adminId });
    
    if (!club) {
      return res.status(404).json({ success: false, message: "Klub topilmadi" });
    }

    res.status(200).json({ success: true, data: club });
  } catch (err) {
    console.error('getClubByAdmin error:', err);
    res.status(500).json({ success: false, message: 'Server xatosi' });
  }
};

// ─── Klubni yangilash (Faqat Super Admin) ───
exports.updateClubBySuperAdmin = async (req, res) => {
  try {
    const { adminId } = req.params;
    const { name, address, pcCount, phone } = req.body;

    const club = await ComputerClub.findOne({ admin: adminId });
    if (!club) {
      return res.status(404).json({ success: false, message: "Klub topilmadi" });
    }

    club.name = name || club.name;
    club.address = address || club.address;
    club.phone = phone || club.phone;
    
    if (pcCount && Number(pcCount) !== club.pcCount) {
      const newCount = Number(pcCount);
      const currentCount = club.pcCount;
      
      if (newCount > currentCount) {
        for (let i = currentCount + 1; i <= newCount; i++) {
          club.computers.push({
            number: i,
            type: 'standard',
            pricePerHour: 10000,
            isAvailable: true
          });
        }
      } else if (newCount < currentCount) {
        club.computers = club.computers.slice(0, newCount);
      }
      club.pcCount = newCount;
    }

    await club.save();

    res.status(200).json({
      success: true,
      message: "Klub muvaffaqiyatli yangilandi",
      data: club
    });
  } catch (err) {
    console.error('updateClubBySuperAdmin error:', err);
    res.status(500).json({ success: false, message: 'Server xatosi' });
  }
};

// ─── Barcha Klublarni Olish (Hamma uchun) ───
exports.getAllClubs = async (req, res) => {
  try {
    const clubs = await ComputerClub.find().populate('admin', 'firstName lastName email');
    
    const clubsWithSessions = await Promise.all(clubs.map(async (club) => {
      const activeSessions = await GamingSession.find({
        club_id: club._id,
        is_active: true,
        end_time: { $gt: new Date() }
      });

      const clubObj = club.toObject();
      clubObj.computers = clubObj.computers.map(pc => {
        const session = activeSessions.find(s => s.pc_number === pc.number);
        return {
          ...pc,
          activeSession: session ? {
            end_time: session.end_time,
            duration: session.duration
          } : null
        };
      });

      return clubObj;
    }));

    res.status(200).json({
      success: true,
      data: clubsWithSessions
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

    if (req.io) {
      req.io.to(`club_${club._id}`).emit('computer-updated', { clubId: club._id, computer });
      req.io.to(`club_${club._id}`).emit('club-update', club);
    }

    res.status(200).json({ success: true, data: club });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server xatosi' });
  }
};

// ─── Yangi Kompyuter Qo'shish (Admin uchun) ───
exports.addComputer = async (req, res) => {
  try {
    const { type, pricePerHour } = req.body;
    const club = await ComputerClub.findOne({ admin: req.user.id });
    
    if (!club) return res.status(404).json({ success: false, message: "Klub topilmadi" });

    const nextNumber = club.computers.length > 0 
      ? Math.max(...club.computers.map(c => c.number)) + 1 
      : 1;

    club.computers.push({
      number: nextNumber,
      type: type || 'standard',
      pricePerHour: pricePerHour || 10000,
      isAvailable: true
    });

    club.pcCount = club.computers.length;
    await club.save();

    if (req.io) {
      req.io.to(`club_${club._id}`).emit('club-update', club);
    }

    res.status(200).json({ 
      success: true, 
      message: `PC-${nextNumber} muvaffaqiyatli qo'shildi`,
      data: club 
    });
  } catch (err) {
    console.error('addComputer error:', err);
    res.status(500).json({ success: false, message: 'Server xatosi' });
  }
};
