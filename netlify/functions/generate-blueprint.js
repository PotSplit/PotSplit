import { Configuration, OpenAIApi } from "openai";

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});

const openai = new OpenAIApi(configuration);

export async function handler(event, context) {
  try {
    const { goal, timeframe, style } = JSON.parse(event.body);

    if (!goal || !timeframe || !style) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Please provide goal, timeframe, and style." }),
      };
    }

    const prompt = `
You are a wise and inspiring mentor who creates detailed, personalized Destiny Blueprints.

User's goal: ${goal}
Time available each week: ${timeframe}
Preferred growth style: ${style}

Generate a clear, structured, and actionable Destiny Blueprint tailored to these inputs.
Include step-by-step micro-actions, timelines, and motivational guidance.
Make the blueprint unique and highly relevant to the user's specific situation.
`;

    const completion = await openai.createChatCompletion({
      model: "gpt-4",
      messages: [
        { role: "system", content: "You are a helpful and insightful mentor for personal growth." },
        { role: "user", content: prompt.trim() },
      ],
      temperature: 0.9,
      max_tokens: 800,
    });

    const blueprint = completion.data.choices[0].message.content.trim();

    return {
      statusCode: 200,
      body: JSON.stringify({ blueprint }),
    };
  } catch (error) {
    console.error("Error generating blueprint:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to generate blueprint." }),
    };
  }
}
