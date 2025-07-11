const { Configuration, OpenAIApi } = require("openai");

exports.handler = async (event) => {
  const { goal, timeframe, style } = JSON.parse(event.body);

  const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
  });
  const openai = new OpenAIApi(configuration);

  const prompt = `
You are Destiny, an AI that designs personalized blueprints to help people achieve life goals. 

User's goal: ${goal}
Available time: ${timeframe}
Growth style: ${style}

Create a motivating 5-step Destiny Blueprint with milestone names, progress structure, and mindset tips.
  `;

  try {
    const completion = await openai.createChatCompletion({
      model: "gpt-4",
      messages: [
        { role: "system", content: "You are an expert personal growth coach and strategic planner." },
        { role: "user", content: prompt }
      ],
      temperature: 0.85,
    });

    const blueprint = completion.data.choices[0].message.content;

    return {
      statusCode: 200,
      body: JSON.stringify({ blueprint }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
