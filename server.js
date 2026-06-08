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

// ─── MODELS ──────────────────────────────────────────────────────────────────
const subjectSchema = new mongoose.Schema({
  semId: String,
  name: String,
  code: String,
  credits: String,
  colorKey: String
}, { collection: 'subjects' });
const SubjectModel = mongoose.models.Subject || mongoose.model('Subject', subjectSchema);

const questionSchema = new mongoose.Schema({
  id: Number,
  question: String,
  options: [String],
  answer: String,
  points: Number
}, { collection: 'relax_trivia' });
const Question = mongoose.models.RelaxTrivia || mongoose.model('RelaxTrivia', questionSchema);
// ─────────────────────────────────────────────────────────────────────────────

// ─── ROUTES ──────────────────────────────────────────────────────────────────
app.get('/api/subjects/:semId', async (req, res) => {
  try {
    const items = await SubjectModel.find({ semId: req.params.semId });
    res.status(200).json(items);
  } catch (error) {
    res.status(500).json({ error: "Internal Database Server Error" });
  }
});

app.get('/api/relax/trivia', async (req, res) => {
  try {
    const quizSet = await Question.find({});
    res.status(200).json(quizSet);
  } catch (error) {
    res.status(500).json({ error: "Internal Cloud Routing Failure" });
  }
});

app.get('/api/notes/:semester', async (req, res) => {
  try {
    const notes = await PdfNotes.find({ semester: Number(req.params.semester) });
    res.status(200).json(notes);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch PDFs" });
  }
});

app.get('/api/dev/seed', async (req, res) => {
  try {
    await SubjectModel.deleteMany({});
    await Question.deleteMany({});

    await SubjectModel.insertMany([
      { semId: "1", name: "Engineering Mathematics-I", code: "MAS-101", credits: "4", colorKey: "blue" },
      { semId: "1", name: "Engineering Physics", code: "PHY-102", credits: "4", colorKey: "purple" },
      { semId: "1", name: "Basic Electrical Engineering", code: "EE-103", credits: "3", colorKey: "amber" },
      { semId: "1", name: "Programming for Problem Solving", code: "CSE-104", credits: "4", colorKey: "emerald" },
      { semId: "5", name: "Computer Networks", code: "CSE-301", credits: "4", colorKey: "blue" },
      { semId: "5", name: "Operating Systems", code: "CSE-303", credits: "4", colorKey: "purple" },
      { semId: "5", name: "Database Management Systems", code: "CSE-305", credits: "4", colorKey: "emerald" }
    ]);

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

    res.status(201).send("🚀 Database successfully seeded!");
  } catch (err) {
    res.status(500).send(`Seeding failed: ${err.message}`);
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/', (req, res) => res.send('StudyNexus API Gateway Layer Running Smoothly'));

app.use('/api/ai', BackendAiRouter);
app.use('/api/admin', adminRouter);

app.listen(PORT, () => {
  console.log("🚀 API Microservice live on cloud port:", PORT);
});