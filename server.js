// server.js
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import BackendAiRouter from './BackendAiRouter.js';
import adminRouter from './adminRouter.js';
import PdfNotes from './models/PdfNotes.js';
import Subject from './models/Subject.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// 1. Mandatory CORS headers at the very first layer
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-access-token');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// ─── In-Memory Heartbeat Engine ──────────────────────────────────────────────
const activeVisitors = new Map();

// ─── Serverless-Optimized Database Connector ─────────────────────────────────
let cachedConn = null;

const connectDB = async () => {
  if (cachedConn && mongoose.connection.readyState === 1) {
    return cachedConn;
  }
  if (!process.env.MONGO_URI) {
    console.error('⚠️ MONGO_URI is missing in environment variables!');
    return null;
  }
  try {
    cachedConn = await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 30000,
    });
    console.log('🔮 Connected safely to MongoDB Atlas!');
    return cachedConn;
  } catch (err) {
    console.error('❌ MongoDB Connection Error:', err.message);
    return null;
  }
};

// ─── Heartbeat Routes (Fast & Zero DB Dependency) ────────────────────────────
app.post('/api/heartbeat', (req, res) => {
  const visitorId = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || req.ip || 'node';
  activeVisitors.set(visitorId, Date.now());
  return res.status(200).json({ status: 'alive' });
});

app.get('/api/active-users', (req, res) => {
  const now = Date.now();
  const timeout = 45 * 1000;
  for (const [id, lastSeen] of activeVisitors.entries()) {
    if (now - lastSeen > timeout) activeVisitors.delete(id);
  }
  return res.json({ count: Math.max(1, activeVisitors.size) });
});

// ─── Subjects Route (Awaits DB connection cleanly) ───────────────────────────
app.get('/api/subjects/:semId', async (req, res) => {
  try {
    await connectDB();
    const sem = String(req.params.semId);
    
    if (mongoose.connection.readyState === 1) {
      const catalog = await Subject.find({ semId: sem }).sort({ name: 1 }).lean().catch(() => []);
      if (catalog && catalog.length > 0) {
        return res.status(200).json(catalog.map(s => s.name));
      }

      const pdfSubjects = await PdfNotes.distinct('subject', { semester: Number(sem) }).catch(() => []);
      if (pdfSubjects && pdfSubjects.length > 0) {
        return res.status(200).json(pdfSubjects);
      }
    }
    return res.status(200).json([]);
  } catch (err) {
    console.error('Error in /api/subjects:', err.message);
    return res.status(200).json([]);
  }
});

// ─── PDF Notes Fetch ─────────────────────────────────────────────────────────
app.get('/api/notes/:semester/:subject/:type', async (req, res) => {
  try {
    await connectDB();
    const { semester, subject, type } = req.params;
    
    if (mongoose.connection.readyState !== 1) return res.status(200).json([]);

    const query = {
      semester: Number(semester),
      subject: decodeURIComponent(subject),
      $or: [
        { status: 'approved' },
        { status: { $exists: false } }
      ]
    };
    if (type && type !== 'undefined' && type !== 'null') {
      query.type = type;
    }

    const pdfs = await PdfNotes.find(query).sort({ uploadedAt: -1 }).lean().catch(() => []);
    return res.status(200).json(pdfs || []);
  } catch (err) {
    return res.status(200).json([]);
  }
});

// Health checks
app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/api/ai/health', (req, res) => res.json({ status: 'ok' }));
app.get('/', (req, res) => res.send('StudyNexus API Gateway Running'));

// Mount Modular Routers
app.use('/api/ai', BackendAiRouter);
app.use('/api/admin', adminRouter);

// Fallback Error Handler
app.use((err, req, res, next) => {
  console.error('Server Express Error:', err);
  res.status(500).json({ error: err.message || 'Server error' });
});

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));
}

export default app;