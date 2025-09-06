const express = require("express");
const cors = require("cors");
const { exec } = require("child_process");
const { promisify } = require("util");
const fs = require("fs").promises;
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { fixLatexErrors } = require("./llmService");

const execAsync = promisify(exec);
const app = express();

// Railway will automatically set the PORT environment variable
const PORT = process.env.PORT || 3000;

// Configure CORS - allow all origins (production can limit)
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Root path
app.get("/", (req, res) => {
  res.json({
    message: "LaTeX Compilation Service",
    status: "running",
    endpoints: {
      health: "GET /health",
      compile: "POST /compile",
    },
  });
});

// Health check
app.get("/health", async (req, res) => {
  try {
    // Check if pdflatex is available
    await execAsync("which pdflatex");
    res.json({
      status: "healthy",
      service: "latex-compiler",
      pdflatex: "available",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      status: "unhealthy",
      error: "pdflatex not found",
    });
  }
});

// Helper function to extract error from LaTeX log
async function extractLatexError(tempDir) {
  const logFile = path.join(tempDir, "document.log");
  let errorDetails = "";
  let userFriendlyError = "";
  
  try {
    const logContent = await fs.readFile(logFile, "utf-8");
    const lines = logContent.split('\n');
    
    let errorFound = false;
    let errorLines = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      if (line.startsWith('!')) {
        errorFound = true;
        for (let j = i; j < Math.min(i + 5, lines.length); j++) {
          errorLines.push(lines[j]);
        }
        
        if (line.includes('Undefined control sequence')) {
          userFriendlyError = "Undefined LaTeX command. Check for typos in commands or missing packages.";
        } else if (line.includes('File') && line.includes('not found')) {
          const match = line.match(/File `(.+?)'/);
          userFriendlyError = `Missing file or package: ${match ? match[1] : 'unknown'}. Add \\usepackage{} for missing packages.`;
        } else if (line.includes('Missing')) {
          userFriendlyError = "Missing delimiter or bracket. Check for unclosed braces, brackets, or math mode.";
        } else if (line.includes('Emergency stop')) {
          userFriendlyError = "Critical LaTeX error. Check document structure and syntax.";
        } else {
          userFriendlyError = line.substring(1).trim();
        }
        break;
      }
    }
    
    if (!errorFound) {
      const meaningfulLines = lines.filter(l => l.trim() && !l.includes('*File List*'));
      errorDetails = meaningfulLines.slice(-10).join('\n');
      userFriendlyError = "Compilation failed. Check LaTeX syntax.";
    } else {
      errorDetails = errorLines.join('\n');
    }
  } catch (error) {
    errorDetails = error.message;
    userFriendlyError = "Failed to compile LaTeX document.";
  }
  
  return { userFriendlyError, errorDetails };
}

// Helper function to compile LaTeX
async function compileLatex(tempDir, texFile, latex) {
  await fs.writeFile(texFile, latex);
  
  try {
    await execAsync(
      `cd ${tempDir} && pdflatex -interaction=nonstopmode -halt-on-error document.tex`,
      { timeout: 30000 }
    );
    
    const pdfFile = path.join(tempDir, "document.pdf");
    const pdfExists = await fs.access(pdfFile).then(() => true).catch(() => false);
    
    if (!pdfExists) {
      const { userFriendlyError, errorDetails } = await extractLatexError(tempDir);
      throw new Error(userFriendlyError + (errorDetails ? `\n\nDetails: ${errorDetails}` : ''));
    }
    
    return await fs.readFile(pdfFile);
  } catch (error) {
    if (error.message && error.message.includes('Details:')) {
      throw error;
    }
    const { userFriendlyError, errorDetails } = await extractLatexError(tempDir);
    throw new Error(userFriendlyError + (errorDetails ? `\n\nDetails: ${errorDetails}` : ''));
  }
}

// LaTeX compilation endpoint with LLM error fixing
app.post("/compile", async (req, res) => {
  const jobId = uuidv4();
  const tempDir = `/tmp/latex-${jobId}`;
  const MAX_ATTEMPTS = 3;

  console.log(`Starting compilation job: ${jobId}`);

  try {
    const { latex: originalLatex, autoFix = true } = req.body;

    if (!originalLatex) {
      return res.status(400).json({
        error: "No LaTeX content provided",
      });
    }

    // Create temporary directory
    await fs.mkdir(tempDir, { recursive: true });
    const texFile = path.join(tempDir, "document.tex");
    
    let currentLatex = originalLatex;
    let lastError = null;
    let llmSuggestions = null;
    
    // Try compilation with retry logic
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      console.log(`Compilation attempt ${attempt} for job ${jobId}`);
      
      try {
        const pdfBuffer = await compileLatex(tempDir, texFile, currentLatex);
        
        // Success! Clean up and return PDF
        await fs.rm(tempDir, { recursive: true, force: true });
        console.log(`Successfully compiled job ${jobId} on attempt ${attempt}`);
        
        res.set({
          "Content-Type": "application/pdf",
          "Content-Disposition": 'attachment; filename="resume.pdf"',
          "X-Job-Id": jobId,
          "X-Compilation-Attempts": attempt.toString(),
          "X-LLM-Fixed": attempt > 1 ? "true" : "false"
        });
        return res.send(pdfBuffer);
        
      } catch (compileError) {
        lastError = compileError.message;
        console.error(`Attempt ${attempt} failed for job ${jobId}:`, lastError);
        
        // If autoFix is disabled or we've reached max attempts, stop trying
        if (!autoFix || attempt === MAX_ATTEMPTS) {
          break;
        }
        
        // Try to fix with LLM
        try {
          console.log(`Attempting to fix LaTeX errors with LLM for job ${jobId}`);
          currentLatex = await fixLatexErrors(currentLatex, lastError);
          llmSuggestions = "AI has attempted to fix the following issues:\n" + lastError.split('\n')[0];
        } catch (llmError) {
          console.error(`LLM fix failed for job ${jobId}:`, llmError.message);
          llmSuggestions = "AI assistance unavailable. Manual fixes required.";
          break;
        }
      }
    }
    
    // All attempts failed
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    
    const errorResponse = {
      error: lastError.split('\n')[0],
      details: lastError.includes('Details:') ? lastError.split('Details:')[1].trim() : lastError,
      jobId: jobId,
      attempts: MAX_ATTEMPTS
    };
    
    if (llmSuggestions) {
      errorResponse.llmSuggestions = llmSuggestions;
    }
    
    res.status(500).json(errorResponse);
    
  } catch (error) {
    console.error(`Unexpected error for job ${jobId}:`, error.message);
    
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    
    res.status(500).json({
      error: "Internal server error",
      details: error.message,
      jobId: jobId,
    });
  }
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`LaTeX service running on port ${PORT}`);
  console.log(`Health check: http://0.0.0.0:${PORT}/health`);
});
