import mongoose from 'mongoose';

const requestSchema = new mongoose.Schema({
  name: { type: String, default: 'Student' },
  semester: { type: String, required: true },
  message: { type: String, required: true },
  status: { type: String, default: 'Pending' }, // 'Pending' or 'Resolved'
  createdAt: { type: Date, default: Date.now }
});

const Request = mongoose.models.Request || mongoose.model('Request', requestSchema);
export default Request;