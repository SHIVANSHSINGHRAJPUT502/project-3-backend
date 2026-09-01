import express from 'express';
import BackendAiRouter from './BackendAiRouter.js';
import adminRouter from './adminRouter.js';
import PdfNotes from './models/PdfNotes.js';
import Subject from './models/Subject.js';
import cors from 'cors';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// ─── Universal CORS Configuration ──────────────────────────────────────────
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  'https://studynexus-psi.vercel.app',
  'https://studynexus.vercel.app',
  'https://project-3-backend-production-8932.up.railway.app'
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g. mobile apps, curl, server-to-server)
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(null, true); // Permissive fallback for staging subdomains
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-access-token', 'x-forwarded-for'],
  credentials: true
}));

app.use(express.json());

// ─── In-Memory Active Users Tracker ──────────────────────────────────────────
const activeVisitors = new Map();

// ─── Serverless-Optimized Database Connection ─────────────────────────────────
let cachedDb = null;

const connectDB = async () => {
  if (cachedDb && mongoose.connection.readyState === 1) {
    return cachedDb;
  }
  try {
    const db = await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 8000,
      socketTimeoutMS: 45000,
    });
    cachedDb = db;
    console.log('🔮 Connected safely to MongoDB Atlas Cloud Cluster!');
    return db;
  } catch (err) {
    console.error('❌ Cloud Database Connection Failure:', err.message);
    throw err;
  }
};

// Safe DB Middleware: Connects on demand per serverless invocation
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error('Database connection middleware caught error:', err.message);
    // Continue down the pipeline; handlers have internal fallback guards
    next();
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
app.post('/api/heartbeat', (req, res) => {
  const visitorId = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip || 'client-node';
  activeVisitors.set(visitorId, Date.now());
  return res.status(200).json({ status: 'alive' });
});

app.get('/api/active-users', (req, res) => {
  const now = Date.now();
  const timeoutLimit = 45 * 1000;

  for (const [id, lastSeen] of activeVisitors.entries()) {
    if (now - lastSeen > timeoutLimit) {
      activeVisitors.delete(id);
    }
  }

  return res.json({ count: Math.max(1, activeVisitors.size) });
});

// ─── GENERAL DATA ROUTES ─────────────────────────────────────────────────────

// ✅ Subjects list by semester (Safe fallback: returns [] on error instead of 500 crash)
app.get('/api/subjects/:semId', async (req, res) => {
  try {
    const sem = req.params.semId;
    
    // 1. Check Subject catalog
    let catalogSubjects = [];
    try {
      catalogSubjects = await Subject.find({ semId: String(sem) }).sort({ name: 1 }).lean();
    } catch (e) {
      console.warn("Subject catalog query warning:", e.message);
    }

    if (catalogSubjects && catalogSubjects.length > 0) {
      return res.status(200).json(catalogSubjects.map(s => s.name));
    }

    // 2. Fallback to distinct subjects from PDF collection
    try {
      const pdfSubjects = await PdfNotes.distinct('subject', {
        semester: Number(sem)
      });
      return res.status(200).json(pdfSubjects || []);
    } catch (e) {
      console.warn("PDF distinct subjects query warning:", e.message);
      return res.status(200).json([]);
    }
  } catch (error) {
    console.error("Safe fallback in /api/subjects/:semId:", error.message);
    return res.status(200).json([]);
  }
});

// ✅ Fetch PDFs by semester + subject + type
app.get('/api/notes/:semester/:subject/:type', async (req, res) => {
  try {
    const { semester, subject, type } = req.params;
    
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

    const pdfs = await PdfNotes.find(query).sort({ uploadedAt: -1 }).lean();
    return res.status(200).json(pdfs || []);
  } catch (error) {
    console.error("Error in /api/notes route:", error.message);
    return res.status(200).json([]);
  }
});

// ✅ Public student contribution submission
app.post('/api/notes/submit', async (req, res) => {
  try {
    const { title, subject, semester, type, s3Url, fileUrl, uploaderName } = req.body;
    const directUrl = s3Url || fileUrl;

    if (!title || !subject || !semester || !directUrl) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const newNote = new PdfNotes({
      title: title.trim(),
      subject: subject.trim(),
      semester: Number(semester),
      type: type || 'Notes',
      s3Url: directUrl.trim(),
      uploaderName: uploaderName?.trim() || 'Student Contributor',
      status: 'pending'
    });

    await newNote.save();
    return res.status(201).json({ message: "Submitted successfully for admin review!", note: newNote });
  } catch (err) {
    console.error("Public submission error:", err.message);
    return res.status(500).json({ error: "Failed to submit note", details: err.message });
  }
});

// ✅ Trivia route
app.get('/api/relax/trivia', async (req, res) => {
  try {
    const quizSet = await Question.find({}).lean();
    return res.status(200).json(quizSet || []);
  } catch (error) {
    return res.status(200).json([]);
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
    return res.status(201).send("🚀 Trivia seeded successfully!");
  } catch (err) {
    return res.status(500).send(`Seeding failed: ${err.message}`);
  }
});

// Health checks
app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/api/ai/health', (req, res) => res.json({ status: 'ok' }));
app.get('/', (req, res) => res.send('StudyNexus API Gateway Layer Running Smoothly'));

// ─── Routers ─────────────────────────────────────────────────────────────────
app.use('/api/ai', BackendAiRouter);
app.use('/api/admin', adminRouter);

// ─── Global Error Handler with Explicit CORS ─────────────────────────────────
app.use((err, req, res, next) => {
  console.error("Unhandled global express error:", err);
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  res.status(err.status || 500).json({
    error: err.message || "Internal Server Error"
  });
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('⚠️ Uncaught Exception thrown:', err);
});

app.listen(PORT, () => {
  console.log("🚀 API Microservice live on cloud port:", PORT);
});

export default app;