import express from 'express';
import jwt from 'jsonwebtoken';
import { v2 as cloudinary } from 'cloudinary';
import multer from 'multer';
import PdfNotes from './models/PdfNotes.js';
import User from './models/User.js';
import Request from './models/Request.js';
import Subject from './models/Subject.js';

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
    const [users, pdfs, pendingRequests, pendingUploads, subjectsCount] = await Promise.all([
      User.countDocuments().catch(() => 0),
      PdfNotes.countDocuments({ $or: [{ status: 'approved' }, { status: { $exists: false } }] }).catch(() => 0),
      Request.countDocuments().catch(() => 0),
      PdfNotes.countDocuments({ status: 'pending' }).catch(() => 0),
      Subject.countDocuments().catch(() => 0)
    ]);
    return res.json({ users, pdfs, pendingRequests, pendingUploads, subjectsCount });
  } catch (err) {
    console.error('Stats error:', err);
    return res.status(500).json({ users: 0, pdfs: 0, pendingRequests: 0, error: err.message });
  }
});

// ── Subject Catalog & Dropdown Sources ────────────────────────────────────────

// Public & Modal: Get subjects list for dropdowns (Filtered by semId)
router.get('/subjects', async (req, res) => {
  try {
    const { semId, semester } = req.query;
    const targetSem = semId || semester;
    const filter = targetSem ? { semId: String(targetSem) } : {};
    const subjects = await Subject.find(filter).sort({ name: 1 }).lean();
    return res.json(subjects);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch subjects', details: err.message });
  }
});

// Admin: Add a new subject to the predefined catalog
router.post('/subjects', verifyAdmin, async (req, res) => {
  try {
    const { name, semId, semester, code, credits } = req.body;
    const targetSem = String(semId || semester);

    if (!name || !targetSem) {
      return res.status(400).json({ error: 'Subject name and semester are required' });
    }

    const newSubject = await Subject.create({
      name: name.trim(),
      semId: targetSem,
      code: code ? code.trim() : `SEM-${targetSem}`,
      credits: credits || '4'
    });

    return res.status(201).json(newSubject);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to add subject', details: err.message });
  }
});

