import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ status: "ok", service: "vapi-traffic-mvp" });
});

async function geocode(place) {
  const url =
    `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(place + ", UK")}&limit=1`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "vapi-traffic-mvp"
    }
  });

  const data = await response.json();

  if (!data || data.length === 0) {
    throw new Error(`Could not find location: ${place}`);
  }

  const lat = data[0].lat;
  const lon = data[0].lon;

  return `${lon},${lat}`;
}

app.post("/traffic", async (req, res) => {
  try {
    const { origin, destination } = req.body;

    if (!origin || !destination) {
      return res.status(400).json({
        response: "I need both a starting location and a destination."
      });
    }

    const originCoords = await geocode(origin);
    const destinationCoords = await geocode(destination);

    const routeUrl =
      `https://router.project-osrm.org/route/v1/driving/${originCoords};${destinationCoords}?overview=false`;

    const routeRes = await fetch(routeUrl);
    const routeData = await routeRes.json();

    const durationSec = routeData?.routes?.[0]?.duration || null;
    const durationMin = durationSec ? Math.round(durationSec / 60) : null;

    let trafficNote = "Traffic looks normal.";

    if (durationMin > 160) {
      trafficNote = "There may be heavy delays.";
    } else if (durationMin > 120) {
      trafficNote = "There may be moderate delays.";
    }

    const responseText =
      `From ${origin} to ${destination}, estimated travel time is ${durationMin || "unknown"} minutes. ${trafficNote}`;

    return res.json({
      response: responseText
    });

  } catch (err) {
    console.error(err);

    return res.status(500).json({
      response: "Sorry, I could not get traffic information for that route."
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Running on port ${PORT}`);
});