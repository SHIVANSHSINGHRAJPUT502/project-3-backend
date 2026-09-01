import mongoose from 'mongoose';

const requestSchema = new mongoose.Schema(
  {
    name: { 
      type: String, 
      default: 'Student',
      trim: true,
      maxlength: 50 
    },
    semester: { 
      type: String, 
      required: [true, 'Semester is required'],
      trim: true 
    },
    message: { 
      type: String, 
      required: [true, 'Request details/message are required'],
      trim: true,
      maxlength: 500 
    },
    status: { 
      type: String, 
      enum: ['Pending', 'In-Progress', 'Resolved', 'pending', 'resolved'], 
      default: 'Pending' 
    }
  },
  { 
    timestamps: true,
    collection: 'requests' // Explicit collection name
  }
);

// Indexing for fast retrieval on admin and ticker feeds
requestSchema.index({ createdAt: -1 });
requestSchema.index({ status: 1 });

const Request = mongoose.models.Request || mongoose.model('Request', requestSchema, 'requests');

export { Request };
export default Request;