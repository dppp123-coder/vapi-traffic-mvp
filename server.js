import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ status: "ok", service: "vapi-traffic-mvp" });
});

app.post("/traffic", async (req, res) => {
  try {
    const { origin, destination } = req.body;

    if (!origin || !destination) {
      return res.status(400).json({
        error: "Missing origin or destination"
      });
    }

    const url =
      `http://router.project-osrm.org/route/v1/driving/${origin};${destination}?overview=false`;

    const routeRes = await fetch(url);
    const routeData = await routeRes.json();

    const durationSec =
      routeData?.routes?.[0]?.duration || null;

    const durationMin =
      durationSec ? Math.round(durationSec / 60) : null;

    let trafficNote = "Light traffic conditions.";

    if (durationMin > 120) {
      trafficNote = "Heavy congestion detected.";
    } else if (durationMin > 60) {
      trafficNote = "Moderate traffic expected.";
    }

    const responseText =
      `Route from ${origin} to ${destination}. ` +
      `${trafficNote} ` +
      `Estimated travel time is ${durationMin || "unknown"} minutes.`;

    return res.json({
      response: responseText
    });

  } catch (err) {
    console.error(err);

    return res.status(500).json({
      error: "Server error"
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Running on port ${PORT}`);
});