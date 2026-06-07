import express from 'express';
import jwt from 'jsonwebtoken';
import PdfNotes from './models/PdfNotes.js';
import User from './models/User.js';

const router = express.Router();

// ── AUTH MIDDLEWARE ──────────────────────────────
const verifyAdmin = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(403).json({ error: 'Invalid token' });
  }
};

// ── LOGIN ────────────────────────────────────────
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (
    username === process.env.ADMIN_USERNAME &&
    password === process.env.ADMIN_PASSWORD
  ) {
    const token = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '8h' });
    return res.json({ token });
  }
  res.status(401).json({ error: 'Invalid credentials' });
});

// ── STATS ────────────────────────────────────────
router.get('/stats', verifyAdmin, async (req, res) => {
  const [users, pdfs] = await Promise.all([
    User.countDocuments(),
    PdfNotes.countDocuments()
  ]);
  res.json({ users, pdfs });
});

// ── USERS ────────────────────────────────────────
router.get('/users', verifyAdmin, async (req, res) => {
  const users = await User.find({}, '-password');
  res.json(users);
});

router.delete('/users/:id', verifyAdmin, async (req, res) => {
  await User.findByIdAndDelete(req.params.id);
  res.json({ message: 'User deleted' });
});

// ── PDFS ─────────────────────────────────────────
router.get('/pdfs', verifyAdmin, async (req, res) => {
  const pdfs = await PdfNotes.find({});
  res.json(pdfs);
});

router.post('/pdfs', verifyAdmin, async (req, res) => {
  const { title, semester, subject, s3Url } = req.body;
  const pdf = await PdfNotes.create({ title, semester, subject, s3Url });
  res.status(201).json(pdf);
});

router.delete('/pdfs/:id', verifyAdmin, async (req, res) => {
  await PdfNotes.findByIdAndDelete(req.params.id);
  res.json({ message: 'PDF deleted' });
});

// ── SEED ─────────────────────────────────────────
router.post('/seed', verifyAdmin, async (req, res) => {
  res.json({ message: 'Hit /api/dev/seed to trigger seeding' });
});

export default router;