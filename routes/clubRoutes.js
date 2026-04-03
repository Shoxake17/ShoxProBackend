const express = require('express');
const router  = express.Router();
const { createClub, getAllClubs, getMyClub, updateClubStatus, updateComputer } = require('../controllers/clubController');
const { protect, superAdminOnly } = require('../middleware/auth');

// Barcha klublarni olish
router.get('/', protect, getAllClubs);

// Admin o'z klubini olishi
router.get('/my-club', protect, getMyClub);

// Klub holatini yangilash (Open/Closed)
router.patch('/status', protect, updateClubStatus);

// Kompyuter ma'lumotlarini yangilash
router.patch('/computer', protect, updateComputer);

// Yangi klub yaratish (Faqat Super Admin)
router.post('/create', protect, superAdminOnly, createClub);

module.exports = router;
