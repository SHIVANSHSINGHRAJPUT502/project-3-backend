// project-3backend/seedPdfs.js
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import PdfNotes from './models/PdfNotes.js';

dotenv.config();

const mockData = [
  {
    title: "OSI Model Complete Cheat-Sheet",
    semester: 5,
    subject: "Computer Networks",
    s3Url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf" // Temporary open source mock PDF
  },
  {
    title: "SQL Normalization & Joins Guide",
    semester: 3,
    subject: "DBMS",
    s3Url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf"
  },
  {
    title: "Thread Deadlock & Process Synchronization Notes",
    semester: 4,
    subject: "Operating Systems",
    s3Url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf"
  }
];

async function seedDatabase() {
  try {
    // Connect to your existing Atlas cloud string
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
    console.log("🔮 Linked to MongoDB Cluster for seeding...");

    // Clear out older entries so things don't duplicate
    await PdfNotes.deleteMany({});
    console.log("🧹 Flushed old database document states clean.");

    // Insert the new notes metadata
    await PdfNotes.insertMany(mockData);
    console.log("✅ Seeded 3 pristine semester notes references successfully!");
    
    mongoose.connection.close();
    console.log("🔌 Database pipeline disconnected safely.");
  } catch (error) {
    console.error("❌ Seeding failed:", error);
  }
}

seedDatabase();