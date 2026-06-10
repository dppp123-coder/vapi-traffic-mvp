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
  return cleaned || null;
}

function isMajorRoad(name) {
  if (!name) return false;

  return /\b(M\d+|A\d+\(M\)|A\d+)\b/i.test(name);
}

function extractMajorRoads(steps) {
  const roads = steps
    .map((step) => cleanRoadName(step.name))
    .filter(Boolean)
    .filter(isMajorRoad);

  return [...new Set(roads)].slice(0, 8);
}

function extractFallbackRoads(steps) {
  const roads = steps
    .map((step) => cleanRoadName(step.name))
    .filter(Boolean);

  return [...new Set(roads)].slice(0, 8);
}

function findMatchingIncidents(incidents, roads) {
  return incidents
    .filter((item) => {
      const text = `${item.title || ""} ${item.description || ""}`.toLowerCase();

      return roads.some((road) =>
        text.includes(road.toLowerCase())
      );
    })
    .slice(0, 4);
}

function createHotspots(roads, origin, destination) {
  if (!roads.length) {
    return [
      `approaching ${origin}`,
      `approaching ${destination}`,
      "busy town centre roads"
    ];
  }

  const hotspots = [];

  for (const road of roads.slice(0, 5)) {
    if (/^M/i.test(road)) {
      hotspots.push(`${road} motorway junctions and interchanges`);
    } else if (/^A/i.test(road)) {
      hotspots.push(`${road} busy roundabouts and town approaches`);
    }
  }

  hotspots.push(`approaching ${destination}`);

  return [...new Set(hotspots)].slice(0, 5);
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

    const majorRoads = extractMajorRoads(steps);
    const fallbackRoads = extractFallbackRoads(steps);
    const routeRoads = majorRoads.length ? majorRoads : fallbackRoads.slice(0, 5);

    const routeSummary = routeRoads.length
      ? routeRoads.join(" → ")
      : "route details unavailable";

    const incidents = await getNationalHighwaysIncidents();
    const matchingIncidents = findMatchingIncidents(incidents, routeRoads);

    let trafficLevel = "Traffic appears normal based on the current route estimate.";

    if (durationMin > 240) {
      trafficLevel = "There may be severe delays.";
    } else if (durationMin > 180) {
      trafficLevel = "There may be heavy delays.";
    } else if (durationMin > 120) {
      trafficLevel = "There may be moderate delays.";
    }

    const hotspots = createHotspots(routeRoads, origin, destination);

    const hotspotText = hotspots.length
      ? hotspots.map((spot) => `- ${spot}`).join(" ")
      : "- No obvious hotspots found.";

    const incidentText = matchingIncidents.length
      ? matchingIncidents.map((item) => `- ${item.title}`).join(" ")
      : "- No matching live National Highways incidents were found on the main roads identified.";

    const responseText =
      `Quickest route from ${origin} to ${destination}: ${routeSummary}. ` +
      `Estimated travel time: ${durationMin} minutes. ` +
      `${trafficLevel} ` +
      `Likely traffic hotspots: ${hotspotText} ` +
      `Live National Highways incidents: ${incidentText}`;

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