// Admin: Delete a subject from catalog
router.delete('/subjects/:id', verifyAdmin, async (req, res) => {
  try {
    await Subject.findByIdAndDelete(req.params.id);
    return res.json({ message: 'Subject removed from directory' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Admin: One-click sync 105 existing PDFs into predefined subjects
router.post('/subjects/sync-existing', verifyAdmin, async (req, res) => {
  try {
    const existingPdfs = await PdfNotes.find({}, 'subject semester').lean();
    let created = 0;

    for (const pdf of existingPdfs) {
      if (!pdf.subject || !pdf.semester) continue;
      const cleanName = pdf.subject.trim();
      const semStr = String(pdf.semester);

      const exists = await Subject.findOne({ name: cleanName, semId: semStr });
      if (!exists) {
        await Subject.create({
          name: cleanName,
          semId: semStr,
          code: `SEM-${semStr}`
        });
        created++;
      }
    }

    return res.json({ message: `Synced successfully! Registered ${created} standard subjects.`, created });
  } catch (err) {
    return res.status(500).json({ error: 'Sync failed', details: err.message });
  }
});

// ── Student PDF Requests ──────────────────────────────────────────────────────

// Public: Submit notes/PYQ request
router.post('/requests/new', async (req, res) => {
  try {
    const { name, semester, message } = req.body;
    if (!semester || !message) {
      return res.status(400).json({ error: 'Semester and message are required' });
    }

    const newRequest = await Request.create({
      name: name?.trim() || 'Anonymous Student',
      semester: String(semester),
      message: message.trim(),
    });

    return res.status(201).json(newRequest);
  } catch (err) {
    console.error('Error creating request:', err);
    return res.status(500).json({ error: err.message });
  }
});

// Public: Recent requests ticker feed
router.get('/requests/recent', async (req, res) => {
  try {
    const recent = await Request.find({})
      .sort({ createdAt: -1 })
      .limit(6)
      .lean();
    return res.json(recent);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Admin: View all requests
router.get('/requests', verifyAdmin, async (req, res) => {
  try {
    const requests = await Request.find({}).sort({ createdAt: -1 }).lean();
    return res.json(requests);
  } catch (err) {
    console.error('Fetch requests error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// Admin: Update request status
router.patch('/requests/:id/status', verifyAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    const updated = await Request.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );
    return res.json(updated);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Admin: Resolve / remove request
router.delete('/requests/:id', verifyAdmin, async (req, res) => {
  try {
    await Request.findByIdAndDelete(req.params.id);
    return res.json({ message: 'Request resolved and removed' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── Public Submissions & Moderation Queue ─────────────────────────────────────

// Public: Submit study material via direct PDF upload OR URL (Queued for admin review)
router.post('/notes/submit-file', upload.single('pdf'), async (req, res) => {
  try {
    const { title, subject, semester, type, fileUrl, uploaderName } = req.body;

    if (!title || !subject || !semester) {
      return res.status(400).json({ error: 'Title, subject, and semester are required' });
    }

    let finalPdfUrl = fileUrl;

    // Handle physical PDF file uploaded to Cloudinary
    if (req.file) {
      const uploadResult = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            resource_type: 'raw',
            folder: 'studynexus/community_uploads',
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
      finalPdfUrl = uploadResult.secure_url;
    }

    if (!finalPdfUrl) {
      return res.status(400).json({ error: 'Please select a PDF file or provide a valid link' });
    }

    const note = await PdfNotes.create({
      title: title.trim(),
      subject: subject.trim(),
      semester: Number(semester),
      type: type || 'Notes',
      s3Url: finalPdfUrl.trim(),
      uploaderName: uploaderName?.trim() || 'Student Contributor',
      status: 'pending'
    });

    return res.status(201).json({
      message: 'Resource submitted successfully! Waiting for admin review.',
      note
    });
  } catch (err) {
    console.error('File submission error:', err);
    return res.status(500).json({ error: 'Upload failed', details: err.message });
  }
});

// Public: Submit study material via JSON link (Fallback)
router.post('/notes/submit', async (req, res) => {
  try {
    const { title, subject, semester, type, s3Url, fileUrl, uploaderName } = req.body;
    const pdfUrl = s3Url || fileUrl;

    if (!title || !subject || !semester || !pdfUrl) {
      return res.status(400).json({ error: 'Title, subject, semester, and PDF link are required' });
    }

    const note = await PdfNotes.create({
      title: title.trim(),
      subject: subject.trim(),
      semester: Number(semester),
      type: type || 'notes',
      s3Url: pdfUrl.trim(),
      uploaderName: uploaderName?.trim() || 'Student Contributor',
      status: 'pending'
    });

    return res.status(201).json({ 
      message: 'Request submitted! Waiting for admin approval.', 
      note 
    });
  } catch (err) {
    return res.status(500).json({ error: 'Submission failed', details: err.message });
  }
});

// Admin: Get all pending submissions
router.get('/notes/pending', verifyAdmin, async (req, res) => {
  try {
    const pending = await PdfNotes.find({ status: 'pending' }).sort({ uploadedAt: -1 }).lean();
    return res.json(pending);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch pending submissions' });
  }
});

// Admin: Approve submission
router.patch('/notes/:id/approve', verifyAdmin, async (req, res) => {
  try {
    const approved = await PdfNotes.findByIdAndUpdate(
      req.params.id,
      { status: 'approved' },
      { new: true }
    );
    return res.json({ message: 'Submission approved and published live!', note: approved });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to approve note' });
  }
});

// Admin: Reject submission
router.delete('/notes/:id/reject', verifyAdmin, async (req, res) => {
  try {
    await PdfNotes.findByIdAndDelete(req.params.id);
    return res.json({ message: 'Submission rejected and removed' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to reject note' });
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

// ── PDFs (Approved / Admin Direct) ────────────────────────────────────────────
router.get('/pdfs', verifyAdmin, async (req, res) => {
  try {
    const pdfs = await PdfNotes.find({}).lean();
    return res.json(pdfs);
  } catch (err) {
    console.error('Fetch PDFs error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// Admin direct upload via URL (Instantly approved)
router.post('/pdfs', verifyAdmin, async (req, res) => {
  try {
    const { title, semester, subject, type, s3Url, fileUrl } = req.body;
    const pdf = await PdfNotes.create({
      title: title.trim(),
      semester: Number(semester),
      subject: subject.trim(),
      type: type || 'notes',
      s3Url: (s3Url || fileUrl).trim(),
      status: 'approved'
    });
    return res.status(201).json(pdf);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Admin direct upload via Cloudinary file (Instantly approved)
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
      title: title.trim(),
      semester: Number(semester),
      subject: subject.trim(),
      type: type || 'notes',
      s3Url: uploadResult.secure_url,
      status: 'approved'
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