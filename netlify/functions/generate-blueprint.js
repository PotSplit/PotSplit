const { Configuration, OpenAIApi } = require("openai");
const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

exports.handler = async function (event) {
  try {
    const { goal, timeframe, style } = JSON.parse(event.body);

    const prompt = `
You are Destiny, an AI destiny architect.
Craft a personalized Destiny Blueprint for someone with the following inputs:

- 🎯 Goal: ${goal}
- ⏳ Time commitment: ${timeframe}
- 🌱 Growth style: ${style}

Instructions:
1. Open with an inspiring message tailored to the user's mindset.
2. Break their journey into 3 progressive Milestones (titles + explanations).
3. Provide 5–7 actionable Micro-Steps for Milestone One.
4. End with a short, emotionally powerful Call to Action.
5. Make it motivating, visual, and practical.

Output format: Clean markdown-like bullets or numbered steps, no code blocks.

Be insightful. Speak directly to the user’s future.
`;

    const response = await openai.createChatCompletion({
      model: "gpt-4",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.85,
      max_tokens: 1000,
    });

    const blueprint = response.data.choices[0].message.content;

    return {
      statusCode: 200,
      body: JSON.stringify({ blueprint }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
