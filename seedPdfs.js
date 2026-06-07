// project-3backend/seedPdfs.js
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import PdfNotes from './models/PdfNotes.js';

dotenv.config();

const mockData = [
  // SEMESTER 1
  {
    title: "Engineering Mathematics-I Matrix & Calculus Notes",
    semester: 1,
    subject: "Applied Mathematics",
    s3Url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf"
  },
  {
    title: "Semiconductor Physics & Wave Optics Blueprint",
    semester: 1,
    subject: "Applied Physics",
    s3Url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf"
  },

  // SEMESTER 2
  {
    title: "Object-Oriented Programming with C++ Guide",
    semester: 2,
    subject: "OOPs using C++",
    s3Url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf"
  },
  {
    title: "Basic Electrical & Electronics Circuit Analysis",
    semester: 2,
    subject: "BEE",
    s3Url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf"
  },

  // SEMESTER 3
  {
    title: "Data Structures & Algorithms (Arrays, Linked Lists, Trees)",
    semester: 3,
    subject: "DSA",
    s3Url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf"
  },
  {
    title: "SQL Normalization & Relational Joins Guide",
    semester: 3,
    subject: "DBMS",
    s3Url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf"
  },

  // SEMESTER 4
  {
    title: "Thread Deadlock & Process Synchronization Notes",
    semester: 4,
    subject: "Operating Systems",
    s3Url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf"
  },
  {
    title: "Theory of Computation: Finite Automata & Turing Machines",
    semester: 4,
    subject: "TOC",
    s3Url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf"
  },

  // SEMESTER 5
  {
    title: "OSI Model & TCP/IP Layer Complete Cheat-Sheet",
    semester: 5,
    subject: "Computer Networks",
    s3Url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf"
  },
  {
    title: "Compiler Design: Lexical Analysis & Parsing Tables",
    semester: 5,
    subject: "Compiler Design",
    s3Url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf"
  },

  // SEMESTER 6
  {
    title: "Software Engineering Agile Methodologies & UML Models",
    semester: 6,
    subject: "Software Engineering",
    s3Url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf"
  },
  {
    title: "Analysis & Design of Algorithms (Dynamic Programming & Greedy)",
    semester: 6,
    subject: "ADA",
    s3Url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf"
  },

  // SEMESTER 7
  {
    title: "Artificial Intelligence & Neural Networks Foundation",
    semester: 7,
    subject: "AI & Machine Learning",
    s3Url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf"
  },
  {
    title: "Cryptography, RSA Algorithm & Network Security",
    semester: 7,
    subject: "Cyber Security",
    s3Url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf"
  },

  // SEMESTER 8
  {
    title: "Cloud Computing Architectures, AWS & Containerization",
    semester: 8,
    subject: "Cloud Computing",
    s3Url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf"
  },
  {
    title: "Big Data Analytics & Hadoop Ecosystem Overview",
    semester: 8,
    subject: "Big Data",
    s3Url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf"
  }
];

async function seedDatabase() {
  try {
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!uri) {
      throw new Error("❌ Environment validation aborted: MONGO_URI string is missing inside your .env configuration file.");
    }

    console.log("📡 Spawning connection layer to Atlas Cluster...");
    
    // 🧠 CRITICAL FIX: Explicitly pass configuration rules for multi-shard strings
    await mongoose.connect(uri, {
      ssl: true,
      authSource: 'admin',
      serverSelectionTimeoutMS: 5000 
    });
    
    console.log("🔮 Linked to MongoDB Cluster successfully!");

    // Clear old records to prevent duplicate card bloat
    await PdfNotes.deleteMany({});
    console.log("🧹 Flushed older tracking configurations.");

    // Write all 16 dynamic records
    const result = await PdfNotes.insertMany(mockData);
    console.log(`✅ Success! Seeded ${result.length} pristine B.Tech semester nodes references into your cloud database!`);
    
  } catch (error) {
    console.error("🔥 Seeding Process Interrupted:", error.message);
  } finally {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
      console.log("🔌 Pipeline pool disconnected cleanly.");
    }
    process.exit(0); 
  }
}

seedDatabase().catch(err => {
  console.error("🚨 Fatal Runtime Exception:", err);
  process.exit(1);
});