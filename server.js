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
      let logContent = "";
      try {
        logContent = await fs.readFile(logFile, "utf-8");
        // Extract error lines from log
        const errorLines = logContent.split('\n').filter(line => 
          line.includes('Error') || line.includes('!') || line.includes('undefined')
        ).slice(0, 10).join('\n');
        
        console.error(`LaTeX compilation error for job ${jobId}:`, errorLines || compileError.message);
      } catch (logReadError) {
        console.error(`Could not read log file for job ${jobId}:`, logReadError.message);
      }
      
      throw new Error(
        `LaTeX compilation failed: ${compileError.message}\n${logContent ? 'Log excerpt: ' + logContent.substring(logContent.lastIndexOf('!'), Math.min(logContent.lastIndexOf('!') + 500, logContent.length)) : ''}`
      );
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
      error: "LaTeX compilation failed",
      details: error.message,
      suggestion: additionalInfo,
      jobId: jobId,
    });
  }
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`LaTeX service running on port ${PORT}`);
  console.log(`Health check: http://0.0.0.0:${PORT}/health`);
});
