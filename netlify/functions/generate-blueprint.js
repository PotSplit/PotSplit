// File: netlify/functions/generate-blueprint.js

import { OpenAI } from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function handler(event) {
  try {
    const { goal, timeframe, style } = JSON.parse(event.body);

    const prompt = `
You are Destiny, an AI destiny architect.
Craft a personalized Destiny Blueprint for someone with the following inputs:

- ✨ Goal: ${goal}
- ⏳ Time commitment: ${timeframe}
- 🌱 Growth style: ${style}

Instructions:
1. Open with an inspiring message tailored to the user's mindset.
2. Break their journey into 3 progressive Milestones (titles + explanations).
3. Provide 5–7 actionable Micro-Steps for Milestone One.
4. End with a short, emotionally powerful Call to Action.
5. Make it motivating, visual, and practical.

Output format: Clean markdown-style bullets or numbered steps, no code blocks.

Be insightful. Speak directly to the user’s future.
`;

    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.85,
      max_tokens: 1000,
    });

    const blueprint = response.choices[0].message.content;

    return {
      statusCode: 200,
      body: JSON.stringify({ blueprint }),
    };
  } catch (error) {
    console.error('Blueprint generation failed:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
}
