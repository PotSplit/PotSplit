import { OpenAI } from "openai";

// Simple in-memory rate limiter cache (per IP) with expiry
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 5;
const rateLimitCache = new Map();

const SYSTEM_PROMPT = `
You are PotSplit AI — an expert life coach and personal success strategist. 
Generate a clear, inspiring, step-by-step Destiny Blueprint based on the user's dream, time investment, and learning style.
Use vivid language that engages a fast-paced, visual learner but remain concise and actionable.
Structure the blueprint with numbered micro-steps, motivational encouragements, and milestones.
Avoid generic or vague advice. Tailor every step precisely to the user's inputs.
`;

export async function handler(event, context) {
  try {
    // === CORS headers for frontend compatibility ===
    const headers = {
      "Access-Control-Allow-Origin": "*", // Replace "*" with your frontend origin for better security
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    
    if (event.httpMethod === "OPTIONS") {
      // CORS preflight request
      return {
        statusCode: 204,
        headers,
      };
    }
    
    // === Rate limiting by IP ===
    const ip = event.headers["x-forwarded-for"] || event.requestContext?.identity?.sourceIp || "unknown";
    const now = Date.now();
    const entry = rateLimitCache.get(ip) || { count: 0, startTime: now };
    
    if (now - entry.startTime > RATE_LIMIT_WINDOW_MS) {
      // Reset window
      entry.count = 1;
      entry.startTime = now;
    } else {
      entry.count++;
      if (entry.count > MAX_REQUESTS_PER_WINDOW) {
        return {
          statusCode: 429,
          headers,
          body: JSON.stringify({ error: "Too many requests. Please wait a moment and try again." }),
        };
      }
    }
    rateLimitCache.set(ip, entry);
    
    // === Parse and validate input ===
    if (!event.body) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Missing request body." }),
      };
    }
    
    let input;
    try {
      input = JSON.parse(event.body);
    } catch {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Invalid JSON format in request body." }),
      };
    }
    
    const { dream, time, style } = input;
    if (
      !dream || typeof dream !== "string" || dream.trim().length < 5 ||
      !time || typeof time !== "string" || time.trim().length < 3 ||
      !style || typeof style !== "string" || style.trim().length < 3
    ) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Invalid or missing parameters. Please provide 'dream', 'time', and 'style' as non-empty strings." }),
      };
    }
    
    // === Initialize OpenAI ===
    if (!process.env.OPENAI_API_KEY) {
      console.error("OPENAI_API_KEY is missing!");
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "Server configuration error. Missing API key." }),
      };
    }
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
    // === Compose messages for chat completion ===
    const messages = [
      { role: "system", content: SYSTEM_PROMPT.trim() },
      {
        role: "user",
        content: `
Dream: ${dream.trim()}
Time available weekly: ${time.trim()}
Preferred learning/growth style: ${style.trim()}

Please generate a detailed step-by-step Destiny Blueprint accordingly.
`,
      },
    ];
    
    // === Call OpenAI Chat Completion API ===
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",  // change if you upgrade your access later
      messages,
      temperature: 0.85,       // creative but focused
      max_tokens: 900,         // enough for detailed steps
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
    });
    
    // === Extract and return the generated blueprint ===
    const blueprint = completion.choices?.[0]?.message?.content || "No blueprint generated.";
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ status: "success", blueprint }),
    };
    
  } catch (error) {
    console.error("Blueprint generation failed:", error);
    
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: "Internal server error while generating blueprint." }),
    };
  }
}
