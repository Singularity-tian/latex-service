const express = require("express");
const cors = require("cors");
const { exec } = require("child_process");
const { promisify } = require("util");
const fs = require("fs").promises;
const path = require("path");
const { v4: uuidv4 } = require("uuid");

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

// LaTeX compilation endpoint
app.post("/compile", async (req, res) => {
  const jobId = uuidv4();
  const tempDir = `/tmp/latex-${jobId}`;

  console.log(`Starting compilation job: ${jobId}`);

  try {
    const { latex } = req.body;

    if (!latex) {
      return res.status(400).json({
        error: "No LaTeX content provided",
      });
    }

    // Create temporary directory
    await fs.mkdir(tempDir, { recursive: true });

    // Write LaTeX file
    const texFile = path.join(tempDir, "document.tex");
    await fs.writeFile(texFile, latex);

    // Compile LaTeX
    console.log(`Compiling LaTeX for job ${jobId}...`);
    let stdout, stderr;
    try {
      const result = await execAsync(
        `cd ${tempDir} && pdflatex -interaction=nonstopmode -halt-on-error document.tex`,
        { timeout: 30000 }
      );
      stdout = result.stdout;
      stderr = result.stderr;
    } catch (compileError) {
      // Read log file for detailed error information
      const logFile = path.join(tempDir, "document.log");
      let errorDetails = "";
      let userFriendlyError = "";
      
      try {
        const logContent = await fs.readFile(logFile, "utf-8");
        const lines = logContent.split('\n');
        
        // Find LaTeX error messages - they typically start with '!'
        let errorFound = false;
        let errorLines = [];
        
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          
          // LaTeX errors start with '!'
          if (line.startsWith('!')) {
            errorFound = true;
            // Get the error line and the next few lines for context
            for (let j = i; j < Math.min(i + 5, lines.length); j++) {
              errorLines.push(lines[j]);
            }
            
            // Extract user-friendly error message
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
              userFriendlyError = line.substring(1).trim(); // Remove '!' and trim
            }
            break;
          }
        }
        
        if (!errorFound) {
          // No explicit error found, check stdout/stderr
          if (compileError.message.includes('pdflatex: command not found')) {
            errorDetails = "pdflatex is not installed on the server";
            userFriendlyError = "LaTeX is not properly installed on the server.";
          } else {
            // Get last meaningful lines from log
            const meaningfulLines = lines.filter(l => l.trim() && !l.includes('*File List*'));
            errorDetails = meaningfulLines.slice(-10).join('\n');
            userFriendlyError = "Compilation failed. Check LaTeX syntax.";
          }
        } else {
          errorDetails = errorLines.join('\n');
        }
        
        console.error(`LaTeX compilation error for job ${jobId}:`, errorDetails);
      } catch (logReadError) {
        console.error(`Could not read log file for job ${jobId}:`, logReadError.message);
        errorDetails = compileError.stderr || compileError.message;
        userFriendlyError = "Failed to compile LaTeX document.";
      }
      
      throw new Error(userFriendlyError + (errorDetails ? `\n\nDetails: ${errorDetails}` : ''));
    }

    // Check if PDF is generated
    const pdfFile = path.join(tempDir, "document.pdf");
    const pdfExists = await fs
      .access(pdfFile)
      .then(() => true)
      .catch(() => false);

    if (!pdfExists) {
      // Read log file to get error information
      const logFile = path.join(tempDir, "document.log");
      const log = await fs.readFile(logFile, "utf-8").catch(() => "");
      throw new Error(
        `PDF generation failed. Check LaTeX syntax. ${log.substring(0, 500)}`
      );
    }

    // Read PDF
    const pdfBuffer = await fs.readFile(pdfFile);

    // Clean up temporary files
    await fs.rm(tempDir, { recursive: true, force: true });

    console.log(`Successfully compiled job ${jobId}`);

    // Return PDF
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="resume.pdf"',
      "X-Job-Id": jobId,
    });
    res.send(pdfBuffer);
  } catch (error) {
    console.error(`Compilation failed for job ${jobId}:`, error.message);
    
    // Try to provide more helpful error information
    let additionalInfo = "";
    if (error.message.includes("pdflatex")) {
      additionalInfo = "Ensure pdflatex is installed on the server.";
    } else if (error.message.includes("undefined control sequence") || error.message.includes("Undefined control")) {
      additionalInfo = "LaTeX syntax error: undefined command or package not included.";
    } else if (error.message.includes("Missing") || error.message.includes("missing")) {
      additionalInfo = "LaTeX syntax error: missing bracket, brace, or $ delimiter.";
    } else if (error.message.includes("File") && error.message.includes("not found")) {
      additionalInfo = "Missing LaTeX package or file. Ensure all required packages are included.";
    }

    // Clean up temporary files
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});

    res.status(500).json({
      error: error.message.split('\n')[0], // First line is user-friendly error
      details: error.message.includes('Details:') ? error.message.split('Details:')[1].trim() : error.message,
      suggestion: additionalInfo || undefined,
      jobId: jobId,
    });
  }
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`LaTeX service running on port ${PORT}`);
  console.log(`Health check: http://0.0.0.0:${PORT}/health`);
});
