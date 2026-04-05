const express = require('express');
const router  = express.Router();
const { 
  createClub, 
  getAllClubs, 
  getMyClub, 
  updateClubStatus, 
  updateComputer, 
  addComputer,
  getClubByAdmin, 
  updateClubBySuperAdmin,
  generatePairingCode,
  pairAgent,
  checkUpdate
} = require('../controllers/clubController');
const { protect, superAdminOnly } = require('../middleware/auth');

// Barcha klublarni olish
router.get('/', protect, getAllClubs);

// Admin o'z klubini olishi
router.get('/my-club', protect, getMyClub);

// Admin yangi kompyuter qo'shishi
router.post('/add-computer', protect, addComputer);

// Super Admin ma'lum bir adminning klubini olishi
router.get('/admin/:adminId', protect, superAdminOnly, getClubByAdmin);

// Super Admin klub ma'lumotlarini yangilashi
router.put('/admin/:adminId', protect, superAdminOnly, updateClubBySuperAdmin);

// Klub holatini yangilash (Open/Closed)
router.patch('/status', protect, updateClubStatus);

// Kompyuter ma'lumotlarini yangilash
router.patch('/computer', protect, updateComputer);

// Yangi klub yaratish (Faqat Super Admin)
router.post('/create', protect, superAdminOnly, createClub);

// Agentni biriktirish (Ochiq API)
router.post('/pair-agent', pairAgent);

// Admin pairing code yaratishi
router.post('/pairing-code', protect, generatePairingCode);

// Yangilanishni tekshirish (Ochiq API)
router.get('/check-update', checkUpdate);

module.exports = router;
