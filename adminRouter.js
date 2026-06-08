import express from 'express';
import jwt from 'jsonwebtoken';
import { v2 as cloudinary } from 'cloudinary';
import multer from 'multer';
import PdfNotes from './models/PdfNotes.js';
import User from './models/User.js';

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

router.get('/stats', verifyAdmin, async (req, res) => {
  const [users, pdfs] = await Promise.all([
    User.countDocuments(),
    PdfNotes.countDocuments()
  ]);
  res.json({ users, pdfs });
});

router.get('/users', verifyAdmin, async (req, res) => {
  const users = await User.find({}, '-password');
  res.json(users);
});

router.delete('/users/:id', verifyAdmin, async (req, res) => {
  await User.findByIdAndDelete(req.params.id);
  res.json({ message: 'User deleted' });
});

router.get('/pdfs', verifyAdmin, async (req, res) => {
  const pdfs = await PdfNotes.find({});
  res.json(pdfs);
});

router.post('/pdfs', verifyAdmin, async (req, res) => {
  try {
    const { title, semester, subject, s3Url } = req.body;
    const pdf = await PdfNotes.create({ title, semester, subject, s3Url });
    res.status(201).json(pdf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/pdfs/upload', verifyAdmin, upload.single('pdf'), async (req, res) => {
  try {
    const { title, semester, subject } = req.body;

    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    if (!title || !semester || !subject) return res.status(400).json({ error: 'Title, semester and subject required' });

    const uploadResult = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          resource_type: 'auto',
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
      s3Url: uploadResult.secure_url,
    });

    res.status(201).json(pdf);
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/pdfs/:id', verifyAdmin, async (req, res) => {
  await PdfNotes.findByIdAndDelete(req.params.id);
  res.json({ message: 'PDF deleted' });
});

router.post('/seed', verifyAdmin, async (req, res) => {
  res.json({ message: 'Hit /api/dev/seed to trigger seeding' });
});

export default router;