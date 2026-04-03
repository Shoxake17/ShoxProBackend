// utils/email.js — Email Yuborish Utility
const nodemailer = require('nodemailer');

// ─── Transporter Yaratish ───
const createTransporter = () => {
  if (process.env.NODE_ENV === 'development') {
    // Development: Ethereal (test email)
    return nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      auth: {
        user: process.env.EMAIL_USER || 'test@ethereal.email',
        pass: process.env.EMAIL_PASS || 'testpassword'
      }
    });
  }

  // Production: Gmail / SMTP
  return nodemailer.createTransport({
    host:   process.env.EMAIL_HOST || 'smtp.gmail.com',
    port:   parseInt(process.env.EMAIL_PORT) || 587,
    secure: false, // TLS
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    },
    tls: {
      rejectUnauthorized: true
    }
  });
};

// ─── Email Yuborish Funksiyasi ───
const sendEmail = async ({ to, subject, html, text }) => {
  const transporter = createTransporter();

  const mailOptions = {
    from:    process.env.EMAIL_FROM || 'SecureAuth <noreply@secureauth.com>',
    to,
    subject,
    html,
    text:    text || html.replace(/<[^>]*>/g, '') // HTML dan plain text
  };

  try {
    const info = await transporter.sendMail(mailOptions);

    if (process.env.NODE_ENV === 'development') {
      console.log(`📧 Email yuborildi: ${nodemailer.getTestMessageUrl(info)}`);
    }

    return info;
  } catch (err) {
    console.error('Email yuborishda xato:', err);
    throw new Error('Email yuborib bo\'lmadi');
  }
};

module.exports = { sendEmail };