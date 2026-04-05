// routes/adminRoutes.js — Admin boshqaruv yo'llari
const express = require('express');
const router  = express.Router();
const { getAllUsers, updateUserRole, getSystemStats, remoteControlPC } = require('../controllers/adminController');
const { protect, adminOnly, superAdminOnly } = require('../middleware/auth');

// Tizim statistikasi (Faqat Super Admin)
router.get('/stats', protect, superAdminOnly, getSystemStats);

// Masofadan PC-ni boshqarish (Faqat Super Admin)
router.post('/remote-command', protect, superAdminOnly, remoteControlPC);

// Barcha foydalanuvchilar (Admin yoki Super Admin)
router.get('/users', protect, adminOnly, getAllUsers);

// Foydalanuvchi rolini o'zgartirish (Faqat Super Admin)
router.post('/update-role', protect, superAdminOnly, updateUserRole);

module.exports = router;
