const Anthropic = require("@anthropic-ai/sdk");

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

async function fixLatexErrors(latex, error) {
  console.log("Attempting to fix LaTeX errors using Claude Sonnet...");

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
      temperature: 0.3,
      system:
        "You are a LaTeX expert with $50M yearly salary. Fix LaTeX compilation errors and return ONLY the corrected LaTeX code. No explanations, no markdown, just the complete fixed LaTeX document.",
      messages: [
        {
          role: "user",
          content: `Fix this LaTeX compilation error:

Error: ${error}

Original LaTeX:
${latex}

Return only the complete fixed LaTeX code:`,
        },
      ],
    });

    let fixedLatex = response.content[0].text.trim();
    // Clean up any markdown code blocks if present
    fixedLatex = fixedLatex.replace(/```latex\n?/g, "").replace(/```\n?/g, "");

    return fixedLatex;
  } catch (error) {
    console.error("Claude API error:", error.message);
    throw error;
  }
}

module.exports = {
  fixLatexErrors,
};
