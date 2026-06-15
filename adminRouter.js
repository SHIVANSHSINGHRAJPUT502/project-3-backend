// adminRouter.js
import express from 'express';
import jwt from 'jsonwebtoken';
import { v2 as cloudinary } from 'cloudinary';
import multer from 'multer';
import fs from 'fs';
import path from 'path';

const router = express.Router();
const DATA_FILE = path.resolve('./data.json');

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

const getLocalData = () => {
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({ pdfs: [] }, null, 2));
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
};

const saveLocalData = (data) => {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
};

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

// ── Login ─────────────────────────────────────────────────────────────────────
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
    const token = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '8h' });
    return res.json({ token });
  }
  res.status(401).json({ error: 'Invalid credentials' });
});

// ── Stats ─────────────────────────────────────────────────────────────────────
router.get('/stats', verifyAdmin, (req, res) => {
  const data = getLocalData();
  res.json({ users: 0, pdfs: data.pdfs.length });
});

// ── Get All PDFs in Admin Dashboard ───────────────────────────────────────────
router.get('/pdfs', verifyAdmin, (req, res) => {
  const data = getLocalData();
  res.json(data.pdfs);
});

// ── Add PDF Manually via URL (🟢 NOW GENERATES MONGO-STYLE _id) ───────────────
router.post('/pdfs', verifyAdmin, (req, res) => {
  try {
    const { title, semester, subject, type, s3Url } = req.body;
    const data = getLocalData();

    // Generate a hex-style 24-character random string to mock MongoDB ObjectId
    const fakeObjectId = [...Array(24)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');

    const newPdf = {
      _id: fakeObjectId, // ✅ Mimicking MongoDB native identifier
      title,
      semester: Number(semester),
      subject,
      type: type || 'notes',
      s3Url,
      uploadedAt: new Date().toISOString()
    };

    data.pdfs.push(newPdf);
    saveLocalData(data);

    res.status(201).json(newPdf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Upload PDF file → Cloudinary → Save into Local JSON DB ────────────────────
router.post('/pdfs/upload', verifyAdmin, upload.single('pdf'), async (req, res) => {
  try {
    const { title, semester, subject, type = 'notes' } = req.body;

    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    if (!title || !semester || !subject) return res.status(400).json({ error: 'Title, semester and subject required' });

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

    const data = getLocalData();
    const fakeObjectId = [...Array(24)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');

    const newPdf = {
      _id: fakeObjectId, // ✅ Mimicking MongoDB native identifier
      title,
      semester: Number(semester),
      subject,
      type,
      s3Url: uploadResult.secure_url,
      uploadedAt: new Date().toISOString()
    };

    data.pdfs.push(newPdf);
    saveLocalData(data);

    res.status(201).json(newPdf);
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Delete PDF ────────────────────────────────────────────────────────────────
router.delete('/pdfs/:id', verifyAdmin, (req, res) => {
  const data = getLocalData();
  data.pdfs = data.pdfs.filter(pdf => pdf._id !== req.params.id); // ✅ Checks against _id
  saveLocalData(data);
  res.json({ message: 'PDF completely deleted from memory file' });
});

export default router;