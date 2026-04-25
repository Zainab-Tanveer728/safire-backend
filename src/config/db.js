const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    // Note: In newer Mongoose versions, options like 
    // useNewUrlParser are no longer required
    const conn = await mongoose.connect(process.env.MONGO_URI);

    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1); // Exit process with failure
  }
};

module.exports = connectDB;