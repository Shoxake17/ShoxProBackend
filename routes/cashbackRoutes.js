// ShoxProBackend: routes/cashbackRoutes.js
'use strict';

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const crypto = require('crypto');
const CashbackReceipt = require('../models/CashbackReceipt');
const Wallet = require('../models/Wallet');
const User = require('../models/User');
const { protect } = require('../middleware/auth');

// Konfiguratsiyadan kalitlarni olish
const SHOXPOSPRO_SECRET = process.env.SHOXPOSPRO_SECRET || 'shoxpospro-secret-2024';
const QR_SECRET_KEY = process.env.QR_SECRET_KEY || 'shox-pos-pro-qr-secret-2026';

/**
 * 🛡️ Server-to-Server Auth Middleware (ShoxPosPro Proxy uchun)
 */
function verifyPosSecret(req, res, next) {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey || apiKey !== SHOXPOSPRO_SECRET) {
        return res.status(403).json({ success: false, message: "Ruxsat etilmagan kirish (Invalid API Key)" });
    }
    next();
}

/**
 * @route   POST /api/cashback/register
 * @desc    ShoxPosPro dan yangi chekni ro'yxatga olish
 */
router.post('/register', verifyPosSecret, async (req, res) => {
    try {
        const { receiptId, totalAmount, storeName, timestamp, signature } = req.body;

        if (!receiptId || !totalAmount) {
            return res.status(400).json({ success: false, message: 'receiptId va totalAmount majburiy' });
        }
        
        if (!/^\d{12}$/.test(receiptId)) {
            return res.status(400).json({ success: false, message: "receiptId 12 ta raqam bo'lishi kerak" });
        }

        const existing = await CashbackReceipt.findOne({ receipt_id: receiptId });
        if (existing) {
            return res.status(409).json({ success: false, message: 'Bu chek allaqachon ro‘yxatdan o‘tgan' });
        }

        const cashbackAmount = Math.floor(totalAmount * 0.01);
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 soat muddat

        await CashbackReceipt.create({
            receipt_id: receiptId,
            total_amount: totalAmount,
            cashback_amount: cashbackAmount,
            store_name: storeName || '{club.name}',
            expires_at: expiresAt,
            is_used: false,
            qr_signature: signature,
            created_at: timestamp || new Date()
        });

        console.log(`✅ Register: ${receiptId} (${cashbackAmount} so'm)`);
        return res.status(201).json({ success: true, receiptId, cashbackAmount });
    } catch (err) {
        console.error('❌ Register error:', err.message);
        return res.status(500).json({ success: false, message: 'Server xatosi yuz berdi' });
    }
});

/**
 * @route   POST /api/cashback/claim
 * @desc    HMAC Verify va Tranzaksiya bilan keshbek olish
 */
