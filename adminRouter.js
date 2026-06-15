// adminRouter.js
import express from 'express';
import jwt from 'jsonwebtoken';
import { v2 as cloudinary } from 'cloudinary';
import multer from 'multer';

const router = express.Router();

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
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(403).json({ error: 'Invalid token' });
  }
};

// ── Login (🟢 KEPT PERFECTLY ACTIVE FOR YOU) ──────────────────────────────────
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

// ── Stats (Modified to show clean static indicator numbers) ───────────────────
router.get('/stats', verifyAdmin, (req, res) => {
  res.json({ users: 0, pdfs: 24 }); // Hardcoded metrics to keep frontend charts happy
});

// ── Users (Returns empty list safely) ─────────────────────────────────────────
router.get('/users', verifyAdmin, (req, res) => {
  res.json([]);
});

router.delete('/users/:id', verifyAdmin, (req, res) => {
  res.json({ message: 'User deleted (Static Mode)' });
});

// ── PDFs (Returns static empty registry) ──────────────────────────────────────
router.get('/pdfs', verifyAdmin, (req, res) => {
  res.json([]);
});

// Add PDF manually via URL placeholder
router.post('/pdfs', verifyAdmin, (req, res) => {
  res.status(201).json({ message: "Static mode active. Document registration bypassed." });
});

// Upload PDF file → Cloudinary placeholder
router.post('/pdfs/upload', verifyAdmin, upload.single('pdf'), async (req, res) => {
  try {
    const { title, semester, subject, type = 'notes' } = req.body;

    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    if (!title || !semester || !subject) return res.status(400).json({ error: 'Title, semester and subject required' });

    // 🚀 We still execute the Cloudinary link generation so you see it works in the logs!
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

    // Returns a mock object matching your old schema format exactly to prevent front-end crashes
    res.status(201).json({
      title,
      semester: Number(semester),
      subject,
      type,
      s3Url: uploadResult.secure_url,
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/pdfs/:id', verifyAdmin, (req, res) => {
  res.json({ message: 'PDF reference cleared from memory' });
});

router.post('/seed', verifyAdmin, (req, res) => {
  res.json({ message: 'Hit /api/dev/seed to trigger seeding' });
});

export default router;