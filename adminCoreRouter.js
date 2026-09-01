// adminCoreRouter.js
import express from 'express';
import jwt from 'jsonwebtoken';
import User from './models/User.js';
import Request from './models/Request.js';
import Subject from './models/Subject.js';
import PdfNotes from './models/PdfNotes.js';

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'studynexus_jwt_secret_key_2026';
const ADMIN_USER = process.env.ADMIN_USERNAME || 'shivansh';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'admin123';

export const verifyAdmin = (req, res, next) => {
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

// ── Auth ──────────────────────────────────────────────────────────────────────
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '8h' });
    return res.json({ token });
  }
  return res.status(401).json({ error: 'Invalid credentials' });
});

// ── Platform Stats ────────────────────────────────────────────────────────────
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

router.get('/subjects/:semId', async (req, res) => {
  try {
    const { semId } = req.params;
    const subjects = await Subject.find({ semId: String(semId) }).sort({ name: 1 }).lean();
    return res.json(subjects);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch semester subjects', details: err.message });
  }
});

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

router.delete('/subjects/:id', verifyAdmin, async (req, res) => {
  try {
    await Subject.findByIdAndDelete(req.params.id);
    return res.json({ message: 'Subject removed from directory' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

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

router.get('/requests', verifyAdmin, async (req, res) => {
  try {
    const requests = await Request.find({}).sort({ createdAt: -1 }).lean();
    return res.json(requests);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.patch('/requests/:id/status', verifyAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    const updated = await Request.findByIdAndUpdate(req.params.id, { status }, { new: true });
    return res.json(updated);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/requests/:id', verifyAdmin, async (req, res) => {
  try {
    await Request.findByIdAndDelete(req.params.id);
    return res.json({ message: 'Request resolved and removed' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── User Management ───────────────────────────────────────────────────────────
router.get('/users', verifyAdmin, async (req, res) => {
  try {
    const users = await User.find({}, '-password').lean();
    return res.json(users);
  } catch (err) {
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

router.post('/seed', verifyAdmin, async (req, res) => {
  return res.json({ message: 'Hit /api/dev/seed to trigger seeding' });
});

export default router;