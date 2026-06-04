// server.js
import express from 'express';
import BackendAiRouter from './BackendAiRouter.js';
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
    'https://studynexus-psi.vercel.app'
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
// Syllabus Dataset Schema Configuration Layout
const subjectSchema = new mongoose.Schema({
  semId: String,
  name: String,
  code: String,
  credits: String,
  colorKey: String
}, { collection: 'subjects' });

const SubjectModel = mongoose.models.Subject || mongoose.model('Subject', subjectSchema);

// Relax Zone Technical Trivia Quiz Schema Configuration Layout
const questionSchema = new mongoose.Schema({
  id: Number,
  question: String,
  options: [String],
  answer: String,
  points: Number
}, { collection: 'relax_trivia' });

const Question = mongoose.models.RelaxTrivia || mongoose.model('RelaxTrivia', questionSchema);

// PDF Notes Metadata Schema Configuration Layout
const pdfNotesSchema = new mongoose.Schema({
  title: String,
  semester: Number,
  subject: String,
  s3Url: String
}, { collection: 'pdf_notes' }); // ◄── Targets the exact collection seeded by seedPdfs.js

const PdfNotes = mongoose.models.PdfNotes || mongoose.model('PdfNotes', pdfNotesSchema);
// ─────────────────────────────────────────────────────────────────────────────

// 5. DYNAMIC API ROUTE: Queries your cloud database subject collection
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

// 5b. CLOUD GAME ROUTE: Serves dynamic tech trivia questions straight from Atlas
app.get('/api/relax/trivia', async (req, res) => {
  console.log('实用 🎮 Relax Zone Event: Fetching cloud quiz questions from relax_trivia...');
  try {
    const quizSet = await Question.find({});
    res.status(200).json(quizSet);
  } catch (error) {
    console.error("Relax Zone Database Fetch Error:", error);
    res.status(500).json({ error: "Internal Cloud Routing Failure" });
  }
});

// 5c. NEW DYNAMIC ROUTE: Serves your freshly seeded PDF notes by semester
app.get('/api/notes/:semester', async (req, res) => {
  const { semester } = req.params;
  console.log(`📡 Fetching seeded PDF documents from Atlas for Semester: ${semester}`);
  
  try {
    const notes = await PdfNotes.find({ semester: Number(semester) });
    res.status(200).json(notes);
  } catch (error) {
    console.error("PDF Fetch Error:", error);
    res.status(500).json({ error: "Failed to stream PDF datasets from cluster." });
  }
});

// 6. DEVELOPER HELPER ROUTE: Seed sample records using a GET request
app.get('/api/dev/seed', async (req, res) => {
  console.log("🚀 Seeding route triggered. Initializing cloud database wipe and write sequence...");
  try {
    // Drop collections clean to clear out bad states or mismatched constraints
    try {
      await SubjectModel.deleteMany({});
      console.log("✔ Old subjects collection wiped successfully.");
    } catch (e) { console.error("Wipe Subjects collection failed:", e); }

    try {
      await Question.deleteMany({});
      console.log("✔ Old trivia collection wiped successfully.");
    } catch (e) { console.error("Wipe Trivia collection failed:", e); }
    
    // Seed Core Computer Science Syllabus Records
    await SubjectModel.insertMany([
      { semId: "1", name: "Engineering Mathematics-I", code: "MAS-101", credits: "4", colorKey: "blue" },
      { semId: "1", name: "Engineering Physics", code: "PHY-102", credits: "4", colorKey: "purple" },
      { semId: "1", name: "Basic Electrical Engineering", code: "EE-103", credits: "3", colorKey: "amber" },
      { semId: "1", name: "Programming for Problem Solving", code: "CSE-104", credits: "4", colorKey: "emerald" },
      { semId: "5", name: "Computer Networks", code: "CSE-301", credits: "4", colorKey: "blue" },
      { semId: "5", name: "Operating Systems", code: "CSE-303", credits: "4", colorKey: "purple" },
      { semId: "5", name: "Database Management Systems", code: "CSE-305", credits: "4", colorKey: "emerald" }
    ]);
    console.log("✔ Syllabus data rows parsed and loaded onto remote nodes.");

    // Seed Relax Zone Cloud-Native Computing Trivia Dataset
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
    console.log("✔ Relaxation Arena quiz cards parsed and loaded onto remote nodes.");
    
    res.status(201).send("🚀 Database successfully seeded with original engineering course records and cloud trivia sets!");
  } catch (err) {
    console.error("Global Seeding operational process crashed:", err);
    res.status(500).send(`Seeding failed internally: ${err.message}`);
  }
});

// 7. Base Test Route
app.get('/', (req, res) => {
  res.send('StudyNexus API Gateway Layer Running Smoothly');
});

// 8. Start listening for traffic
app.use('/api/ai', BackendAiRouter);
app.listen(PORT, () => {
  console.log("🚀 API Microservice live on cloud port:", PORT);
});