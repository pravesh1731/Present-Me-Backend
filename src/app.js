// app.js (API entry)
require("dotenv").config(); // ensure .env is loaded
const express = require("express");
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const path = require("path");
const cors = require("cors");

const routes = require("./routes");

const app = express();

// Middleware
app.use(cors(
  {
    origin: ['http://localhost:5173', 'http://localhost:5174','https://www.presentme.in','https://presentme.in', ],
    credentials: true,
  }
));


app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ limit: '200mb', extended: true }));
app.use(cookieParser());

app.get("/.well-known/assetlinks.json", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public", ".well-known", "assetlinks.json"),
    {
      dotfiles: "allow",
      headers: {
        "Content-Type": "application/json",
      },
    }
  );
});

// Mount routes (see routes/index.js)
app.use("/", routes);

// Example root
app.get("/", (req, res) => res.send("Present-Me back running"));

// Start server
const PORT = 2000;
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
