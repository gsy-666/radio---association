const mongoose = require('mongoose');

const RegistrationSchema = new mongoose.Schema({
  name: { type: String, required: true },
  studentId: { type: String, required: true },
  college: { type: String, required: true },
  grade: { type: String, required: true },
  phone: { type: String, required: true },
  email: { type: String, required: true },
  experience: { type: String },
  expectation: { type: String },
  agreement: { type: Boolean, required: true }
});

module.exports = mongoose.model('Registration', RegistrationSchema);