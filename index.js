const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const { MongoClient, ServerApiVersion } = require('mongodb');

const app = express();

// running in port number 5000
const port = process.env.PORT || 5000;

// middleware
app.use(cors());
app.use(express.json());

// mongodb connected with secure username and password
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.fomgu.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

// JWT verification 
function verifyJWT(req, res, next){
  const authHeader = req.headers.authorization;
  if(!authHeader){
    return res.status(401).send({message: 'UnAuthorized access'});
  }
  const token = authHeader.split(' ')[1];
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function(err, decoded){
    if(err){
      return res.status(403).send({message: 'Forbidden access'})
    }
    req.decoded = decoded;
    next();
  });
}

async function run(){
    try{
        await client.connect();
        //console.log('db connected');

        const serviceCollection =client.db('doctors_portal').collection('services');
        const bookingCollection =client.db('doctors_portal').collection('bookings');
        const userCollection =client.db('doctors_portal').collection('users');
        const doctorCollection =client.db('doctors_portal').collection('doctors');
        const reviewCollection =client.db('doctors_portal').collection('reviews');
        const paymentCollection =client.db('doctors_portal').collection('payments');

        // admin verification
        const verifyAdmin = async (req, res, next) => {
          const requester = req.decoded.email;
          const requesterAccount = await userCollection.findOne({ email: requester });
          if (requesterAccount.role === 'admin') {
              next();
          }
          else {
              res.status(403).send({ message: 'forbidden' });
          }
      }

      app.post('/create-payment-intent', verifyJWT, async (req, res) => {
          const service = req.body;
          const price = service.price;
          const amount = price * 100;
          const paymentIntent = await stripe.paymentIntents.create({
              amount: amount,
              currency: 'usd',
              payment_method_types: ['card']
          });
          res.send({ clientSecret: paymentIntent.client_secret })
      });

      app.get('/service', async (req, res) => {
          const query = {};
          const cursor = serviceCollection.find(query).project({ name: 1 });
          const services = await cursor.toArray();
          res.send(services);
      })

      // POST review
      app.post('/review', async (req, res) => {
          const newReview = req.body;
          const result = await reviewCollection.insertOne(newReview);
          res.send(result);
      })

      // GET review
      app.get('/review', async (req, res) => {
          const query = {};
          const cursor = reviewCollection.find(query);
          const reviews = await cursor.toArray();
          res.send(reviews);
      });

      app.get('/user', verifyJWT, async (req, res) => {
          const users = await userCollection.find().toArray();
          res.send(users);
      })


      app.delete('/user/:email', verifyJWT, verifyAdmin, async (req, res) => {
          const email = req.params.email;
          const filter = { email: email };
          const result = await userCollection.deleteOne(filter);
          res.send(result);
      })

      app.get('/admin/:email', async (req, res) => {
          const email = req.params.email;
          const user = await userCollection.findOne({ email: email });
          const isAdmin = user.role === 'admin';
          res.send({ admin: isAdmin })
      })

      app.put('/user/admin/:email', verifyJWT, verifyAdmin, async (req, res) => {
          const email = req.params.email;
          const filter = { email: email };
          const updateDoc = {
              $set: { role: 'admin' },
          };
          const result = await userCollection.updateOne(filter, updateDoc);
          res.send(result);
      })

      app.put('/user/:email', async (req, res) => {
          const email = req.params.email;
          const user = req.body;
          const filter = { email: email };
          const options = { upsert: true };
          const updateDoc = {
              $set: user,
          };
          const result = await userCollection.updateOne(filter, updateDoc, options);
          const token = jwt.sign({ email: email }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' })
          res.send({ result, token });
      })


      app.get('/available', async (req, res) => {
          const date = req.query.date;
          const services = await serviceCollection.find().toArray();
          const query = { date: date }
          const bookings = await bookingCollection.find(query).toArray();
          services.forEach(service => {
              const serviceBookings = bookings.filter(book => book.treatment === service.name);
              const bookedSlots = serviceBookings.map(book => book.slot);
              const available = service.slots.filter(slot => !bookedSlots.includes(slot));
              service.slots = available;
          });
          res.send(services);
      })


      app.get('/booking', verifyJWT, async (req, res) => {
          const patient = req.query.patient;
          const decodedEmail = req.decoded.email;
          if (patient === decodedEmail) {
              const query = { patient: patient };
              const bookings = await bookingCollection.find(query).toArray();
              return res.send(bookings);
          }
          else {
              return res.status(403).send({ message: 'forbidden access' });
          }
      })

      app.get('/booking/:id', verifyJWT, async (req, res) => {
          const id = req.params.id;
          const query = { _id: ObjectId(id) };
          const booking = await bookingCollection.findOne(query);
          res.send(booking);
      })

      app.post('/booking', async (req, res) => {

          const booking = req.body;  // post data remains in body & it is from client side.

          const query = { treatment: booking.treatment, date: booking.date, patient: booking.patient }
          const exists = await bookingCollection.findOne(query);
          if (exists) {
              return res.send({ success: false, booking: exists })
          }
          const result = await bookingCollection.insertOne(booking);
          return res.send({ success: true, result });
      });

      app.patch('/booking/:id', verifyJWT, async (req, res) => {
          const id = req.params.id;
          const payment = req.body;
          const filter = { _id: ObjectId(id) };
          const updatedDoc = {
              $set: {
                  paid: true,
                  transactionId: payment.transactionId,
              }
          }
          const result = await paymentCollection.insertOne(payment);
          const updatedBooking = await bookingCollection.updateOne(filter, updatedDoc);
          res.send(updatedDoc);
      })

      app.get('/doctor', async (req, res) => {
          const doctors = await doctorCollection.find().toArray();
          res.send(doctors);
      })

      app.post('/doctor', verifyJWT, verifyAdmin, async (req, res) => {
          const doctor = req.body;
          const result = await doctorCollection.insertOne(doctor);
          res.send(result);
      })

      app.delete('/doctor/:email', verifyJWT, verifyAdmin, async (req, res) => {
          const email = req.params.email;
          const filter = { email: email };
          const result = await doctorCollection.deleteOne(filter);
          res.send(result);
      })

  }

  finally {

  }
}
run().catch(console.dir);


app.get('/', (req, res) => {
    res.send('Hello From Doctors Portal!')
  })
  
  // port listening
  app.listen(port, () => {
    console.log(`Doctors portal App listening on port ${port}`)
  })