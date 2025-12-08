import express from "express";
import { Server } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import cloudinary from "cloudinary";
import { v2 as cloud } from "cloudinary";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ---------------------
// Cloudinary Setup
// ---------------------
cloud.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_KEY,
  api_secret: process.env.CLOUD_SECRET
});

// ---------------------
// Multer (Memory Upload)
// ---------------------
const upload = multer({ storage: multer.memoryStorage() });

// ---------------------
// HTTP Server
// ---------------------
const server = app.listen(process.env.PORT || 3000, () => {
  console.log("Server running...");
});

// ---------------------
// SOCKET.IO
// ---------------------
const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

// LISTEN SOCKET CONNECTIONS
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // Normal text message
  socket.on("send_message", (data) => {
    io.emit("receive_message", data);
  });

  // Image message (after uploaded)
  socket.on("send_image", (data) => {
    io.emit("receive_image", data);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

// ---------------------
// IMAGE UPLOAD API
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
    return res.status(500).json({ error: "Upload failed", details: err });
  }
});

// ---------------------
// ROOT CHECK ROUTE
// ---------------------
app.get("/", (req, res) => {
  res.send("Chat server is running.");
});
