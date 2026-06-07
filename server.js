import express from 'express';
import BackendAiRouter from './BackendAiRouter.js';
import adminRouter from './adminRouter.js';
import cors from 'cors';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

// 1. Load environment configuration variables
dotenv.config();

// 2. Initialize the express application instance
const app = express();
const PORT = process.env.PORT || 5000;

// 3. Middlewares
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

// 4. Establish Cloud Database Connection Handshake
const mongoURI = process.env.MONGO_URI;

mongoose.connect(mongoURI, {
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
})
  .then(() => console.log('🔮 Connected safely to MongoDB Atlas Cloud Cluster!'))
  .catch((err) => console.error('❌ Cloud Database Connection Failure:', err));

// ─── SAFE MODEL INITIALIZATION WITH EXPLICIT NAMESPACES ─────────────────────
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

const pdfNotesSchema = new mongoose.Schema({
  title: String,
  semester: Number,
  subject: String,
  s3Url: String
}, { collection: 'pdf_notes' }); 

const PdfNotes = mongoose.models.PdfNotes || mongoose.model('PdfNotes', pdfNotesSchema);
// ─────────────────────────────────────────────────────────────────────────────

// 5. API ROUTES
app.get('/api/subjects/:semId', async (req, res) => {
  const { semId } = req.params;
  console.log(`📡 Fetching documents from Cloud Cluster for Semester: ${semId}`);
  try {
    const items = await SubjectModel.find({ semId: semId });
    res.status(200).json(items);
  } catch (error) {
    console.error("Database Query Crash Error:", error);
    res.status(500).json({ error: "Internal Database Server Error" });
  }
});

app.get('/api/relax/trivia', async (req, res) => {
  console.log('🎮 Relax Zone Event: Fetching cloud quiz questions...');
  try {
    const quizSet = await Question.find({});
    res.status(200).json(quizSet);
  } catch (error) {
    console.error("Relax Zone Database Fetch Error:", error);
    res.status(500).json({ error: "Internal Cloud Routing Failure" });
  }
});

app.get('/api/notes/:semester', async (req, res) => {
  const { semester } = req.params;
  console.log(`📡 Fetching PDF documents from Atlas for Semester: ${semester}`);
  try {
    const notes = await PdfNotes.find({ semester: Number(semester) });
    res.status(200).json(notes);
  } catch (error) {
    console.error("PDF Fetch Error:", error);
    res.status(500).json({ error: "Failed to stream PDF datasets from cluster." });
  }
});

app.get('/api/dev/seed', async (req, res) => {
  console.log("🚀 Seeding route triggered...");
  try {
    try {
      await SubjectModel.deleteMany({});
      console.log("✔ Old subjects collection wiped.");
    } catch (e) { console.error("Wipe Subjects failed:", e); }

    try {
      await Question.deleteMany({});
      console.log("✔ Old trivia collection wiped.");
    } catch (e) { console.error("Wipe Trivia failed:", e); }
    
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
    console.error("Seeding crashed:", err);
    res.status(500).send(`Seeding failed: ${err.message}`);
  }
});

// 6. Health check route
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// 7. Base route
app.get('/', (req, res) => {
  res.send('StudyNexus API Gateway Layer Running Smoothly');
});

// 8. Routers
app.use('/api/ai', BackendAiRouter);
app.use('/api/admin', adminRouter);

// 9. Start server
app.listen(PORT, () => {
  console.log("🚀 API Microservice live on cloud port:", PORT);
});