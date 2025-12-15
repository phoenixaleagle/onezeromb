import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
import multer from "multer";
import cloudinary, { v2 as cloud } from "cloudinary";
import { Server } from "socket.io";
import { createHash } from "crypto";
import { createServer } from "http"; 

// Load environment variables
dotenv.config(); 

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

// Use process.env for all secrets
// NOTE: Production အတွက် .env တွင် ထားရှိရန်
const MONGO_URL = process.env.MONGO_URL; 
const PORT = process.env.PORT || 3000;

const app = express();
const httpServer = createServer(app); // Socket.IO အတွက်

app.use(cors());
app.use(express.json());

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
// CLOUDINARY SETUP
// ---------------------
cloud.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_KEY,
  api_secret: process.env.CLOUD_SECRET
});

// ---------------------
// SOCKET.IO SETUP
// ---------------------
const io = new Server(httpServer, {
  cors: { origin: "*" }
});

// ** Helper Function: Broadcast Counts **
// Registered user count နှင့် Online user count များကို Client များဆီသို့ ပို့သည်
async function broadcastUserCounts() {
    try {
        const registered = await User.countDocuments(); // Registered User Count
        const online = io.engine.clientsCount;          // Online User Count (Socket connections)
        io.emit("user_counts", { registered, online });
        console.log(`Broadcast: Reg=${registered}, Online=${online}`);
    } catch (err) {
        console.error("Broadcast Error:", err);
    }
}

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

      // ** Count update on new user registered **
      broadcastUserCounts();

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

// ---------------------
// ADMIN: GET USER LIST 
// ---------------------
app.get("/admin/users", async (req, res) => {
    try {
        // NOTE: Production အတွက် Admin/Token Authentication ကို ဤနေရာတွင် ထည့်သွင်းရန် အကြံပြုပါသည်။
        const users = await User.find({}, { username: 1, createdAt: 1, _id: 0 }); 
        return res.json(users);
    } catch (err) {
        console.error("User list error:", err);
        return res.status(500).json({ success: false, msg: "Failed to fetch user list", error: err.message });
    }
});

// ---------------------
// ADMIN: DELETE USERS 
// ---------------------
app.post("/admin/delete-users", async (req, res) => {
    try {
        // NOTE: Production အတွက် Admin/Token Authentication ကို ဤနေရာတွင် ထည့်သွင်းရန် အကြံပြုပါသည်။
        const { usernames } = req.body; 

        if (!usernames || !Array.isArray(usernames) || usernames.length === 0) {
            return res.status(400).json({ success: false, msg: "Missing or invalid list of usernames" });
        }

        const result = await User.deleteMany({ username: { $in: usernames } });

        if (result.deletedCount > 0) {
            // အသုံးပြုသူ ဖျက်ပြီးပါက Count ကို ပြန်ထုတ်လွှင့်ပါ
            broadcastUserCounts(); 
            return res.json({ success: true, msg: `${result.deletedCount} users deleted successfully` });
        } else {
            return res.status(404).json({ success: false, msg: "No users found or deleted" });
        }
    } catch (err) {
        console.error("User delete error:", err);
        return res.status(500).json({ success: false, msg: "User deletion failed", error: err.message });
    }
});

// ---------------------
// UPLOAD
// ---------------------
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, msg: "No file" });
    }
    const base64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
    const result = await cloud.uploader.upload(base64, {
      folder: "chat_uploads"
    });
    return res.json({ success: true, url: result.secure_url });
  } catch (err) {
    return res.status(500).json({ success: false, msg: "Upload error", err: err.message });
  }
});


// ---------------------\
// SOCKET.IO EVENTS
// ---------------------\
io.use((socket, next) => {
    const token = socket.handshake.auth.token; // Client မှ ပို့လိုက်သော username (token)
    if (!token) return next(new Error("NO_TOKEN"));
    next();
});

io.on("connection", socket => {
  const username = socket.handshake.auth.token;
  console.log("User connected:", username, "ID:", socket.id);

  // ** New: Broadcast counts on connect **
  broadcastUserCounts(); 

  socket.on("send_message", data => {
    socket.broadcast.emit("receive_message", data); // ပို့သူမှ လွဲ၍ ကျန်သူများအားလုံးဆီသို့ ပို့သည်
  });

  socket.on("send_image", data => {
    socket.broadcast.emit("receive_image", data);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", username);
    // ** New: Broadcast counts on disconnect (Delay 1 second for stability) **
    setTimeout(broadcastUserCounts, 1000); 
  });
});

// ---------------------
// START SERVER
// ---------------------
httpServer.listen(PORT, () => { 
  console.log(`Server running on port ${PORT}`);
});
