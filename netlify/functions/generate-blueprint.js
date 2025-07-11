import { Configuration, OpenAIApi } from "openai";

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});

const openai = new OpenAIApi(configuration);

export async function handler(event) {
  try {
    const { goal, timeframe, style } = JSON.parse(event.body);

    if (!goal || !timeframe || !style) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing required fields: goal, timeframe, or style." }),
      };
    }

    const prompt = `
You are Destiny, an inspiring AI mentor who creates deeply personalized Destiny Blueprints.

User goal: "${goal}"
Available time per week: "${timeframe}"
Preferred growth style: "${style}"

Using this information, generate a detailed Destiny Blueprint with:
- 5 clear and achievable micro-milestones
- Weekly or daily steps matched to their time availability
- A tone that fits their chosen growth style
- Motivation and insights they can follow
- No repetition from other users — each should feel custom

Only output the blueprint. No preamble or follow-up text.
`;

    const completion = await openai.createChatCompletion({
      model: "gpt-4",
      messages: [
        { role: "system", content: "You are a motivational AI who delivers personalized Destiny Blueprints." },
        { role: "user", content: prompt },
      ],
      temperature: 0.9,
      max_tokens: 900,
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
      body: JSON.stringify({ error: "Internal server error." }),
    };
  }
}
