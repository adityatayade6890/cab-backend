const express = require('express');
const cors = require('cors');
const ridesRouter = require('./routes/rides');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use('/api/bills', require('./routes/rides'));

app.get('/', (req, res) => {
  res.send('Cab Booking Backend Running!');
});

app.use('/api/rides', ridesRouter);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚗 Server running on port ${PORT}`);
});
