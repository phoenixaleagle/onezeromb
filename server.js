import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
import multer from "multer";
import cloudinary, { v2 as cloud } from "cloudinary";
import { Server } from "socket.io";
import { createHash } from "crypto";

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ---------------------
// MONGODB CONNECT
// ---------------------
mongoose.connect(process.env.MONGO_URI);
      
.then(() => console.log("MongoDB Connected"))
.catch(err => console.log("DB Error:", err));

// ---------------------
// USER MODEL
// ---------------------
const UserSchema = new mongoose.Schema({
    username: { type: String, unique: true },
    // hash(username + password) သည် Android ဘက်ခြမ်းနှင့် ကိုက်ညီပါသည်
    finalHash: String,
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
      if (!username || !final_hash) {
          return res.status(400).json({ success: false, msg: "Missing username or hash" });
      }

      const existingUser = await User.findOne({ username });
      if (existingUser) {
          return res.status(409).json({ success: false, msg: "Username already exists" });
      }

      const newUser = new User({ username, finalHash: final_hash });
      await newUser.save();

      return res.json({ success: true, msg: "User created" });
  } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, msg: "Signup failed", error: err.message });
  }
});

// ---------------------
// SIGN IN
// ---------------------
app.post("/signin", async (req, res) => {
    try {
        const { username, final_hash } = req.body;
        if (!username || !final_hash) {
            return res.status(400).json({ success: false, msg: "Missing username or hash" });
        }

        // Android မှ ပို့လာသော hash ကိုပဲ တိုက်ရိုက် စစ်ဆေးသည်
        const user = await User.findOne({ username, finalHash: final_hash });

        if (!user) {
            return res.status(401).json({ success: false, msg: "Invalid username or password" });
        }

        // Login အောင်မြင်ပါက username ကို token အဖြစ် သိမ်းဆည်းရန်အတွက် client ဘက်သို့ ပြန်ပို့နိုင်ပါသည်။
        return res.json({ success: true, msg: "Signed in", username: user.username });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, msg: "Signin failed", error: err.message });
    }
});

// ---------------------
// UPLOAD (Image/File Upload)
// ---------------------
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
      const file = req.file;

      const base64 = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;

      const result = await cloud.uploader.upload(base64, {
          folder: "chat_uploads"
      });

      return res.json({
          success: true,
          url: result.secure_url
      });

  } catch (err) {
      return res.status(500).json({ success: false, msg: "Upload error", err });
  }
});

// ---------------------\
// HTTP SERVER
// ---------------------\
// Render သည် process.env.PORT ကို အလိုအလျောက် ပေးပါသည်။
const server = app.listen(process.env.PORT || 3000, () => {
  console.log("Server running on port " + (process.env.PORT || 3000) + "...");
});

// ---------------------\
// SOCKET.IO
// ---------------------\
const io = new Server(server, {
  cors: { origin: "*" }
});

// Auth Middleware (ChatActivity မှ ပို့သော username (token) ကို စစ်ဆေးခြင်း)
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error("NO_TOKEN")); // Token မရှိရင် connection ပိတ်
    next();
});

io.on("connection", socket => {
  console.log("User connected:", socket.handshake.auth.token, "ID:", socket.id); // username ကို log ထုတ်ပါ

  socket.on("send_message", data => {
    io.emit("receive_message", data); // Everyone gets the message
  });

  socket.on("send_image", data => {
    io.emit("receive_image", data);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.handshake.auth.token);
  });
});