router.post('/claim', protect, async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { receiptId, timestamp, signature } = req.body;
        const userId = req.user._id;

        if (!receiptId) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({ success: false, message: 'receiptId yuborilmadi' });
        }

        // 🛡️ 1. HMAC SIGNATURE VERIFICATION
        if (signature && timestamp) {
            const dataToVerify = `${receiptId}|${timestamp}`;
            
            const expectedSignature = crypto
                .createHmac('sha256', QR_SECRET_KEY)
                .update(dataToVerify)
                .digest('hex')
                .substring(0, 12);

            if (signature !== expectedSignature) {
                console.warn(`🚨 SOXTA QR: User ${userId} noto'g'ri imzo yubordi!`);
                await session.abortTransaction();
                session.endSession();
                return res.status(403).json({ 
                    success: false, 
                    status: 'INVALID_SIGNATURE', 
                    message: 'Xavfsizlik xatosi: QR kod qalbaki yoki vaqti noto‘g‘ri!' 
                });
            }
        }

        // 2. Foydalanuvchi va Chekni tekshirish
        const user = await User.findById(userId).select('cardNumber firstName').session(session);
        if (!user || !user.cardNumber) {
            throw new Error('Foydalanuvchi ma’lumotlari topilmadi');
        }

        const receipt = await CashbackReceipt.findOne({ receipt_id: receiptId }).session(session);
        
        if (!receipt) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({ success: false, status: 'NOT_FOUND', message: 'Chek topilmadi' });
        }

        if (receipt.is_used) {
            await session.abortTransaction();
            session.endSession();
            return res.status(409).json({ success: false, status: 'ALREADY_USED', message: 'Keshbek allaqachon olingan' });
        }

        if (new Date() > receipt.expires_at) {
            await session.abortTransaction();
            session.endSession();
            return res.status(410).json({ success: false, status: 'EXPIRED', message: 'Chek muddati tugagan' });
        }

        // 3. Chekni ishlatilgan deb belgilash
        receipt.is_used = true;
        receipt.used_at = new Date();
        receipt.claimed_by = userId;
        receipt.user_phone = user.cardNumber;
        await receipt.save({ session });

        // 4. Hamyonni yangilash
        const updatedWallet = await Wallet.findOneAndUpdate(
            { user_id: userId },
            {
                $inc: { balance: receipt.cashback_amount },
                $set: { updated_at: new Date(), card_number: user.cardNumber },
                $push: { 
                    transactions: { 
                        type: 'cashback', 
                        amount: receipt.cashback_amount, 
                        receipt_id: receiptId, 
                        store_name: receipt.store_name, 
                        description: `${receipt.store_name} dan keshbek`,
                        created_at: new Date() 
                    } 
                },
            },
            { new: true, upsert: true, session }
        );

        // TRANZAKSIYANI TASDIQLASH
        await session.commitTransaction();
        session.endSession();

        console.log(`💰 Muvaffaqiyatli Claim: ${receiptId} -> ${user.firstName}`);

        // Real-time balans yangilash
        if (req.io) {
            req.io.to(`user_${userId}`).emit('balance-updated', { balance: updatedWallet.balance });
        }
        
        // ✅ MUHIM: totalAmount ham qaytarilmoqda
        return res.status(200).json({
            success: true,
            status: 'SUCCESS',
            cashbackAmount: receipt.cashback_amount,
            totalAmount: receipt.total_amount, // <-- BU YERDA UNDEFINED BO'LMASLIGI UCHUN
            newBalance: updatedWallet.balance,
            storeName: receipt.store_name
        });

    } catch (err) {
        if (session.inTransaction()) {
            await session.abortTransaction();
        }
        session.endSession();
        console.error('❌ Claim Error:', err.message);
        return res.status(500).json({ success: false, message: 'Server xatosi yuz berdi' });
    }
});

/**
 * @route   GET /api/cashback/wallet
 */
router.get('/wallet', protect, async (req, res) => {
    try {
        const wallet = await Wallet.findOne({ user_id: req.user._id });
        const user = await User.findById(req.user._id).select('cardNumber');

        return res.json({
            success: true,
            balance: wallet ? wallet.balance : 0,
            cardNumber: user ? user.cardNumber : '—',
            transactions: wallet ? [...wallet.transactions].reverse().slice(0, 20) : []
        });
    } catch (err) {
        console.error('Wallet Error:', err.message);
        return res.status(500).json({ success: false, message: 'Hamyon ma’lumotlarini yuklab bo‘lmadi' });
    }
});

/**
 * @route   GET /api/cashback/pos-check/:receiptId
 */
router.get('/pos-check/:receiptId', verifyPosSecret, async (req, res) => {
    try {
        const receipt = await CashbackReceipt.findOne({ receipt_id: req.params.receiptId });
        if (!receipt) return res.status(404).json({ success: false, message: 'Topilmadi' });

        return res.json({
            success: true,
            receiptId: receipt.receipt_id,
            isUsed: receipt.is_used,
            isExpired: new Date() > receipt.expires_at,
            cashbackAmount: receipt.cashback_amount
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Server xatosi' });
    }
});

module.exports = router;