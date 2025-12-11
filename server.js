import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
import multer from "multer";
import cloudinary, { v2 as cloud } from "cloudinary";
import { Server } from "socket.io";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ---------------------
// MONGODB CONNECT
// ---------------------
mongoose.connect(process.env.MONGO_URL, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => console.log("MongoDB Connected"))
.catch(err => console.log("DB Error:", err));

// ---------------------
// USER MODEL
// ---------------------
const UserSchema = new mongoose.Schema({                                                                                                                   username: { type: String, unique: true },
    // **hash(username + password + android ids)**
    finalHash: String,   // **hash(username + password)**
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model("User", UserSchema);

// ---------------------
// CLOUDINARY SETUP
// ---------------------
cloud.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_KEY,
  api_secret: process.env.CLOUD_SECRET
});

// ---------------------
// MULTER (MEMORY)
// ---------------------
const upload = multer({ storage: multer.memoryStorage() });

// ---------------------
// SIGN UP
// ---------------------
app.post("/signup", async (req, res) => {
  try {
      const { username, final_hash } = req.body;

      const exist = await User.findOne({ username });
      if (exist) return res.json({ success: false, msg: "User exists" });

      await User.create({
          username,
          finalHash: final_hash
      });

      return res.json({ success: true, token: username }); // Token ကို ပြန်ပို့ရန် ပြင်ထားသည်                                                                  
  } catch (err) {
      return res.json({ success: false, msg: "Signup error", err });
  }
});

// ---------------------
// SIGN IN
// ---------------------
app.post("/signin", async (req, res) => {
  try {
      const { username, final_hash } = req.body;

      const user = await User.findOne({ username });
      if (!user) return res.json({ success: false, msg: "No user" });

      // finalHash ကိုသာ တိုက်ဆိုင်စစ်ဆေးသည်။                                                                                                                          if (user.finalHash !== final_hash)
          return res.json({ success: false, msg: "Wrong credentials" });

      return res.json({
          success: true,
          token: username
      });

  } catch (err) {
      return res.json({ success: false, msg: "Signin error", err });
  }
});

// ---------------------
// IMAGE UPLOAD
// ---------------------
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
      const file = req.file;

      const base64 = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
      const result = await cloud.uploader.upload(base64, {
          folder: "chat_uploads"
      });

      return res.json({                                                                                                                                          success: true,
          url: result.secure_url
      });

  } catch (err) {
      return res.status(500).json({ success: false, msg: "Upload error", err });
  }
});

// ---------------------
// HTTP SERVER
// ---------------------
const server = app.listen(process.env.PORT || 3000, () => {
  console.log("Server running...");
});

// ---------------------
// SOCKET.IO
// ---------------------
const io = new Server(server, {
  cors: { origin: "*" }
});

io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error("NO_TOKEN"));
    next();
});

io.on("connection", socket => {
  console.log("User connected:", socket.id);

  socket.on("send_message", data => {
    io.emit("receive_message", data);
  });

  socket.on("send_image", data => {
    io.emit("receive_image", data);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

// ---------------------
// ROOT CHECK
// ---------------------
app.get("/", (req, res) => {
  // **res.send("Auth + DeviceHash + Chat + Image Server Running");**
  res.send("Auth + Chat + Image Server Running");
});
