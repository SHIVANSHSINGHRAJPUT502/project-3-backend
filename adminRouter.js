import express from 'express';
import jwt from 'jsonwebtoken';
import { v2 as cloudinary } from 'cloudinary';
import multer from 'multer';
import PdfNotes from './models/PdfNotes.js';
import User from './models/User.js';

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'studynexus_jwt_secret_key_2026';
const ADMIN_USER = process.env.ADMIN_USERNAME || 'shivansh';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'admin123';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files allowed'));
  }
});

const verifyAdmin = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.split(' ')[1]
      : req.headers['x-access-token'];

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    req.admin = decoded;
    next();
  } catch {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
};

// ── Login ─────────────────────────────────────────────────────────────────────
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '8h' });
    return res.json({ token });
  }
  return res.status(401).json({ error: 'Invalid credentials' });
});

// ── Stats ─────────────────────────────────────────────────────────────────────
router.get('/stats', verifyAdmin, async (req, res) => {
  try {
    const [users, pdfs] = await Promise.all([
      User.countDocuments().catch(() => 0),
      PdfNotes.countDocuments().catch(() => 0)
    ]);
    return res.json({ users, pdfs });
  } catch (err) {
    console.error('Stats error:', err);
    return res.status(500).json({ users: 0, pdfs: 0, error: err.message });
  }
});

// ── Users ─────────────────────────────────────────────────────────────────────
router.get('/users', verifyAdmin, async (req, res) => {
  try {
    const users = await User.find({}, '-password').lean();
    return res.json(users);
  } catch (err) {
    console.error('Fetch users error:', err);
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/users/:id', verifyAdmin, async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    return res.json({ message: 'User deleted' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── PDFs ──────────────────────────────────────────────────────────────────────
router.get('/pdfs', verifyAdmin, async (req, res) => {
  try {
    const pdfs = await PdfNotes.find({}).lean();
    return res.json(pdfs);
  } catch (err) {
    console.error('Fetch PDFs error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// Add PDF manually via URL
router.post('/pdfs', verifyAdmin, async (req, res) => {
  try {
    const { title, semester, subject, type, s3Url } = req.body;
    const pdf = await PdfNotes.create({
      title,
      semester: Number(semester),
      subject,
      type: type || 'notes',
      s3Url
    });
    return res.status(201).json(pdf);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Upload PDF file → Cloudinary → save URL in MongoDB
router.post('/pdfs/upload', verifyAdmin, upload.single('pdf'), async (req, res) => {
  try {
    const { title, semester, subject, type } = req.body;

    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    if (!title || !semester || !subject) {
      return res.status(400).json({ error: 'Title, semester and subject required' });
    }

    const uploadResult = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          resource_type: 'raw',
          folder: 'studynexus/pdfs',
          public_id: `sem${semester}_${Date.now()}`,
          access_mode: 'public',
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      stream.end(req.file.buffer);
    });

    const pdf = await PdfNotes.create({
      title,
      semester: Number(semester),
      subject,
      type: type || 'notes',
      s3Url: uploadResult.secure_url,
    });

    return res.status(201).json(pdf);
  } catch (err) {
    console.error('Upload error:', err);
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/pdfs/:id', verifyAdmin, async (req, res) => {
  try {
    await PdfNotes.findByIdAndDelete(req.params.id);
    return res.json({ message: 'PDF deleted' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/seed', verifyAdmin, async (req, res) => {
  return res.json({ message: 'Hit /api/dev/seed to trigger seeding' });
});

export default router;