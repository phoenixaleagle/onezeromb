import express from "express";
import cors from "cors";
import dotenv from "dotenv"; // dotenv ကို import အရင်လုပ်ပါ
import mongoose from "mongoose";
import multer from "multer";
import cloudinary, { v2 as cloud } from "cloudinary";
import { Server } from "socket.io";
import { createHash } from "crypto";
import { createServer } from "http";

// 1. dotenv config ကို အပေါ်ဆုံးနားမှာ ကြေညာပါ
dotenv.config();

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

// 2. MONGO_URL ကို process.env ကနေ ယူပါ (Hardcode မလုပ်တော့ပါ)
const MONGO_URL = process.env.MONGO_URL;

const app = express();
const httpServer = createServer(app);

app.use(cors());
app.use(express.json());

// ---------------------
// CLOUDINARY SETUP
// ---------------------
// Cloudinary config တွေကိုလည်း env ကနေပဲ ယူပါမယ်
cloud.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_KEY,
  api_secret: process.env.CLOUD_SECRET
});

// ---------------------
// MONGODB CONNECT
// ---------------------
mongoose.connect(MONGO_URL)
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.log("DB Error:", err));

// ---------------------
// USER MODEL
// ---------------------
const UserSchema = new mongoose.Schema({
    username: { type: String, unique: true },
    finalHash: String,
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model("User", UserSchema);

// ---------------------
// SOCKET.IO SETUP
// ---------------------
const io = new Server(httpServer, {
  cors: { origin: "*" }
});

// Broadcast Counts Helper
async function broadcastUserCounts() {
    try {
        const registered = await User.countDocuments();
        const online = io.engine.clientsCount; 
        io.emit("user_counts", { registered, online });
        console.log(`Broadcast: Reg=${registered}, Online=${online}`);
    } catch (err) {
        console.error("Broadcast Error:", err);
    }
}

// ---------------------
// MULTER
// ---------------------
const upload = multer({ storage: multer.memoryStorage() });

// ---------------------
// ROUTES
// ---------------------

// SIGN UP
app.post("/signup", async (req, res) => {
  try {
      const { username, final_hash } = req.body;
      if (!username || !final_hash) {
          return res.status(400).json({ success: false, msg: "Missing username or hash" });
      }

      const existingUser = await User.findOne({ username });
      if (existingUser) {
          return res.status(409).json({ success: false, msg: "Username already exists" });
      }

      const newUser = new User({ username, finalHash: final_hash });
      await newUser.save();

      broadcastUserCounts(); // Update counts

      return res.json({ success: true, msg: "User created" });
  } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, msg: "Signup failed", error: err.message });
  }
});

// SIGN IN
app.post("/signin", async (req, res) => {
    try {
        const { username, final_hash } = req.body;
        if (!username || !final_hash) {
            return res.status(400).json({ success: false, msg: "Missing username or hash" });
        }

        const user = await User.findOne({ username, finalHash: final_hash });

        if (!user) {
            return res.status(401).json({ success: false, msg: "Invalid username or password" });
        }

        return res.json({ success: true, msg: "Signed in", username: user.username });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, msg: "Signin failed", error: err.message });
    }
});

// UPLOAD
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, msg: "No file" });
    }
    const base64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
    const result = await cloud.uploader.upload(base64, { folder: "chat_uploads" });
    return res.json({ success: true, url: result.secure_url });
  } catch (err) {
    return res.status(500).json({ success: false, msg: "Upload error", err: err.message });
  }
});

// ---------------------
// SOCKET EVENTS
// ---------------------
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error("NO_TOKEN"));
    next();
});

io.on("connection", socket => {
  const username = socket.handshake.auth.token;
  console.log("User connected:", username); 

  broadcastUserCounts(); // User Connected -> Update Online Count

  socket.on("send_message", data => {
    socket.broadcast.emit("receive_message", data);
  });

  socket.on("send_image", data => {
    socket.broadcast.emit("receive_image", data);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", username);
    broadcastUserCounts(); // User Disconnected -> Update Online Count
  });
});

// ---------------------
// START SERVER
// ---------------------
httpServer.listen(process.env.PORT || 3000, () => {
  console.log("Server running...");
});
