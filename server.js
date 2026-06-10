import express from "express";
import fetch from "node-fetch";
import { XMLParser } from "fast-xml-parser";

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

  return `${data[0].lon},${data[0].lat}`;
}

async function getNationalHighwaysIncidents() {
  const feedUrls = [
    "https://m.highwaysengland.co.uk/feeds/rss/UnplannedEvents.xml",
    "https://m.highwaysengland.co.uk/feeds/rss/CurrentAndFutureEvents.xml"
  ];

  const parser = new XMLParser();
  const allItems = [];

  for (const feedUrl of feedUrls) {
    try {
      const res = await fetch(feedUrl);
      const xml = await res.text();
      const data = parser.parse(xml);

      const items = data?.rss?.channel?.item || [];

      if (Array.isArray(items)) {
        allItems.push(...items);
      } else if (items) {
        allItems.push(items);
      }
    } catch (err) {
      console.error("National Highways feed error:", err.message);
    }
  }

  return allItems;
}

function cleanRoadName(name) {
  if (!name) return null;

  const cleaned = name.trim();

  if (!cleaned) return null;

  return cleaned;
}

function findMatchingIncidents(incidents, roads) {
  return incidents
    .filter((item) => {
      const text = `${item.title || ""} ${item.description || ""}`.toLowerCase();

      return roads.some((road) =>
        text.includes(road.toLowerCase())
      );
    })
    .slice(0, 3);
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
      `https://router.project-osrm.org/route/v1/driving/${originCoords};${destinationCoords}?overview=full&steps=true`;

    const routeRes = await fetch(routeUrl);
    const routeData = await routeRes.json();

    const route = routeData?.routes?.[0];

    if (!route) {
      return res.json({
        response: `Sorry, I could not find a route from ${origin} to ${destination}.`
      });
    }

    const durationMin = Math.round(route.duration / 60);

    const steps = route.legs?.flatMap((leg) => leg.steps || []) || [];

    const roads = steps
      .map((step) => cleanRoadName(step.name))
      .filter(Boolean);

    const uniqueRoads = [...new Set(roads)].slice(0, 10);

    const routeSummary = uniqueRoads.length
      ? `The quickest route appears to use ${uniqueRoads.join(", ")}.`
      : "Specific road names are not available for this route.";

    const incidents = await getNationalHighwaysIncidents();
    const matchingIncidents = findMatchingIncidents(incidents, uniqueRoads);

    const incidentSummary = matchingIncidents.length
      ? "Live National Highways incidents found: " +
        matchingIncidents.map((item) => item.title).join(". ")
      : "No matching live National Highways incidents were found on the main roads identified.";

    let trafficNote = "Traffic appears normal based on the current route estimate.";

    if (durationMin > 240) {
      trafficNote = "There may be severe delays.";
    } else if (durationMin > 180) {
      trafficNote = "There may be heavy delays.";
    } else if (durationMin > 120) {
      trafficNote = "There may be moderate delays.";
    }

    const responseText =
      `The quickest route from ${origin} to ${destination} is estimated at ${durationMin} minutes. ` +
      `${routeSummary} ` +
      `${trafficNote} ` +
      `${incidentSummary}`;

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