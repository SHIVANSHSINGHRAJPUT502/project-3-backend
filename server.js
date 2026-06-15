// server.js
import express from 'express';
import BackendAiRouter from './BackendAiRouter.js';
import adminRouter from './adminRouter.js';
import cors from 'cors';
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

// ─── STATIC MEMORY DATA REGISTRY (Bypassing MongoDB Completely) ──────────────
const STATIC_SEMESTER_DATA = {
  1: ["Engineering Mathematics-I", "Physics", "Manufacturing Processes", "Communication Skills"],
  2: ["Engineering Mathematics-II", "Chemistry", "Programming in C", "Electrical Engineering"],
  3: ["Data Structures", "Discrete Mathematics", "Digital Electronics", "Object Oriented Programming"],
  4: ["Operating Systems", "Database Management Systems", "Computer Architecture", "Python Programming"],
  5: ["Computer Networks", "Formal Languages & Automata", "Design & Analysis of Algorithms", "Cyber Security"],
  6: ["Software Engineering", "Compiler Design", "Web Development", "Artificial Intelligence"]
};

// Mock trivia questions for your Relax Zone game
const STATIC_TRIVIA_DATA = [
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
];

// ─── ROUTES ──────────────────────────────────────────────────────────────────

// ✅ Subjects derived from static memory array instantly
app.get('/api/subjects/:semId', (req, res) => {
  const semId = req.params.semId;
  const subjects = STATIC_SEMESTER_DATA[semId] || [];
  res.status(200).json(subjects);
});

// ✅ Fetch PDFs placeholder (Returns empty or mocked papers layout to prevent crash)
app.get('/api/notes/:semester/:subject/:type', (req, res) => {
  // Since we are running in standalone static memory, we return an empty array 
  // or you can fill this with your direct static file links if needed.
  res.status(200).json([]);
});

// ✅ Trivia route serving instantly from application memory
app.get('/api/relax/trivia', (req, res) => {
  res.status(200).json(STATIC_TRIVIA_DATA);
});

// Deprecated seed route (No database to seed anymore, keeps endpoint safe)
app.get('/api/dev/seed', (req, res) => {
  res.status(200).send("🚀 System running in memory storage mode. Database seeding bypassed.");
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/api/ai/health', (req, res) => res.json({ status: 'ok' }));
app.get('/', (req, res) => res.send('StudyNexus API Gateway Layer Running Smoothly in Static Mode'));

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
  console.log("🚀 API Microservice live on cloud port in static mode:", PORT);
});