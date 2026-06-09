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
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));
app.use(express.json());

mongoose.connect(process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
})
  .then(() => console.log('🔮 Connected safely to MongoDB Atlas Cloud Cluster!'))
  .catch((err) => console.error('❌ Cloud Database Connection Failure:', err));

// ─── Trivia (kept as-is) ──────────────────────────────────────────────────────
const questionSchema = new mongoose.Schema({
  id: Number,
  question: String,
  options: [String],
  answer: String,
  points: Number
}, { collection: 'relax_trivia' });
const Question = mongoose.models.RelaxTrivia || mongoose.model('RelaxTrivia', questionSchema);

// ─── ROUTES ──────────────────────────────────────────────────────────────────

// ✅ Subjects derived from uploaded PDFs — no subjects collection needed
// Returns distinct subject names that have at least 1 PDF uploaded for this semester
app.get('/api/subjects/:semId', async (req, res) => {
  try {
    const subjects = await PdfNotes.distinct('subject', {
      semester: Number(req.params.semId)
    });
    res.status(200).json(subjects); // returns plain array of strings e.g. ["Machine Learning", "Cloud Computing"]
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch subjects" });
  }
});

// ✅ Fetch PDFs by semester + subject + type
// e.g. GET /api/notes/6/Machine Learning/notes
app.get('/api/notes/:semester/:subject/:type', async (req, res) => {
  try {
    const { semester, subject, type } = req.params;
    const pdfs = await PdfNotes.find({
      semester: Number(semester),
      subject: decodeURIComponent(subject),
      type: type
    }).sort({ uploadedAt: -1 });
    res.status(200).json(pdfs);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch PDFs" });
  }
});

// ✅ Trivia route (unchanged)
app.get('/api/relax/trivia', async (req, res) => {
  try {
    const quizSet = await Question.find({});
    res.status(200).json(quizSet);
  } catch (error) {
    res.status(500).json({ error: "Internal Cloud Routing Failure" });
  }
});

// ✅ Seed only trivia now (subjects no longer need seeding)
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

app.listen(PORT, () => {
  console.log("🚀 API Microservice live on cloud port:", PORT);
});
