import express from 'express';
import BackendAiRouter from './BackendAiRouter.js';
import adminRouter from './adminRouter.js';
import PdfNotes from './models/PdfNotes.js';
import cors from 'cors';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:5173',
    'https://studynexus-psi.vercel.app',
    'https://studynexus.vercel.app',
    'https://project-3-backend-production-8932.up.railway.app'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  credentials: true
}));
app.use(express.json());

// ─── In-Memory Live Active Users Tracker (Heartbeat Engine) ───────────────────
const activeVisitors = new Map();

// ─── Reusable Serverless Database Connection ─────────────────────────────────
let cachedDb = null;

const connectDB = async () => {
  if (cachedDb && mongoose.connection.readyState === 1) {
    return cachedDb;
  }
  try {
    const db = await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    cachedDb = db;
    console.log('🔮 Connected safely to MongoDB Atlas Cloud Cluster!');
    return db;
  } catch (err) {
    console.error('❌ Cloud Database Connection Failure:', err);
    throw err;
  }
};

// Ensure DB is connected before handling any incoming API request
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    res.status(500).json({ error: "Database connection failed", details: err.message });
  }
});

// ─── Trivia Schema Configuration ─────────────────────────────────────────────
const questionSchema = new mongoose.Schema({
  id: Number,
  question: String,
  options: [String],
  answer: String,
  points: Number
}, { collection: 'relax_trivia' });
const Question = mongoose.models.RelaxTrivia || mongoose.model('RelaxTrivia', questionSchema);

// ─── ACTIVE USERS / HEARTBEAT ROUTES ─────────────────────────────────────────

// Client sends ping every 15-20s
app.post('/api/heartbeat', (req, res) => {
  const visitorId = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip || 'client-node';
  activeVisitors.set(visitorId, Date.now());
  return res.status(200).json({ status: 'alive' });
});

// Fetch active users count (Active within last 45s)
app.get('/api/active-users', (req, res) => {
  const now = Date.now();
  const timeoutLimit = 45 * 1000;

  // Clean stale connections
  for (const [id, lastSeen] of activeVisitors.entries()) {
    if (now - lastSeen > timeoutLimit) {
      activeVisitors.delete(id);
    }
  }

  // Always return at least 1 when anyone accesses the platform
  return res.json({ count: Math.max(1, activeVisitors.size) });
});

// ─── GENERAL DATA ROUTES ─────────────────────────────────────────────────────

// ✅ Subjects derived from uploaded PDFs — returns distinct subject names
app.get('/api/subjects/:semId', async (req, res) => {
  try {
    const sem = Number(req.params.semId);
    const subjects = await PdfNotes.distinct('subject', {
      semester: sem
    });
    res.status(200).json(subjects);
  } catch (error) {
    console.error("Error in /api/subjects route:", error);
    res.status(500).json({ error: "Failed to fetch subjects", details: error.message });
  }
});

// ✅ Fetch PDFs by semester + subject + type
app.get('/api/notes/:semester/:subject/:type', async (req, res) => {
  try {
    const { semester, subject, type } = req.params;
    
    const query = {
      semester: Number(semester),
      subject: decodeURIComponent(subject)
    };
    
    if (type && type !== 'undefined' && type !== 'null') {
      query.type = type;
    }

    const pdfs = await PdfNotes.find(query).sort({ uploadedAt: -1 });
    res.status(200).json(pdfs);
  } catch (error) {
    console.error("Error in /api/notes route:", error);
    res.status(500).json({ error: "Failed to fetch PDFs", details: error.message });
  }
});

// ✅ Trivia route
app.get('/api/relax/trivia', async (req, res) => {
  try {
    const quizSet = await Question.find({});
    res.status(200).json(quizSet);
  } catch (error) {
    res.status(500).json({ error: "Internal Cloud Routing Failure" });
  }
});

// ✅ Seed endpoint
app.get('/api/dev/seed', async (req, res) => {
  try {
    await Question.deleteMany({});

    await Question.insertMany([
      {
        id: 1,
        question: "Which cloud service model provides virtualization, raw computing shards, storage, and low-level networking engines natively?",
        options: ["SaaS", "PaaS", "IaaS", "Serverless Architecture"],
        answer: "IaaS",
        points: 10
      },
      {
        id: 2,
        question: "What specific type of lookup layer does the 'mongodb+srv://' connection prefix rely on to track multiple cluster shards?",
        options: ["A Record Lookup", "CNAME Record Multi-Map", "DNS SRV Record Lookup", "MX Mailing Record Routing"],
        answer: "DNS SRV Record Lookup",
        points: 15
      },
      {
        id: 3,
        question: "In distributed cloud database models, what system behaviors are balanced according to the foundational CAP Theorem?",
        options: ["Caching, API Validation, Port Isolation", "Consistency, Availability, Partition tolerance", "Concurrency, Allocation Matrix, Performance Tuning", "Clusters, Active Backups, Packet Switching"],
        answer: "Consistency, Availability, Partition tolerance",
        points: 10
      }
    ]);

    res.status(201).send("🚀 Trivia seeded successfully!");
  } catch (err) {
    res.status(500).send(`Seeding failed: ${err.message}`);
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/api/ai/health', (req, res) => res.json({ status: 'ok' }));
app.get('/', (req, res) => res.send('StudyNexus API Gateway Layer Running Smoothly'));

app.use('/api/ai', BackendAiRouter);
app.use('/api/admin', adminRouter);

// ─── HEAL DEPLOYMENT THREAD RUNTIME CRASHES ──────────────────────────────────
process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ Detached System Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('⚠️ Critical Application Uncaught Exception thrown:', err);
});

app.listen(PORT, () => {
  console.log("🚀 API Microservice live on cloud port:", PORT);
});

export default app;